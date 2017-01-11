var aws = require('aws-sdk');
aws.config.update({region: 'us-east-1'});
var async = require('async');
var verifier = require('google-id-token-verifier');
var stripe = '';
var docClient = new aws.DynamoDB.DocumentClient();
var ddb = new aws.DynamoDB();
var user_table = '';
var creator_table = '';
var creator_details_table = '';
var question_table = '';
var google_client_id = '';
var config_table = 'lambda_config';

//Global config variables 
var USERS_DYNAMODB_TABLE = "users_dynamodb_table";
var QUESTIONS_DYNAMODB_TABLE = "questions_dynamodb_table";
var CREATORS_DYNAMODB_TABLE = "creators_dynamodb_table";
var CREATORS_DETAILS_DYNAMODB_TABLE = "creator_details_dynamodb_table";
var STRIPE_API_KEY = 'stripe_api_key';
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

function getDateTime() {

    var date = new Date();

    var year = date.getFullYear();

    var month = date.getMonth() + 1;
    month = (month < 10 ? "0" : "") + month;

    var day  = date.getDate();
    day = (day < 10 ? "0" : "") + day;

    return month + "/" + day + "/" + year;

}

function loadConfig(ddbtable, stage_value, context, callback) {

    var params = {
        Key:{
            stage:{
                S: stage_value 
            } 
        },
        TableName:ddbtable,
        AttributesToGet: [ USERS_DYNAMODB_TABLE, CREATORS_DYNAMODB_TABLE, CREATORS_DETAILS_DYNAMODB_TABLE, QUESTIONS_DYNAMODB_TABLE, GOOGLE_CLIENT_ID, STRIPE_API_KEY]
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
    
    if (STAGES.indexOf(stage) >= 0) {
        loadConfig(config_table, stage, context, function(env_config){

            //set the table
            user_table = env_config["Item"][USERS_DYNAMODB_TABLE]["S"];
            creator_table = env_config["Item"][CREATORS_DYNAMODB_TABLE]["S"];
            creator_details_table = env_config["Item"][CREATORS_DETAILS_DYNAMODB_TABLE]["S"];
            question_table = env_config["Item"][QUESTIONS_DYNAMODB_TABLE]["S"];
            google_client_id = env_config["Item"][GOOGLE_CLIENT_ID]["S"];

            stripe = require('stripe')(env_config.Item.stripe_api_key.S);

            var token = event.body.token;
            var filename = event.body.filename;
            var asker_id = event.body.asker_id;
            var answerer_id = event.body.answerer_id;
            var stripe_token = event.body.stripe_token;
            var type = event.body.type;
            var question_text = event.body.question_text;


            if (token === undefined || token === null || token === '') {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            if (type === undefined || type === null || type === '') {
                var error = new Error("type is either null or undefined");
                return callback(error);
            }

            if (type != "text" && type != "video") {
                var error = new Error("type is invalid");
                return callback(error);
            }

            if (question_text === undefined || question_text === null || question_text === '') {
                var error = new Error("question_text is either null or undefined or invalid");
                return callback(error);
            }

            if (type === "video"){
                if (filename === undefined || filename === null || filename === '') {
                    var error = new Error("filename is either null or undefined");
                    return callback(error);
                }
            }

            if (asker_id === undefined || asker_id === null || asker_id === '') {
                var error = new Error("asker_id  is either null or undefined");
                return callback(error);
            }

            if (answerer_id === undefined || answerer_id === null || answerer_id === '') {
                var error = new Error("answerer_id is either null or undefined");
                return callback(error);
            }

            if (stripe_token === undefined || stripe_token === null || stripe_token === '') {
                var error = new Error("stripe_token is either null or undefined");
                return callback(error);
            }

            var params = {
                token : token, 
                asker_user_id : asker_id, 
                filename : filename, 
                creator_id : answerer_id,
                stripe_token : stripe_token, 
                question_text : question_text,
                type : type
            }

            async.waterfall([

                async.apply(verifyToken, params),
                verifyAskerUserId,
                getAnswerer,
                chargeCustomer,
                getAnswererDetails,
                makeQuestion,
                updateAnswerer,
                notify

            ], function(err, done) {
                if (err) {
                    return callback(err);
                } else {
                    return callback(null, done.question);
                }
            });

        });

    } else {
        var error = new Error("Invalid Stage.");
        return callback(error);
    }

}

function verifyToken(params, callback) {

    var token = params.token;

    verifier.verify(token, google_client_id, function (err, tokenInfo) {
      if (!err) {
        var data = tokenInfo;
        params.asker_google_id = tokenInfo.sub;
        return callback(null, params);
      } else {
        var error = new Error("Invalid Token");
        return callback(error);
      }
    });

}

function verifyAskerUserId (params, callback) {

    var parameters = {
        TableName : user_table,
        Key : { "google_id" : params.asker_google_id }
    }

    docClient.get(parameters, function(err, user_item) {
        if (err) {
            return callback(err);
        } else {
            var user = user_item['Item'];
            if (user['user_id'] === params.asker_user_id) {
                var asker_apns_token = user['asker_apns_token'];
                params.asker_apns_token = asker_apns_token;
                params.asker_name = user['name'];
                params.asker_profile_pic = user['profile_pic']
                params.customer_id = user['customer_id'];
                return callback(null, params);
            } else {
                var error = new Error("user_id doesn't match with the provided token");
                return callback(error);
            }
        }
    });

}

//this shouldn't even be here -> they only come here if the creator can accept questions 
function getAnswerer(params, callback ) {
    
    var parameters = {
        TableName : creator_table,
        Key : { "creator_id" : params.creator_id }
    }

    docClient.get(parameters, function(err, creator_item) {
        if (err) {
            return callback(err);
        } else {
            var creator = creator_item['Item'];
            if (creator != undefined) {
                    //figure out how to get answerer token -> save the answerers google id here 
                    var answerer_google_id = creator['google_id'];
                    var price = creator['price'];
                    params.price = price;
                    params.answerer_google_id = answerer_google_id;
                    params.answerer_name = creator['name'];
                    params.answerer_profile_pic = creator['profile_pic'];
                    return callback(null, params);

            } else {
                var error = new Error("creator not found")
                return callback(error);
            }
        }
    });

}

function chargeCustomer(params, callback) {

    if (params.stripe_token === 'Free' || params.stripe_token.length === 4) {
        return callback(null, params);
    } else {
        console.log("2", params.stripe_token)
        if (params.price != undefined) {
            var amt = parseFloat(params.price).toFixed(2) * 100;
            var charge = stripe.charges.create({
              amount: amt, // Amount in cents
              currency: "usd",
              source: params.stripe_token,
              customer: params.customer_id,
              description: "You&A Question Charge"
            }, function(err, charge) {
                if (err) {
                    return callback(err);
                } else {
                    return callback(null, params);
                }
            });
        } else {
            var error = new Error("couldn't set the price");
            return callback(error);
        }
    }

}

function getAnswererDetails(params, callback) {

    var parameters = {
        TableName : creator_details_table,
        Key : {
            "creator_id" : params.creator_id
        }
    }

    docClient.get(parameters, function(err, creator_details_item) {
        if (err) {
            return callback(err);
        } else {
            var creator_details = creator_details_item['Item'];
            if (creator_details != undefined) {
                params.creator = creator_details;
                //if this will be the 10th pending question notify the youtuber and disable
                if (creator_details.pending_questions === 19) {
                    //disable this creators account and send them a notification -> disabeled  but still have to notify
                        var parameters2 = {
                            TableName : creator_table,
                            Key : {
                                "creator_id" : params.creator_id
                            },
                            UpdateExpression : "set #can_accept = :can_accept",
                            ExpressionAttributeNames : {
                                "#can_accept" : "can_accept"
                            },
                            ExpressionAttributeValues : {
                                ":can_accept" : 0
                            },
                            ReturnValues:"ALL_NEW"
                        }

                        docClient.update(parameters2, function(err, data) {
                            if (err) {
                                return callback(err);
                            } else {
                                params.is_queue_blocked = true;
                                return callback(null, params);
                            }
                        });

                } else {
                    return callback(null, params);
                }

            } else {
                var error = new Error("creator details not found");
                return callback(error);
            }
        }
    });

    
}


function makeQuestion(params, callback) {

    var question = {
        question_id : generateUniqueId(),
        asker_id : params.asker_user_id,
        answerer_id : params.creator_id, 
        type: params.type,
        asker_profile_pic : params.asker_profile_pic, 
        answerer_profile_pic : params.answerer_profile_pic,
        creation_date : getDateTime(),
        status : "pending", 
        price : params.price,
        asker_name : params.asker_name, 
        answerer_name : params.answerer_name,
        question_text : params.question_text
    }

    if (params.type === "video")  {
        question.filename = params.filename;
        question.thumbnail = generateThumbnailName(params.filename);
    }

    var parameters = {
        TableName : question_table,
        Item : question
    }

     docClient.put(parameters, function(err) {
        if (err) {
            return callback(err);
        } else {
            params.question = question;
            return callback(null, params);
        }
     });

}

function updateAnswerer(params, callback) {

    var pending_questions = params.creator.pending_questions;
    var questions_to_date = params.creator.questions_to_date;
    pending_questions++;
    questions_to_date++;

    var parameters = {
        TableName: creator_details_table,
        Key:{
            "creator_id" : params.creator_id
        },
        UpdateExpression: "set #pending_questions = :pending_questions, #questions_to_date = :questions_to_date",
        ExpressionAttributeNames:{
            "#questions_to_date" : "questions_to_date",
            "#pending_questions" : "pending_questions"
        },
        ExpressionAttributeValues:{
            ":questions_to_date" : questions_to_date, 
            ":pending_questions" :  pending_questions
        },
        ReturnValues:"ALL_NEW"
    };

    docClient.update(parameters, function(err, data) {
        if (err) {
            return callback(err);
        } else {
            return callback(null, params);
        }
    });
}

function generateMessage(title) {
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
    return message;
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
                var title = "You've just recieved a question.";
                var message = generateMessage(title);
                var subject = "Please answer it as soon as you possible.";

                sns.publish({

                    TargetArn: user['sns_endpoint_arn'],
                    Message: message,
                    MessageStructure : 'json',
                    Subject: subject

                }, function(err2, data) {
                    if (err2) {
                        //even if endpoint is disabled
                        return callback(null, params);
                    } else {
                        if (params.is_queue_blocked) {

                            var title = "Your questions queue is now blocked. Please answer questions to automatically unlock it.";
                            var message = generateMessage(title);
                            var subject = "Please start answering questions.";

                            sns.publish({
                                TargetArn: user['sns_endpoint_arn'],
                                Message: message,
                                MessageStructure : 'json',
                                Subject: subject
                            }, function(err3, data2) {
                                if (err3) {
                                    return callback(err3);
                                } else {
                                    return callback(null, params);
                                }
                            });

                        } else {
                            return callback(null, params);
                        }
                    }
                });

            } else {
                return callback(null, params);
            }
        }
    });


}