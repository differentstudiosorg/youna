var aws = require('aws-sdk');
aws.config.update({region: 'us-east-1'});
var async = require('async');
var verifier = require('google-id-token-verifier');
var docClient = new aws.DynamoDB.DocumentClient();
var ddb = new aws.DynamoDB();
var user_table = '';
var creator_table = '';
var question_table = '';
var answer_table = '';
var creator_details_table = '';
var google_client_id = '';
var config_table = 'lambda_config';

//Global config variables 
var USERS_DYNAMODB_TABLE = "users_dynamodb_table";
var CREATORS_DYNAMODB_TABLE = "creators_dynamodb_table";
var CREATORS_DETAILS_DYNAMODB_TABLE = "creator_details_dynamodb_table";
var GOOGLE_CLIENT_ID = "google_client_id";
var QUESTIONS_DYNAMODB_TABLE = "questions_dynamodb_table";
var ASNWERS_DYNAMODB_TABLE = "answers_dynamodb_table";

var STAGES = ['prod', 'devo', 'test'];

function loadConfig(ddbtable, stage_value, context, callback) {

    var params = {
        Key:{
            stage:{
                S: stage_value 
            } 
        },
        TableName:ddbtable,
        AttributesToGet: [ USERS_DYNAMODB_TABLE, CREATORS_DYNAMODB_TABLE, CREATORS_DETAILS_DYNAMODB_TABLE, GOOGLE_CLIENT_ID, QUESTIONS_DYNAMODB_TABLE, ASNWERS_DYNAMODB_TABLE]
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

function parseQuestionsAndAnswers(user) {
    var pending_questions = [];
    var answered_questions = [];

    if (user.questions != undefined) {
        for (var i = 0; i < user.questions.length; i++) {
            var video = {};
            var question_id = user.questions[i].question_id;
            if (user.answers != undefined) {
                for  (var j = 0; j < user.answers.length; j++) {
                    if (user.answers[j].question_id === question_id)  {
                        video.answer = user.answers[j]
                    }
                }
            }
            if (video.answer === undefined) pending_questions.push(user.questions[i])
            else {
                video.question = user.questions[i];
                answered_questions.push(video);
            }
        }
    }

    pending_questions.sort(function(video1, video2) {
        function parseDate(str) {
            var parts = str.match(/(\d+)/g);
            return new Date(parts[2], parts[0]-1, parts[1]);
        }
        //ascending order
        return parseDate(video1.creation_date) - parseDate(video2.creation_date);
    });

    answered_questions.sort(function(video1, video2) {
        function parseDate(str) {
            var parts = str.match(/(\d+)/g);
            return new Date(parts[2], parts[0]-1, parts[1]);
        }
        var diff = parseDate(video1.question.creation_date) - parseDate(video2.question.creation_date);
        //descending order 
        if (diff > 0) return -1;
        else return 1; 
    });

    user.answered_questions_array = answered_questions;
    user.pending_questions_array = pending_questions;
    return user;
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
            google_client_id = env_config["Item"][GOOGLE_CLIENT_ID]["S"];
            question_table = env_config["Item"][QUESTIONS_DYNAMODB_TABLE]["S"];
            answer_table = env_config["Item"][ASNWERS_DYNAMODB_TABLE]["S"];

            var token = event.query.token; 
            var creator_id = event.query.creator_id;

            if (token === undefined || token === null || token === '') {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            if (creator_id === undefined || creator_id === null || creator_id === '') {
                var error = new Error("Creator Id is either null or undefined");
                return callback(error);
            }

            async.waterfall([
                async.apply(verifyToken, token, creator_id),
                checkIfUserIsActuallyACreator, 
                getCreator,
                getCreatorDetails,
                getAnswers,
                getQuestions
            ], function(err, done) {
                if (err) {
                    return callback(err);
                } else {
                    done.creator_details = parseQuestionsAndAnswers(done.creator_details);
                    return callback(null, done);
                }
            });

        });

    } else {
        var error = new Error("Invalid Stage.");
        return callback(error);
    }

}

function verifyToken(token, creator_id, callback) {

    verifier.verify(token, google_client_id, function (err, tokenInfo) {
      if (!err) {
        var data = tokenInfo;
        return callback(null, tokenInfo, creator_id);
      } else {
        var error = new Error("Invalid Token");
        return callback(error);
      }
    });

}

function checkIfUserIsActuallyACreator(data, creator_id, callback) {

    var google_id = data.sub;
    var params = {
        TableName : user_table,
        Key : { "google_id" : google_id }
    }

    docClient.get(params, function(err, user_item) {
        if (err) {
            return callback(err);
        } else {
            var user = user_item['Item'];
            if (user != undefined && user['creator_id'] != undefined) {
                var user_creator_id = user['creator_id']
                if (user_creator_id === creator_id) {
                    return callback(null, creator_id);
                } else {
                    var error = new Error("Creator id provided is invalid");
                    return callback(error);
                }
            }
            else {
                var error = new Error("The user is not in our database or the user isn't a creator");
                return callback(error);
            }
        }
    });

}

function getCreator(creator_id, callback) {

    var params = {
        TableName : creator_table,
        Key : {"creator_id" : creator_id}
    }

    docClient.get(params, function(err, data) {
        if (err) {
            return callback(err);
        } else {
            if (data.Item === undefined) {
                var error = new Error("Creator not found");
                return callback(error);
            } else {
                return callback(null, data.Item);
            }
        }
    });

}

function getCreatorDetails(creator, callback) {

    var params = {
        TableName : creator_details_table,
        Key : {"creator_id" : creator.creator_id}
    };

    docClient.get(params, function(err, data) {
        if (err) {
            return callback(err);
        }
        else {
            if (data.Item === undefined) {
                var error = new Error("Creator details not found");
                return callback(error);
            } else {
                var response = {
                    "creator" : creator,
                    "creator_details" : data.Item
                }
                //adding price to creator_details 
                response.creator_details.price = creator.price
                return callback(null, response);
            }
        }

    });

}

function getAnswers(creator, callback){

    var answerer_id = creator.creator.creator_id;
    var params = {
        TableName: answer_table,
        IndexName: "answerer_id_index",
        KeyConditionExpression: "answerer_id = :answerer_id",
        ExpressionAttributeValues: {
            ":answerer_id": answerer_id
        }
    };

    docClient.query(params, function(err, data) {
        if (err) {
            return callback(err);
        }
        else {
            creator.creator_details.answers = data['Items'];
            return callback(null, creator);
        }
    });

}

function getQuestions(creator, callback){

    var answerer_id = creator.creator.creator_id;
    var params = {
        TableName: question_table,
        IndexName: "answerer_id_index",
        KeyConditionExpression: "answerer_id = :answerer_id",
        ExpressionAttributeValues: {
            ":answerer_id": answerer_id
        }
    };

    docClient.query(params, function(err, data) {
        if (err) {
            return callback(err);
        }
        else {
            creator.creator_details.questions = data['Items'];
            return callback(null, creator);
        }
    });

}