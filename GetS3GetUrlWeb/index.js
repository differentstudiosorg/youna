var aws = require('aws-sdk');
aws.config.update({region: 'us-east-1'});
var async = require('async');
var verifier = require('google-id-token-verifier');
var docClient = new aws.DynamoDB.DocumentClient();
var ddb = new aws.DynamoDB();
var s3_bucket = '';
var user_table = '';
var video_table = '';
var video_id_string = '';
var google_client_id = '';

var USERS_DYNAMODB_TABLE = "users_dynamodb_table";
var ANSWERS_DYNAMODB_TABLE = "answers_dynamodb_table";
var QUESTIONS_DYNAMODB_TABLE = "questions_dynamodb_table";
var QUESTIONS_BUCKET = "questions_s3_bucket";
var ANSWERS_BUCKET = "answers_s3_bucket";
var QUESTIONS_THUMBNAILS_BUCKET = "questions_thumbnails_s3_bucket";
var ANSWERS_THUMBNAILS_BUCKET = "answers_thumbnails_s3_bucket";
var GOOGLE_CLIENT_ID = "google_client_id";

var QUESTION = "question";
var ANSWER = "answer";
var QUESTION_THUMBNAIL = "question_thumbnail";
var ANSWER_THUMBNAIL = "answer_thumbnail";

var CONFIG_TABLE = 'lambda_config';
var S3_BUCKET_SUFFIX = 's_s3_bucket';
var STAGES = ['prod', 'devo', 'test'];
var TYPES = [QUESTION, ANSWER, QUESTION_THUMBNAIL, ANSWER_THUMBNAIL];

function loadConfig(ddbtable, stage_value, context, callback) {

    var params = {
        Key:{
            stage:{
                S: stage_value 
            } 
        },
        TableName:ddbtable,
        AttributesToGet: [USERS_DYNAMODB_TABLE, ANSWERS_BUCKET, ANSWERS_DYNAMODB_TABLE, QUESTIONS_BUCKET, QUESTIONS_DYNAMODB_TABLE, GOOGLE_CLIENT_ID, ANSWERS_THUMBNAILS_BUCKET, QUESTIONS_THUMBNAILS_BUCKET]
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
            var isThumbnail = false; 

            if (type === undefined || type === "" || TYPES.indexOf(type) < 0) {
                var error = new Error("Invalid type. Must be either a question or an answer");
                return callback(error);
            }

            if (filename === undefined || filename === "") {
                var error = new Error("filename is either null or undefined");
                return callback(error);
            }

            //set the table
            if (type === QUESTION) {

                s3_bucket = env_config["Item"][QUESTIONS_BUCKET]["S"];
                video_table = env_config["Item"][QUESTIONS_DYNAMODB_TABLE]["S"];
                video_id_string = "question_id";

            } else if (type === QUESTION_THUMBNAIL) {

                isThumbnail = true;
                s3_bucket = env_config["Item"][QUESTIONS_THUMBNAILS_BUCKET]["S"];
                video_table = env_config["Item"][QUESTIONS_DYNAMODB_TABLE]["S"];
                video_id_string = "question_id";

            } else if (type === ANSWER_THUMBNAIL) {

                isThumbnail = true;
                s3_bucket = env_config["Item"][ANSWERS_THUMBNAILS_BUCKET]["S"];
                video_table = env_config["Item"][ANSWERS_DYNAMODB_TABLE]["S"];
                video_id_string = "answer_id";

            } else  {

                s3_bucket = env_config["Item"][ANSWERS_BUCKET]["S"];
                video_table = env_config["Item"][ANSWERS_DYNAMODB_TABLE]["S"];
                video_id_string = "answer_id";

            }

            user_table = env_config["Item"][USERS_DYNAMODB_TABLE]["S"];
            google_client_id = env_config["Item"][GOOGLE_CLIENT_ID]["S"];

            var filename_1 = "transcoded/" + filename;
            var s3 = new aws.S3();

            var params = {Bucket: s3_bucket, Key: filename_1, Expires: 900000};
            var url = { 
                'url' : s3.getSignedUrl('getObject', params)
            };

            return callback(null, url);
        });
    } else {
        var error = new Error("Invalid Stage.");
        return callback(error);
    }

}