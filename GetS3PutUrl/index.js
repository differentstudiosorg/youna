var aws = require('aws-sdk');
aws.config.update({region: 'us-east-1'});
var async = require('async');
var verifier = require('google-id-token-verifier');
var docClient = new aws.DynamoDB.DocumentClient();
var ddb = new aws.DynamoDB();
var s3_bucket = '';
var user_table = '';
var google_client_id = '';

var USERS_DYNAMODB_TABLE = "users_dynamodb_table";
var QUESTIONS_S3_BUCKET = "questions_s3_bucket";
var ANSWERS_S3_BUCKET = "answers_s3_bucket";
var CONFIG_TABLE = 'lambda_config';
var S3_BUCKET_SUFFIX = 's_s3_bucket';
var GOOGLE_CLIENT_ID = 'google_client_id';
var STAGES = ['prod', 'devo', 'test'];
var TYPES = ['question', 'answer'];

function loadConfig(ddbtable, stage_value, context, callback) {

    var params = {
        Key:{
            stage:{
                S: stage_value 
            } 
        },
        TableName:ddbtable,
        AttributesToGet: [USERS_DYNAMODB_TABLE, QUESTIONS_S3_BUCKET, ANSWERS_S3_BUCKET, GOOGLE_CLIENT_ID]
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
        loadConfig(CONFIG_TABLE, stage, context, function(env_config){

            var type = event.query.type; 
            var filename = event.query.filename;
            var token = event.query.token;

            if (type === undefined || type === "" || TYPES.indexOf(type) < 0) {
                var error = new Error("Invalid type. Must be either a question or an answer");
                return callback(error);
            }

            if (filename === undefined || filename === "") {
                var error = new Error("Invalid filename");
                return callback(error);
            }

            if (token === undefined || token === "") {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            //set the table
            var bucket_table_heading = type + S3_BUCKET_SUFFIX;
            s3_bucket = env_config["Item"][bucket_table_heading]["S"];
            user_table = env_config["Item"][USERS_DYNAMODB_TABLE]["S"];
            google_client_id = env_config["Item"][GOOGLE_CLIENT_ID]["S"];

            async.waterfall([
                async.apply(verifyToken, token, filename),
                checkIfUserExists, 
                getS3PutUrl
            ], function(err, done) {
                if (err) {
                    return callback(err);
                } else {
                    return callback(null, done);
                }
            });


        });

    } else {
        var error = new Error("Invalid Stage.");
        return callback(error);
    }

}


function verifyToken(token, filename, callback) {

    verifier.verify(token, google_client_id, function (err, tokenInfo) {
      if (!err) {
        var data = tokenInfo;
        return callback(null, tokenInfo, filename);
      } else {
        var error = new Error("Invalid Token");
        return callback(error);
      }
    });

}

function checkIfUserExists(tokenInfo, filename, callback) {

    var google_id = tokenInfo.sub;
    var params = {
        TableName : user_table,
        Key : { "google_id" : google_id }
    }

    docClient.get(params, function(err, user_item) {
        if (err) {
            return callback(err);
        } else {
            var user = user_item['Item'];
            if (user != undefined && user['google_id'] != undefined) {
                return callback(null, filename);
            }
            else {
                var error = new Error("The user requesting the url doesn't exist in our records.");
                return callback(error);
            }
        }
    });

}

function getS3PutUrl(name, callback) {
    var s3 = new aws.S3();
    var filename = 'non-transcoded/' + name; 
    var params = {Bucket: s3_bucket, Key: filename, Expires: 900000};
    var url = { 
        'url' : s3.getSignedUrl('putObject', params)
    };
    return callback(null, url);
}