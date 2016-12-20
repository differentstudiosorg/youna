var aws = require('aws-sdk');
aws.config.update({region: 'us-east-1'});
var async = require('async');

var verifier = require('google-id-token-verifier');
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

function validateEmail(email) {
    var re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email);
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

            var token = event.body.token; 
            var paypal_email = event.body.paypal_email;
            var creator_id = event.body.creator_id;

            if (token === undefined || token === null || token === '') {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            if (creator_id === undefined || creator_id === null || creator_id === '') {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            //don't actually verify the email here on purpose -> verify it when they try to cash out 
            if (paypal_email === undefined || paypal_email === null || paypal_email === '') {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            if (!validateEmail(paypal_email)) {
                var error = new Error("Email is not valid");
                return callback(error);
            }

            async.waterfall([
                async.apply(verifyToken, token, creator_id, paypal_email),
                verifyCreator,
                updateCreatorDetails
            ], function(err, done) {
                if (err) {
                    return callback(err);
                } else {
                    var res = { message : "Updated email successfully" };
                    return callback(null, res);
                }
            });

        });

    } else {
        var error = new Error("Invalid Stage.");
        return callback(error);
    }

}

function verifyToken(token, creator_id, paypal_email, callback) {

    verifier.verify(token, google_client_id, function (err, tokenInfo) {
      if (!err) {
        var data = tokenInfo;
        return callback(null, tokenInfo.sub, creator_id, paypal_email);
      } else {
        var error = new Error("Invalid Token");
        return callback(error);
      }
    });

}

function verifyCreator(google_id, creator_id, paypal_email, callback) {

    var params = {
        TableName : creator_details_table, 
        Key : { "creator_id" : creator_id }
    }

    docClient.get( params, function(err, creator_item) {
        if (err) {
            return callback(err);
        } else {
            var creator = creator_item['Item'];
            if ( creator != undefined && creator['google_id'] != undefined) {
                if ( creator['google_id'] != google_id) {
                    var error = new Error("Creator Id and google token don't match");
                    return callback(error);
                } else {
                    return callback(null, creator_id, paypal_email);
                }
            } else {
                var error = new Error("Creator not found");
                return callback(error);
            }
        }
    });

}

function updateCreatorDetails(creator_id, paypal_email, callback) {

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
            ":paypal_email" : paypal_email
        },
        ReturnValues:"ALL_NEW"
    };

    docClient.update(params, function(err, data) {
        if (err) {
            return callback(err);
        } else {
            return callback(null, data);
        }
    });

}
