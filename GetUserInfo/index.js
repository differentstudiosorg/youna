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

            var user_id = event.query.user_id;

            if (user_id === undefined || user_id === null || user_id === '') {
                var error = new Error("id is either null or undefined");
                return callback(error);
            }

            user_id += "_c";

            async.waterfall([
                async.apply(findCreator, user_id), 
            ], function(err, res) {
                if (err) {
                    return callback(err);
                } else {
                    delete res.creator.email;
                    delete res.creator.google_id;
                    delete res.creator.creator_id;
                    delete res.creator.is_approved_creator;
                    delete res.creator.can_accept;
                    return callback(null, res);
                }
            });

        });

    } else {
        var error = new Error("Invalid stage.");
        return callback(error);
    }

}



function findCreator(creator_id, callback) {
    var params = {
        TableName: creator_table,
        Key: {
            'creator_id' : creator_id
        }
    };

    docClient.get(params, function(err, data) {
        if (err) {
            return callback(err);
        }
        else {
            if (data['Item'] != undefined) {
                var res = {};
                res.creator = data['Item'];
                return callback(null, res);
            } else {
                var error = new Error("Can't find question");
                return callback(error);
            }
            
        }
    });
}


