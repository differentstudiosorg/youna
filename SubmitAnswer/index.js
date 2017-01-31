var aws = require('aws-sdk');
aws.config.update({region: 'us-east-1'});
var async = require('async');
var verifier = require('google-id-token-verifier');
var money = require('money-math');
var docClient = new aws.DynamoDB.DocumentClient();
var ddb = new aws.DynamoDB();
var user_table = '';
var creator_table = '';
var creator_details_table = '';
var question_table = '';
var answer_table = '';
var google_client_id = '';
var config_table = 'lambda_config';

//Global config variables 
var USERS_DYNAMODB_TABLE = "users_dynamodb_table";
var QUESTIONS_DYNAMODB_TABLE = "questions_dynamodb_table";
var CREATORS_DYNAMODB_TABLE = "creators_dynamodb_table";
var CREATORS_DETAILS_DYNAMODB_TABLE = "creator_details_dynamodb_table";
var ANSWERS_DYNAMODB_TABLE = "answers_dynamodb_table";
var CONFIG_TABLE = 'lambda_config';
var GOOGLE_CLIENT_ID = 'google_client_id';
var STAGES = ['prod', 'devo', 'test'];

function genRand() {
    return Math.floor(Math.random()*89999999999+10000000000);
}

function generateUniqueId() {
    return genRand().toString() + genRand().toString();
}

function generateThumbnailName(filename) {
    var names = filename.split(".");
    var thumbnail = names[0] + "-thumbnail-00001.png";
    return thumbnail;
}

function validateMoney(amount) {
    return /^\-?\d+\.\d\d$/.test(amount);
}

function getDateTime() {

    var date = new Date();

    var year = date.getFullYear();

    var month = date.getMonth() + 1;
    month = (month < 10 ? "0" : "") + month;

    var day  = date.getDate();
    day = (day < 10 ? "0" : "") + day;

    return month + "/" + day + "/" + year;

}

function getFormattedDateTime() {
    var d = new Date();
    d = d.getFullYear() + "-" + ('0' + (d.getMonth() + 1)).slice(-2) + "-" + ('0' + d.getDate()).slice(-2) + " " + ('0' + d.getHours()).slice(-2) + ":" + ('0' + d.getMinutes()).slice(-2) + ":" + ('0' + d.getSeconds()).slice(-2);
    return d;
}

function loadConfig(ddbtable, stage_value, context, callback) {

    var params = {
        Key:{
            stage:{
                S: stage_value 
            } 
        },
        TableName:ddbtable,
        AttributesToGet: [ USERS_DYNAMODB_TABLE, CREATORS_DYNAMODB_TABLE, CREATORS_DETAILS_DYNAMODB_TABLE, QUESTIONS_DYNAMODB_TABLE, ANSWERS_DYNAMODB_TABLE, GOOGLE_CLIENT_ID]
    }

    ddb.getItem(params, function(err, data) {
        if (err) {
            var message = "Couldn't get config from DynamoDB";
            context.fail(message)
        } else {
            return callback(data);
        }
    });

}

function getStage(invokedFunctionArn) {

     var invokedFunctionArnArray = invokedFunctionArn.split(":");
     var stage = invokedFunctionArnArray[invokedFunctionArnArray.length - 1];
     return stage;

}


