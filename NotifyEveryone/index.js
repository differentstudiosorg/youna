var aws = require('aws-sdk');
aws.config.update({region: 'us-east-1'});
var async = require('async');
var verifier = require('google-id-token-verifier');
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

            async.waterfall([

                getEveryone,
                notifyEveryone

            ], function(err, done) {
                if (err) {
                    return callback(err);
                } else {
                    res = { "status" : "notified"}
                    return callback(null, res);
                }
            });

        });

    } else {
        var error = new Error("Invalid Stage.");
        return callback(error);
    }

}

function getEveryone(callback) {
    var params = {
        TableName: user_table
    };

    docClient.scan(params, function(err, data) {
        if (err) {
            return callback(err)
        } else {
            var users = data.Items;
            return callback(null, users);
        }
    });
}

function notifyEveryone(users, callback) {
    var num = 0;
    var num_errors = 0;
    async.eachSeries(users, function(user, callback2) {

        if (user.sns_endpoint_arn != undefined) {

            var sns = new aws.SNS();
            var title =  "The squat rack is always free on Saturday, ask a coach about proper form on You&A.";
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

            var subject = "Message!";

            sns.publish({

                TargetArn: user.sns_endpoint_arn,
                Message: message,
                MessageStructure : 'json',
                Subject: subject

            }, function(err,data) {
                if (err) {
                    num_errors++;
                    //console.log(err, data);
                    return callback2(null);
                } else {
                    num++;
                    //console.log("SENT", data);
                    return callback2(null);
                }
            });
        } else {
            callback2(null);
        }

    }, function(err, done) {
        console.log("done", num, num_errors);
        callback(null)
    });

}

