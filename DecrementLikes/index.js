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
            var answer_id = event.body.answer_id; 

            if (token === undefined || token === null || token === '') {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            if (answer_id === undefined || answer_id === null || answer_id === '') {
                var error = new Error("answer_id Id is either null or undefined");
                return callback(error);
            }

            var info = {
                token : token, 
                answer_id : answer_id
            }

            async.waterfall([
                async.apply(verifyToken, info),
                updateAnswer
            ], function(err, done) {
                if (err) {
                    return callback(err);
                } else {
                    res = { "status" : "message unliked successfully"}
                    return callback(null, res);
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
        info.liker_google_id = tokenInfo.sub;
        return callback(null, info);
      } else {
        var error = new Error("Invalid Token");
        return callback(error);
      }
    });

}

function updateAnswer(info, callback) {
    var params = {
        TableName : answer_table,
        Key : {
            "answer_id": info.answer_id
        },
        UpdateExpression : "set likes =  likes - :p",
        ExpressionAttributeValues:{
            ":p" : 1
        },
        ReturnValues:"ALL_NEW"
    };

    docClient.update(params, function(err, data) {
        if (err) {
            return callback(err);
        } else {
            info.answer = data.Attributes;
            return callback(null, info);
        }
    });
}