exports.handler = function(event, context, callback) {

    var invokedFunctionArn = context.invokedFunctionArn;
    var stage = getStage(invokedFunctionArn);
    console.log(config_table, stage);
    if (STAGES.indexOf(stage) >= 0) {
        loadConfig(config_table, stage, context, function(env_config){

            //set the table
            user_table = env_config["Item"][USERS_DYNAMODB_TABLE]["S"];
            creator_table = env_config["Item"][CREATORS_DYNAMODB_TABLE]["S"];
            creator_details_table = env_config["Item"][CREATORS_DETAILS_DYNAMODB_TABLE]["S"];
            question_table = env_config["Item"][QUESTIONS_DYNAMODB_TABLE]["S"];
            answer_table = env_config["Item"][ANSWERS_DYNAMODB_TABLE]["S"];
            google_client_id = env_config["Item"][GOOGLE_CLIENT_ID]["S"];

            var token = event.body.token;
            var filename = event.body.filename; 
            var question_id = event.body.question_id;
            var asker_id = event.body.asker_id;
            var answerer_id = event.body.answerer_id;

            if (token === undefined || token === null || token === '') {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            if (filename === undefined || filename === null || filename === '') {
                var error = new Error("filename is either null or undefined");
                return callback(error);
            }

            if (question_id === undefined || question_id === null || question_id === '') {
                var error = new Error("question_id is either null or undefined");
                return callback(error);
            }

            if (asker_id === undefined || asker_id === null || asker_id === '') {
                var error = new Error("asker_id is either null or undefined");
                return callback(error);
            }

            if (answerer_id === undefined || answerer_id === null || answerer_id === '') {
                var error = new Error("answerer_id Id is either null or undefined");
                return callback(error);
            }

            var info = {
                token : token, 
                asker_user_id : asker_id, 
                filename : filename, 
                creator_id : answerer_id,
                question_id : question_id
            }

            async.waterfall([

                async.apply(verifyToken, info),
                verifyAnswerer,
                getAnswererDetails,
                getQuestion,
                makeAnswer,
                updateQuestion,
                updateAnswerer, 
                notify

            ], function(err, done) {
                if (err) {
                    return callback(err);
                } else {
                    return callback(null, done.answer);
                }
            });

        });

    } else {
        var error = new Error("Invalid Stage.");
        return callback(error);
    }

}

function verifyToken(info, callback) {

    var token = info.token;

    verifier.verify(token, google_client_id, function (err, tokenInfo) {
      if (!err) {
        var data = tokenInfo;
        info.answerer_google_id = tokenInfo.sub;
        return callback(null, info);
      } else {
        var error = new Error("Invalid Token");
        return callback(error);
      }
    });

}

function verifyAnswerer(info, callback) {

    var params = {
        TableName : creator_table,
        Key : {
            creator_id : info.creator_id
        }
    }

    docClient.get(params, function(err, creator_item){
        if (err) {
            return callback(err);
        } else {
            var creator = creator_item['Item'];
            if (creator != undefined) {
                if (creator['google_id'] === info.answerer_google_id) {
                    info.answerer = creator;
                    info.answerer_name = creator['name'];
                    return callback(null, info);
                } else {
                    var error = new Error("Token and creator_id don't match");
                    return callback(error);
                }
            } else {
                var error = new Error("Creator Id provided is invalid");
                return callback(error);
            }
        }
    });

}

function getAnswererDetails(info, callback) {

    var parameters = {
        TableName : creator_details_table,
        Key : {
            "creator_id" : info.creator_id
        }
    }

    docClient.get(parameters, function(err, creator_details_item) {
        if (err) {
            return callback(err);
        } else {
            var creator_details = creator_details_item['Item'];
            if (creator_details != undefined) {
                info.answerer_details = creator_details;
                return callback(null, info);
            } else {
                var error = new Error("creator details not found");
                return callback(error);
            }
        }
    });

}

function getQuestion(info, callback) {

    var params = {
        TableName : question_table,
        Key : {
            "question_id": info.question_id
        }
    };

    docClient.get(params, function(err, question) {
        if (err) {
            return callback(err);
        } else {
            if (question.Item != undefined) {
                info.question = question.Item;
                return callback(null, info);
            } else {
                var error = new Error("question not found");
                return callback(error);
            }
        }
    });
}

function makeAnswer(info, callback) {
    var d = new Date();
    var answer = {
        answer_id : generateUniqueId(),
        question_id : info.question_id,
        asker_id : info.asker_user_id,
        answerer_id : info.creator_id,
        filename : info.filename, 
        thumbnail : generateThumbnailName(info.filename),
        creation_date : getDateTime(),
        unformatted_date : d.toString(),
        formatted_date : getFormattedDateTime(),
        asker_name : info.asker_name, 
        answerer_name : info.answerer_name,
        likes: 0,
        rating : -1,
        price : info.question.price
    }

    var params = {
        TableName : answer_table, 
        Item : answer
    }

    docClient.put(params, function(err) {
        if (err) {
            return callback(err);
        } else {
            info.answer = answer;
            return callback(null, info);
        }
    });

}

function updateQuestion(info, callback) {

    var params = {
        TableName : question_table,
        Key : {
            "question_id": info.question_id
        },
        UpdateExpression : "set #status = :status",
        ExpressionAttributeNames : {
            "#status" : "status"
        },
        ExpressionAttributeValues : {
            ":status" : "answered"
        },
        ReturnValues:"ALL_NEW"
    };

    docClient.update(params, function(err, data) {
        if (err) {
            return callback(err);
        } else {
            return callback(null, info);
        }
    });

}


function getActualPriceToBeAdded(money_to_add) {
    var money_to_add_updated = money.percent(money_to_add, "60.00");
    return money_to_add_updated;
}

function calculateBalance(balance, money_to_add) {
    var money_to_add_updated = getActualPriceToBeAdded(money_to_add);
    var new_balance = money.add(balance, money_to_add_updated);
    return new_balance;
}


function updateAnswerer(info, callback) {

    var pending_questions = info.answerer_details.pending_questions;
    var answers_to_date = info.answerer_details.answers_to_date;

    pending_questions--;
    answers_to_date++;

    var balance = info.answerer_details.balance;
    var price = info.question.price;
    if (price === 'Free') price = "0.00";
    if (!validateMoney(balance) || !validateMoney(price)) {
        var error = new Error("balance or price format is invalid");
        return callback(error);
    }


    var updated_balance = calculateBalance(balance, price);
    var last_balance_addition = getActualPriceToBeAdded(price);

    var params = {
        TableName: creator_details_table,
        Key:{
            "creator_id" : info.creator_id
        },
        UpdateExpression: "set #pending_questions = :pending_questions, #balance = :balance, #answers_to_date = :answers_to_date, #last_balance_addition = :last_balance_addition, #last_balance_addition_date = :last_balance_addition_date",
        ExpressionAttributeNames:{
            "#pending_questions" : "pending_questions",
            "#balance" : "balance",
            "#answers_to_date" : "answers_to_date",
            "#last_balance_addition" : "last_balance_addition",
            "#last_balance_addition_date" :"last_balance_addition_date"
        },
        ExpressionAttributeValues:{
            ":pending_questions" : pending_questions,
            ":balance" : updated_balance,
            ":answers_to_date" : answers_to_date,
            ":last_balance_addition" : last_balance_addition,
            ":last_balance_addition_date" : getDateTime()
        },
        ReturnValues:"ALL_NEW"
    };

    docClient.update(params, function(err, data) {
        if (err) {
            return callback(err);
        } else {

            if (pending_questions === 19) {

                var parameters2 = {
                    TableName : creator_table,
                    Key : {
                        "creator_id" : info.creator_id
                    },
                    UpdateExpression : "set #can_accept = :can_accept",
                    ExpressionAttributeNames : {
                        "#can_accept" : "can_accept"
                    },
                    ExpressionAttributeValues : {
                        ":can_accept" : 1
                    },
                    ReturnValues:"ALL_NEW"
                }

                docClient.update(parameters2, function(err, data) {
                    if (err) {
                        return callback(err);
                    } else {
                        return callback(null, info);
                    }
                });

            } else {
                return callback(null, info);
            }

        }
    });
}

function notify(params, callback) {
    //doesn't belong here but putting it here to make things faster 
    var parameters = {
        TableName : user_table,
        Key : { "google_id" : params.answerer_google_id }
    }

    docClient.get(parameters, function(err, user_item) {
        if (err) {
            return callback(err);
        } else {
            var user = user_item['Item'];
            if (user['sns_endpoint_arn'] != undefined) {

                //first get the arn 
                var sns = new aws.SNS();
                var title = "You've just recieved an answer";
                var message = JSON.stringify({
                                  'default' : title,
                                  'APNS' : JSON.stringify({
                                    'aps' : { 
                                      'alert' : title,
                                      'badge' : '0',
                                      'sound' : 'default'
                                    },
                                    'id' : generateUniqueId(),
                                    's' : 'section',
                                  }),
                                  'APNS_SANDBOX' : JSON.stringify({
                                    'aps' : { 
                                      'alert' : title,
                                      'badge' : '0',
                                      'sound' : 'default'
                                    },
                                    'id' : generateUniqueId(),
                                    's' : 'section',
                                  })
                              });

                var subject = "Please answer it as soon as you possible.";

                sns.publish({

                    TargetArn: user['sns_endpoint_arn'],
                    Message: message,
                    MessageStructure : 'json',
                    Subject: subject

                }, function(err,data) {
                    if (err) {
                        console.log(err, user);
                        return callback(null, params);
                    } else {
                        return callback(null, params);
                    }
                });

            } else {
                return callback(null, params);
            }
        }
    });
}