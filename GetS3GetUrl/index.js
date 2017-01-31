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
            var video_id = event.query.video_id;
            var token = event.query.token;
            var isThumbnail = false; 

            if (type === undefined || type === "" || TYPES.indexOf(type) < 0) {
                var error = new Error("Invalid type. Must be either a question or an answer");
                return callback(error);
            }

            if (video_id === undefined || video_id === "") {
                var error = new Error("Video id is either null or undefined");
                return callback(error);
            }

            if (token === undefined || token === "") {
                var error = new Error("Token is either null or undefined");
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

            console.log(video_id, type);

            async.waterfall([
                async.apply(verifyToken, token, video_id, isThumbnail),
                getUser,
                checkIfUserCanAccessVideo, 
                getS3GetUrl
            ], function(err, done) {
                if (err) {
                    return callback(err);g
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

function verifyToken(token, video_id, isThumbnail, callback) {

    verifier.verify(token, google_client_id, function (err, tokenInfo) {
      if (!err) {
        var data = tokenInfo;
        return callback(null, tokenInfo.sub, video_id, isThumbnail);
      } else {
        var error = new Error("Invalid Token");
        return callback(error);
      }
    });

}

function getUser(google_id, video_id, isThumbnail, callback) {

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
                return callback(null, video_id, user['user_id'], user['creator_id'], isThumbnail);
            }
            else {
                var error = new Error("The user requesting the url doesn't exist in our records.");
                return callback(error);
            }
        }
    });

}

function checkIfUserCanAccessVideo(video_id, user_id, creator_id, isThumbnail, callback) {
    // Pull up the answer. Check if the asker id matches the user_id. If so let the user access it. If not throw an error and peace our 
    var key = {};
    key[video_id_string] = video_id;

    var params = {
        TableName : video_table,
        Key : key
    }

    docClient.get(params, function(err, video_item) {
        if (err) {
            return callback(err);
        } else {
            var obj = video_item['Item'];
            if (obj != undefined && obj[video_id_string] != undefined) {
                //NEED TO FIX THIS - any answer can be viewed right now
                if (obj['price'] === 'Free' || video_table === "answers") {
                    var file = (isThumbnail) ? 'thumbnail' : 'filename';
                    return  callback(null, obj[file]);
                } else {
                    if (obj['asker_id'] === user_id || obj['answerer_id'] === creator_id) {
                        var file = (isThumbnail) ? 'thumbnail' : 'filename';
                        return callback(null, obj[file]);
                    } else {
                        var error = new Error("The user doesn't have access to this video/thumbanil");
                        return callback(error);
                    }
                }
            }
            else {
                var error = new Error("The video you're trying to access doesn't exist");
                return callback(error);
            }
        }
    });
}

function getS3GetUrl(name, callback) {
    //Need a way to fallback on the non-transcoded version if the job is still running and the url for that obj is requested 
    //Goona get all .mov files -> what can we convert it to 
    var filename = "transcoded/" + name;
    var s3 = new aws.S3();

    var params = {Bucket: s3_bucket, Key: filename, Expires: 900000};
    var url = { 
        'url' : s3.getSignedUrl('getObject', params)
    };

    return callback(null, url);
}