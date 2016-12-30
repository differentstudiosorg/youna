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

var USERS_DYNAMODB_TABLE = "users_dynamodb_table";
var CREATORS_DYNAMODB_TABLE = "creators_dynamodb_table";
var CREATORS_DETAILS_DYNAMODB_TABLE = "creator_details_dynamodb_table";
var GOOGLE_CLIENT_ID = "google_client_id";

var CONFIG_TABLE = 'lambda_config';
var STAGES = ['prod', 'devo', 'test'];
var CREATOR_ID_PREFIX = "_c";

var FACEBOOK_LINK = "facebook_link";
var TWITTER_LINK = "twitter_link";
var INSTAGRAM_LINK = "instagram_link";
var YOUTUBE_LINK = "youtube_link";

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
        AttributesToGet: [ USERS_DYNAMODB_TABLE, CREATORS_DYNAMODB_TABLE, CREATORS_DETAILS_DYNAMODB_TABLE, GOOGLE_CLIENT_ID]
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

            var access_token = event.body.token;
            var email = event.body.email;
            var tag_line = event.body.tag_line;
            var links = {};
            links[FACEBOOK_LINK] = event.body[FACEBOOK_LINK];
            links[TWITTER_LINK] = (event.body[TWITTER_LINK] === "none") ? event.body[TWITTER_LINK] : "https://www.twitter.com/" + event.body[TWITTER_LINK];
            links[INSTAGRAM_LINK] = (event.body[INSTAGRAM_LINK] === "none") ? event.body[INSTAGRAM_LINK] : "https://www.instagram.com/" + event.body[INSTAGRAM_LINK];
            links[YOUTUBE_LINK] = (event.body[YOUTUBE_LINK] === "none") ? event.body[YOUTUBE_LINK] : "https://www.youtube.com/user/" + event.body[YOUTUBE_LINK];
            if (access_token === undefined || access_token === null || access_token === '') {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            if (email === undefined || email === null || email === '') {
                var error = new Error("email is either null or undefined");
                return callback(error);
            }

            if (tag_line === undefined || tag_line === null || tag_line === '') {
                var error = new Error("tag_line is either null or undefined");
                return callback(error);
            }

            async.waterfall([
                async.apply(verifyAccessToken, access_token, email, tag_line, links),
                getUser,
                updateCreator,
                updateCreatorDetails
            ], function(err, done) {
                if (err) {
                    return callback(err);
                } else {
                    var response = {
                        'message' : 'data updated'
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

function verifyAccessToken(token, email, tag_line, links, callback) {

    var url = 'https://www.googleapis.com/oauth2/v1/userinfo?access_token=' + token;
    request(url, function(error, response, body){
        if (!error && response.statusCode === 200) {
            var data = JSON.parse(body);
            return callback(null, data, email, tag_line, links);
        } else {
            if (response.statusCode != 200 && error === null) {
                var error = new Error("Invalid token");
                return callback(error);
            }
            else return callback(error);
        }
    });

}

function getUser(data, email, tag_line, links, callback) {

    console.log(data, email, tag_line, callback);
    var google_id = data.id; 
    var params = {
        TableName : user_table,
        Key : {
            google_id : google_id
        }
    }

    docClient.get(params, function(err, user_item) {
        if (err) {
            return callback(err);
        } else {
            var user = user_item['Item'];
            if (user['creator_id'] === undefined) {
                var error = new Error("Couldn't find user");
                return callback(error);
            } else {
                return callback(null, email, tag_line, user['creator_id'], links);
            }
        }
    });
}

function updateCreator(email, tag_line, creator_id, links, callback) {
    var params = {
        TableName: creator_table,
        Key:{
            "creator_id": creator_id
        },
        UpdateExpression: "set #tag_line = :tag_line, #instagram_link = :instagram_link, #facebook_link = :facebook_link, #twitter_link = :twitter_link, #youtube_link = :youtube_link",
        ExpressionAttributeNames:{
            "#tag_line" : "tag_line",
            "#facebook_link" : "facebook_link",
            "#instagram_link" : "instagram_link",
            "#twitter_link" : "twitter_link",
            "#youtube_link" : "youtube_link"
        },
        ExpressionAttributeValues:{
            ":tag_line" : tag_line,
            ":facebook_link" : links.facebook_link,
            ":instagram_link" : links.instagram_link,
            ":twitter_link" : links.twitter_link,
            ":youtube_link" : links.youtube_link
        },
        ReturnValues:"ALL_NEW"
    };

    docClient.update(params, function(err, data) {
        if (err) {
            return callback(err);
        } else {
            return callback(null, email, creator_id);
        }
    });
}

function updateCreatorDetails(email, creator_id, callback) {

    var params = {
        TableName: creator_details_table,
        Key:{
            "creator_id": creator_id
        },
        UpdateExpression: "set #paypal_email = :paypal_email",
        ExpressionAttributeNames:{
            "#paypal_email" : "paypal_email"
        },
        ExpressionAttributeValues:{
            ":paypal_email" : email
        },
        ReturnValues:"ALL_NEW"
    };
     console.log(params, "2");

    docClient.update(params, function(err, data) {
        if (err) {
            return callback(err);
        } else {
            return callback(null, data);
        }
    });

}