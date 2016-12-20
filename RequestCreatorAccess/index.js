var aws = require('aws-sdk');
aws.config.update({region: 'us-east-1'});
var async = require('async');
var verifier = require('google-id-token-verifier');
var request = require('request');
var nodemailer = require('nodemailer');
var docClient = new aws.DynamoDB.DocumentClient();
var ddb = new aws.DynamoDB();

var user_table = '';
var creator_table = '';
var creator_details_table = '';
var google_client_id = '';
var stripe = '';

var USERS_DYNAMODB_TABLE = "users_dynamodb_table";
var CREATORS_DYNAMODB_TABLE = "creators_dynamodb_table";
var CREATORS_DETAILS_DYNAMODB_TABLE = "creator_details_dynamodb_table";
var GOOGLE_CLIENT_ID = "google_client_id";
var STRIPE_API_KEY = "stripe_api_key";
var CONFIG_TABLE = 'lambda_config';
var STAGES = ['prod', 'devo', 'test'];
var CREATOR_ID_PREFIX = "_c";

function genRand() {
    return Math.floor(Math.random()*89999+10000);
}

function generateUUID(google_id) {
    return genRand().toString() + google_id + genRand().toString();
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
        AttributesToGet: [ USERS_DYNAMODB_TABLE, CREATORS_DYNAMODB_TABLE, CREATORS_DETAILS_DYNAMODB_TABLE, GOOGLE_CLIENT_ID, STRIPE_API_KEY]
    }

    ddb.getItem(params, function(err, data) {
        if (err) {
            var message = "Couldn't get config from DynamoDB";
            console.log(message);
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
        loadConfig(CONFIG_TABLE, stage, context, function(env_config){

            //set the table
            user_table = env_config.Item.users_dynamodb_table.S;
            creator_table = env_config.Item.creators_dynamodb_table.S;
            creator_details_table = env_config.Item.creator_details_dynamodb_table.S;
            google_client_id = env_config.Item.google_client_id.S;
            stripe = require('stripe')(env_config.Item.stripe_api_key.S);

            var access_token = event.body.token;
            var statistics = event.body.statistics;

            if (access_token === undefined || access_token === null || access_token === '') {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            if (statistics === undefined || statistics === null || statistics === '') {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            async.waterfall([
                async.apply(verifyAccessToken, access_token, statistics),
                ifUserExistsReturnInfo, 
                makeCreator,
                signUserUpIfNecessary, 
                updateUserIfNecessary,
                makeCreatorDetails
            ], function(err, done) {
                if (err) {
                    return callback(err);
                } else {
                    var response = {
                        'message' : 'Your Creator Account is awating approval. We will get back to you within a few hours. In the mean time you can log in test our user app.',
                        'data' : done
                    }
                    return callback(null, response);
                }
            });

        });

    } else {
        var error = new Error("Ashish, I knew you would try this. Better luck next time.");
        return callback(error);
    }

}

function verifyAccessToken(token, statistics, callback) {

    var url = 'https://www.googleapis.com/oauth2/v1/userinfo?access_token=' + token;
    request(url, function(error, response, body){
        if (!error && response.statusCode == 200) {
            var data = JSON.parse(body);
            return callback(null, data, statistics);
        } else {
            if (response.statusCode != 200) {
                console.log(body);
                var error = new Error(body);
                return callback(error);
            }
            else {
                return callback(error);
            }
        }
    });

}

function ifUserExistsReturnInfo(data, statistics, callback) {

    var google_id = data.id;
    var params = {
        TableName : user_table,
        Key : { "google_id" : google_id }
    }
    console.log(params);
    console.log(data, "user");

    docClient.get(params, function(err, user_item) {
        if (err) {
            return callback(err);
        } else {
            var user = user_item['Item'];
            if (user != undefined && user['google_id'] != undefined) {
                if (user['creator_id'] != undefined) {
                    var error = new Error("You're already a creator");
                    return callback(error);
                } else {
                    var hasUser = true; 
                    return callback(null, data, hasUser, statistics); 
                }
            }
            else {
                var hasUser = false;
                return callback(null, data, hasUser, statistics);
            }
        }
    });

}

function makeCreator(data, hasUser, statistics, callback){

    var creator = {

        'name' : data.name,
        'creator_id' : generateUUID(data.id) + CREATOR_ID_PREFIX,
        'google_id' : data.id, 
        'email' : data.email, 
        'tag_line' : "Ask me questions!",
        'profile_pic' : data.picture,
        'price' : "10.00",
        'rating' : -1,
        'is_approved_creator' : 0,
        'num_ratings' : 0,
        'can_accept' : 0,
        'reviews' : []

    };

    console.log(1);
    var params = {
        TableName : creator_table, 
        Item : creator
    };

    docClient.put(params, function(err) {
        if (err) {
            return callback(err);
        } else {
            if (hasUser) {
                var shouldSignUp = false; 
                return callback(null, data, shouldSignUp, creator.creator_id, statistics)
            } else {
                var shouldSignUp = true; 
                return callback(null, data, shouldSignUp, creator.creator_id, statistics);
            }
        }
    });

}


function signUserUpIfNecessary(data, shouldSignUp, creator_id, statistics, callback) {
    //Bad thing to do. Ignoring the case where this write succeeds but the creator write fails and this user points to a non existent creator
    var to_bo_creator_id = generateUUID(data.id) + CREATOR_ID_PREFIX;
    var is_approved_creator =  false;

    if (shouldSignUp) {
        //The user needs to be sigend up for the first time 
        stripe.customers.create(
          { email: data.email },
          function(err, customer) {
            if (err) {
                return callback2(err);
            } else {
                var user = {
                    'creation_date' : getDateTime(),
                    'google_id' : data.id,
                    'user_id' : generateUUID(data.id),
                    'email' : data.email, 
                    'is_approved_creator' : is_approved_creator, 
                    'name' : data.name, 
                    'profile_pic' : data.picture,
                    'cover_pic' : data.picture,
                    'creator_id' : creator_id, 
                    'apns_token' : 'declined',
                    'customer_id' : customer.id
                }

                var params = {
                    TableName : user_table,
                    Item : user
                }

                docClient.put(params, function(err) {
                    if (err) {
                        return callback(err);
                    } else {
                        var shouldUpdate = false; 
                        return callback(null, data.id, shouldUpdate, creator_id, statistics, email);
                    }
                });
            }
          }
        );

    } else {
        //Update the user to have a creator id 
        var shouldUpdate = true; 
        return callback(null, data.id, shouldUpdate, creator_id, statistics, data.email);
  }

}

function updateUserIfNecessary(google_id, shouldUpdate, creator_id, statistics, email, callback) {
    var is_approved_creator = false;
    if (shouldUpdate) {
        var params = {
            TableName: user_table,
            Key:{
                "google_id": google_id
            },
            UpdateExpression: "set #creator_id = :creator_id, #is_approved_creator = :is_approved_creator",
            ExpressionAttributeNames:{
                "#creator_id" : "creator_id",
                "#is_approved_creator" : "is_approved_creator"
            },
            ExpressionAttributeValues:{
                ":creator_id" : creator_id,
                ":is_approved_creator" : is_approved_creator
            },
            ReturnValues:"ALL_NEW"
        };

        docClient.update(params, function(err, data) {
            if (err) {
                return callback(err);
            } else {
                return callback(null, creator_id, google_id, statistics, email);
            }
        });
    } else {
        return callback(null, creator_id, google_id, statistics, email);
    }
}

function makeCreatorDetails(creator_id, google_id, statistics, email, callback) {

    var creator_details = {
        'creator_id' : creator_id,
        'google_id' : google_id,
        'questions_to_date' : 0,
        'answers_to_date' : 0,
        'pending_questions' : 0,
        'balance' : "0.00",
        'last_balance_addition' : "0.0",
        'last_balance_addition_date' : getDateTime(),
        'ratio' : 1
    }

    var params = {
        TableName : creator_details_table,
        Item: creator_details
    }

    docClient.put(params, function(err) {
        if (err) {
            return callback(err);
        } else {
            return callback(null, creator_details, email); 
        }
    });
}

function sendEmail(creator_details, email, callback) {
    var ses = new AWS.SES({
        apiVersion: '2010-12-01'
    });

    var email_text = '<body><h2>Welcome!</h2><h5> Thank you for signing up to use You&A!</h5></body>';

    ses.sendEmail({
        Source: 'Mehul Patel (mehul@youna.io)',
        Destination: {
            ToAddresses: [email]
        },
        Message: {
            Body: {
                Html: {
                    Data: email_text
                },
                Text: {
                    Data: email_text
                }
            },
            Subject: {
                Data: 'Confirmation'
            }
        }

    }, function (err, data) {
        if (err) {
            callback(err);
        } else {
            callback(null, creator_details);
        }

    });
}
