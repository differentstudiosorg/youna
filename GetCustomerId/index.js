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

function getStage(invokedFunctionArn) {

     var invokedFunctionArnArray = invokedFunctionArn.split(":");
     var stage = invokedFunctionArnArray[invokedFunctionArnArray.length - 1];
     return stage;

}

exports.handler = function(event, context, callback) {

    var invokedFunctionArn = context.invokedFunctionArn;
    var stage = getStage(invokedFunctionArn);

    if (STAGES.indexOf(stage) >= 0) {
        loadConfig(config_table, stage, context, function(env_config){

            //set the table
            user_table = env_config.Item.users_dynamodb_table.S;
            google_client_id = env_config.Item.google_client_id.S;
            stripe = require('stripe')(env_config.Item.stripe_api_key.S);
            var token = event.query.token;

            if (token === undefined || token === null || token === '') {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            async.waterfall([
                async.apply(verifyToken, token),
                getCustomerId
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

function verifyToken(token, callback) {

    verifier.verify(token, google_client_id, function (err, tokenInfo) {
      if (!err) {
        var data = tokenInfo;
        if (tokenInfo.email === undefined) {
            var error = new Error("Can't use this gmail account");
            return callback(error);
        } else {
            return callback(null, tokenInfo);
        }
      } else {
        var error = new Error("Invalid Token");
        return callback(error);
      }
    });

}

function getCustomerId(data, callback) {

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
            var customer_id = user.customer_id;
            stripe.customers.retrieve(customer_id, function(err, customer) {
                if (err) {
                  return callback(err);
                } else {
                  return callback(null, customer);
                }
            });
        }
    });

}



