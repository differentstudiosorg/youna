var aws = require('aws-sdk');
aws.config.update({region: 'us-east-1'});
var async = require('async');
var GOOGLE_CLIENT_ID = 'google_client_id';
var verifier = require('google-id-token-verifier');
var docClient = new aws.DynamoDB.DocumentClient();
var ddb = new aws.DynamoDB();
var user_table = '';
var creator_table = '';
var google_client_id = '';
var config_table = 'lambda_config';
var STAGES = ['prod', 'devo', 'test'];

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
        AttributesToGet: ['users_dynamodb_table', 'creators_dynamodb_table', 'creator_details_dynamodb_table', GOOGLE_CLIENT_ID]
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

function validateMoney(amount) {
    return /^\-?\d+\.\d\d$/.test(amount);
}

exports.handler = function(event, context, callback) {

    var invokedFunctionArn = context.invokedFunctionArn;
    var stage = getStage(invokedFunctionArn);

    if (STAGES.indexOf(stage) >= 0) {
        loadConfig(config_table, stage, context, function(env_config){

            //set the table
            user_table = env_config.Item.users_dynamodb_table.S;
            creator_table = env_config.Item.creators_dynamodb_table.S;
            creator_details_table = env_config.Item.creator_details_dynamodb_table.S;
            google_client_id = env_config.Item.google_client_id.S;

            var token = event.body.token; 
            var creator_id = event.body.creator_id;
            var price = event.body.price; 

            if (token === undefined || token === null || token === '') {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            if (creator_id === undefined || creator_id === null || creator_id === '') {
                var error = new Error("creator_id is either null or undefined");
                return callback(error);
            }

            if (price === undefined || price === null || price === '') {
                var error = new Error("price is either null or undefined");
                return callback(error);
            }

            if(!validateMoney(price)) {
                var error = new Error("price is not properly formatted");
                return callback(error);
            }

            async.waterfall([
                async.apply(verifyToken, token, creator_id, price),
                verifyCreator, 
                updatePrice
            ], function(err, done) {
                if (err) {
                    return callback(err);
                } else {
                    var res = { message : "price update successful"}
                    return callback(null, res);
                }
            });

        });

    } else {
        var error = new Error("Invalid Stage.");
        return callback(error);
    }

}

function verifyToken(token, creator_id, price, callback) {

    verifier.verify(token, google_client_id, function (err, tokenInfo) {
      if (!err) {
        return callback(null, tokenInfo.sub, creator_id, price);
      } else {
        var error = new Error("Invalid Token");
        return callback(error);
      }
    });

}

function verifyCreator(google_id, creator_id, new_price, callback) {

    var params = {
        TableName : creator_table,
        Key : {
            'creator_id' : creator_id
        }
    }

    docClient.get(params, function(err, creator_details_item){
        if (err) {
            return callback(err);
        } else {
            var creator_details = creator_details_item['Item'];
            if (creator_details['google_id'] === google_id) {
                return callback(null, creator_id, new_price)
            } else {
                var error = new Error("Token doesn't match creator id");
                return callback(error);
            }
        }

    });
}

function updatePrice(creator_id, new_price, callback) {

    if (new_price === "0.00") new_price = "Free";
    var params = {
        TableName: creator_table,
        Key:{
            "creator_id": creator_id
        },
        UpdateExpression: "set #price = :price",
        ExpressionAttributeNames:{
            "#price" : "price"
        },
        ExpressionAttributeValues:{
            ":price" : new_price
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

