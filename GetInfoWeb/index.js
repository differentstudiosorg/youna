var aws = require('aws-sdk');
aws.config.update({region: 'us-east-1'});
var async = require('async');
var verifier = require('google-id-token-verifier');
var request = require('request');
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

            var access_token = event.query.token;


            if (access_token === undefined || access_token === null || access_token === '') {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            async.waterfall([
                async.apply(verifyAccessToken, access_token),
                getUser, 
                getCreator,
                getCreatorDetails
            ], function(err, done) {
                if (err) {
                    return callback(err);
                } else {
                    var response = {
                        name : done.user.name, 
                        profile_url : done.user.profile_pic
                    }
                    if (done.creator != undefined) {
                        response.tagline = done.creator.tag_line;
                        response.paypal_email = done.creator_details.paypal_email;
                    }
                    return callback(null, response);
                }
            });

        });

    } else {
        var error = new Error("Invalid stage.");
        return callback(error);
    }

}

function verifyAccessToken(token, callback) {

    var url = 'https://www.googleapis.com/oauth2/v1/userinfo?access_token=' + token;
    request(url, function(error, response, body){
        if (!error && response.statusCode == 200) {
            var data = JSON.parse(body);
            return callback(null, data);
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

function getUser(data, callback) {

    var google_id = data.id;
    var params = {
        TableName : user_table,
        Key : { "google_id" : google_id }
    }

    var user_data = {};

    docClient.get(params, function(err, user_item) {
        if (err) {
            return callback(err);
        } else {
            var user = user_item['Item'];
            if (user != undefined) {
                user_data.user = user;
                return callback(null, user_data);
            }
            else {
                var error = new Error("User doesn't exist")
                return callback(error);
            }
        }
    });

}
 
function getCreator(user_data, callback) {

    if (user_data.user['creator_id'] != undefined) {

        var params = {
            TableName : creator_table,
            Key : { "creator_id" : user_data.user['creator_id'] }
        }

        docClient.get(params, function(err, creator_item) {
            if (err) {
                return callback(err);
            } else {
                var creator = creator_item['Item'];
                if (creator != undefined) {
                    user_data.creator = creator;
                    return callback(null, user_data);
                }
                else {
                    var error = new Error("Creator doesn't exist")
                    return callback(error);
                }
            }
        });

    } else {
        callback(null, user_data)
    }
}

function getCreatorDetails(user_data, callback) {
    if (user_data.user['creator_id'] != undefined) {

        var params = {
            TableName : creator_details_table,
            Key : { "creator_id" : user_data.user['creator_id'] }
        }

        docClient.get(params, function(err, creator_item) {
            if (err) {
                return callback(err);
            } else {
                var creator = creator_item['Item'];
                if (creator != undefined) {
                    user_data.creator_details = creator;
                    return callback(null, user_data);
                }
                else {
                    var error = new Error("Creator doesn't exist")
                    return callback(error);
                }
            }
        });

    } else {
        callback(null, user_data)
    }
}
