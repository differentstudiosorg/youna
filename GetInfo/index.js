var aws = require('aws-sdk');
aws.config.update({region: 'us-east-1'});
var async = require('async');
var verifier = require('google-id-token-verifier');
//currently store the key here for faster development but then move it to the database 
var stripe = '';
var docClient = new aws.DynamoDB.DocumentClient();
var ddb = new aws.DynamoDB();
var user_table = '';
var creator_table = '';
var answer_table = '';
var question_table = '';
var google_client_id = '';
var config_table = 'lambda_config';
var STAGES = ['prod', 'devo', 'test'];
var DEFAULT_IMG = "https://s3.amazonaws.com/defaultstuff/default.jpg";

function genRand() {
    return Math.floor(Math.random()*89999+10000);
}

function generateUUID(google_id) {
    return genRand().toString() + google_id + genRand().toString();
}

function loadConfig(ddbtable, stage_value, context, callback) {

    var params = {
        Key:{
            stage:{
                S: stage_value 
            } 
        },
        TableName:ddbtable,
        AttributesToGet: ['users_dynamodb_table', 'creators_dynamodb_table', 'google_client_id', 'answers_dynamodb_table', 'questions_dynamodb_table', 'stripe_api_key']
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

function parseQuestionsAndAnswers(user) {
    var videos = [];
    if (user.questions != undefined) {
        for (var i = 0; i < user.questions.length; i++) {
            var video = {
                question : user.questions[i]
            };
            var question_id = user.questions[i].question_id;
            if (user.answers != undefined) {
                for  (var j = 0; j < user.answers.length; j++) {
                    if (user.answers[j].question_id === question_id)  {
                        video.answer = user.answers[j]
                    }
                }
            }
            videos.push(video);
        }
    }

    videos.sort(function(video1, video2) {
        function parseDate(str) {
            var parts = str.match(/(\d+)/g);
            return new Date(parts[2], parts[0]-1, parts[1]);
        }
        var diff = parseDate(video1.question.creation_date) - parseDate(video2.question.creation_date);
        if (diff > 0) return -1;
        else return 1; 
    });

    user.videos = videos;
    return user;
}

//inefficient for now
function shuffle(array) {
  var currentIndex = array.length, temporaryValue, randomIndex;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {

    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}

//very inefficient since it's copying the previous function
function parseQuestionsAndAnswersFeed(user) {
    var videos = [];
    //only get answered questions
    if (user.questions != undefined) {
        for (var i = 0; i < user.questions.length; i++) {
            if (user.questions[i].price === 'Free') {
                var asker_name = user.questions[i].asker_name;
                if (asker_name != undefined) {
                    var asker_name_split = asker_name.split(" ");
                    if (asker_name_split.length === 2) {
                        user.questions[i].asker_name = asker_name_split[0] + " " + asker_name_split[1][0];
                    }
                }
                var video = {
                    question : user.questions[i]
                };
                var question_id = user.questions[i].question_id;
                if (user.answers != undefined) {
                    for  (var j = 0; j < user.answers.length; j++) {
                        if (user.answers[j].question_id === question_id)  {
                            video.answer = user.answers[j];
                            videos.push(video);
                        }
                    }
                }
            }
        }
    }

    videos.sort(function(video1, video2) {
        function parseDate(str) {
            var parts = str.match(/(\d+)/g);
            return new Date(parts[2], parts[0]-1, parts[1]);
        }
        var diff = parseDate(video1.question.creation_date) - parseDate(video2.question.creation_date);
        if (diff > 0) return -1;
        else return 1; 
    });

    user.feed = shuffle(videos);
    return user;
}

function getStage(invokedFunctionArn) {

     var invokedFunctionArnArray = invokedFunctionArn.split(":");
     var stage = invokedFunctionArnArray[invokedFunctionArnArray.length - 1];
     return stage;

}

function setNotificationNumber(user) {
    var notification_number = 0;
    if (user.answers != undefined) {
        for (var i = 0; i < user.answers.length; i++) {
            if(user.answers[i].rating === -1) notification_number++;
        }
    }
    user.notification_bubble_number = notification_number;
    return user;
}

function removeCreatorEmails(creators) {
    for(var i = 0; i < creators.length; i++){
        if (creators[i].email != undefined) {
            delete creators[i].email;
        }
    }
    return creators;
}

exports.handler = function(event, context, callback) {

    var invokedFunctionArn = context.invokedFunctionArn;
    var stage = getStage(invokedFunctionArn);
    console.log(stage, invokedFunctionArn);
    if (STAGES.indexOf(stage) >= 0) {
        loadConfig(config_table, stage, context, function(env_config){

            //set the table
            user_table = env_config.Item.users_dynamodb_table.S;
            creator_table = env_config.Item.creators_dynamodb_table.S;
            google_client_id = env_config.Item.google_client_id.S;
            answer_table = env_config.Item.answers_dynamodb_table.S;
            question_table = env_config.Item.questions_dynamodb_table.S;
            stripe = require('stripe')(env_config.Item.stripe_api_key.S);

            var token = event.query.token;

            if (token === undefined || token === null || token === '') {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            async.waterfall([
                async.apply(verifyToken, token),
                ifUserExistsReturnInfo, 
                signUserUpIfNecessary,
                getAnswers,
                getQuestions,
                getAllCreators,
                getAllAnswers,
                getAllQuestions
            ], function(err, done) {
                if (err) {
                    return callback(err);
                } else {
                    done.user = parseQuestionsAndAnswers(done.user);
                    done.user = setNotificationNumber(done.user);
                    done.creators = removeCreatorEmails(done.creators);
                    done = parseQuestionsAndAnswersFeed(done);
                    delete done.user.answers;
                    delete done.user.questions;
                    delete done.user.customer_id;
                    delete done.questions;
                    delete done.answers;

                    return callback(null, done);
                }
            });

        });

    } else {
        var error = new Error("Invalid stage.");
        return callback(error);
    }

}

function verifyToken(token, callback2) {

    verifier.verify(token, google_client_id, function (err, tokenInfo) {
      if (!err) {
        var data = tokenInfo;
        if (tokenInfo.email === undefined) {
            var error = new Error("Can't use this gmail account");
            callback2(error);
        } else {
            callback2(null, tokenInfo);
        }
      } else {
        console.log(token);
        var error = new Error("Invalid Token");
        return callback2(error);
      }
    });

}

function ifUserExistsReturnInfo(data, callback2) {

    var google_id = data.sub;
    var params = {
        TableName : user_table,
        Key : { "google_id" : google_id }
    }

    docClient.get(params, function(err, user_item) {
        if (err) {
            return callback2(err);
        } else {
            var user = user_item['Item'];
            if (user != undefined && user['google_id'] != undefined) {
                data.user = user;
                callback2(null, data, false);
            }
            else {
                callback2(null, data, true);
            }
        }
    });

}

function signUserUpIfNecessary(data, shouldSignUp, callback2) {
    apns_token = 'declined';
    if (shouldSignUp) {
        //create customer 
        stripe.customers.create(
          { email: data.email },
          function(err, customer) {
            if (err) {
                return callback2(err);
            } else {

                var user = {
                    'creation_date' : Date.now(),
                    'google_id' : data.sub,
                    'user_id' : generateUUID(data.sub),
                    'email' : data.email, 
                    'is_approved_creator' : false, 
                    'name' : data.name, 
                    'profile_pic' : data.picture,
                    'cover_pic' : data.picture,
                    'apns_token' : apns_token,
                    'customer_id' : customer.id
                }

                var params = {
                    TableName : user_table,
                    Item : user
                }

                docClient.put(params, function(err) {
                    if (err) {
                        return callback2(err);
                    } else {
                        var isNewUser = shouldSignUp;
                        return callback2(null, user, isNewUser);
                    }
                });
            }
          }
        );

    } else {

        if (data.name != undefined && data.user.customer_id != undefined) {
            var params = {
                TableName: user_table,
                Key:{
                    "google_id" : data.sub
                },
                UpdateExpression: "set #email = :email, #profile_pic = :profile_pic, #name = :name",
                ExpressionAttributeNames : {
                    "#email" : "email",
                    "#profile_pic" : "profile_pic",
                    "#name" : "name"
                },
                ExpressionAttributeValues:{
                    ":email" : data.email,
                    ":profile_pic" : data.picture,
                    ":name" : data.name
                },
                ReturnValues:"ALL_NEW"
            };
            docClient.update(params, function(err, updated_data){
                if (err) {
                    return callback2(err);
                } else {
                    var isNewUser = shouldSignUp;
                    return callback2(null, updated_data.Attributes, isNewUser);
                }
            });
        }
        else if (data.user.customer_id === undefined) {
            stripe.customers.create(
              { email: data.email },
              function(err, customer) {
                if (err) {
                    return callback2(err);
                } else {
                    var params = {
                        TableName: user_table,
                        Key:{
                            "google_id" : data.sub
                        },
                        UpdateExpression: "set #customer_id = :customer_id",
                        ExpressionAttributeNames : {
                            "#customer_id" : "customer_id"
                        },
                        ExpressionAttributeValues:{
                            ":customer_id" : customer.id
                        },
                        ReturnValues:"ALL_NEW"
                    };
                    docClient.update(params, function(err, updated_data){
                        if (err) {
                            return callback2(err);
                        } else {
                            var isNewUser = shouldSignUp;
                            return callback2(null, updated_data.Attributes, isNewUser);
                        }
                    });
                }
              }
            );
        } else {
            var isNewUser = shouldSignUp;
            return callback2(null, data.user, isNewUser);
        }

    }

}

function getAnswers(user, isNewUser, callback){

    if (!isNewUser) {
        var asker_id = user.user_id;
        var params = {
            TableName: answer_table,
            IndexName: "asker_id_index",
            KeyConditionExpression: "asker_id = :asker_id",
            ExpressionAttributeValues: {
                ":asker_id": asker_id
            }
        };

        docClient.query(params, function(err, data) {
            if (err) {
                return callback(err);
            }
            else {
                user.answers = data['Items'];
                return callback(null, user, isNewUser);
            }
        });
    } else {
        return callback(null, user, isNewUser);
    }
}

function getQuestions(user, isNewUser, callback){

    if (!isNewUser) {
        var asker_id = user.user_id;
        var params = {
            TableName: question_table,
            IndexName: "asker_id_index",
            KeyConditionExpression: "asker_id = :asker_id",
            ExpressionAttributeValues: {
                ":asker_id": asker_id
            }
        };

        docClient.query(params, function(err, data) {
            if (err) {
                return callback(err);
            }
            else {
                user.questions = data['Items'];
                return callback(null, user);
            }
        });

    } else {
        return callback(null, user);
    }

}

function getAllCreators(user, callback) {

    var params = {
        TableName: creator_table,
        IndexName: "is_approved_creator_index",
        KeyConditionExpression: "is_approved_creator = :is_approved_creator",
        ExpressionAttributeValues: {
            ":is_approved_creator": 1
        }
    };

    docClient.query(params, function(err, data) {
        if (err) {
            return callback(err);
        }
        else {
            var response = {
                "user" : user,
                "creators" : data.Items
            };
            return callback(null, response);
        }
    });
}

function getAllAnswers(response, callback) {
    var params = {
        TableName: answer_table
    };

    docClient.scan(params, function(err, data) {
        if (err) {
            return callback(err)
        } else {
            response.answers = data.Items;
            return callback(null, response);
        }
    });
}

function getAllQuestions(response, callback) {
    var params = {
        TableName: question_table
    };

    docClient.scan(params, function(err, data) {
        if (err) {
            return callback(err)
        } else {
            response.questions = data.Items
            return callback(null, response);
        }
    });
}
