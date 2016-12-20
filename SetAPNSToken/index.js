var aws = require('aws-sdk');
aws.config.update({region: 'us-east-1'});
var async = require('async');
var verifier = require('google-id-token-verifier');
var docClient = new aws.DynamoDB.DocumentClient();
var ddb = new aws.DynamoDB();
var user_table = '';
var creator_table = '';
var answer_table = '';
var question_table = '';
var google_client_id = '';
var platform_application_arn = ''
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
        AttributesToGet: ['users_dynamodb_table', 'creators_dynamodb_table', 'google_client_id', 'answers_dynamodb_table', 'questions_dynamodb_table', 'platform_application_arn']
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
            platform_application_arn = env_config.Item.platform_application_arn.S;

            var token = event.body.token;
            var apns_token = event.body.apns_token;

            if (token === undefined || token === null || token === '') {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            if (apns_token === undefined || apns_token === null || apns_token === '') {
                var error = new Error("apns_token is either null or undefined");
                return callback(error);
            }

            async.waterfall([
                async.apply(verifyToken, token, apns_token),
                endpointDriver,
                updateAPNSToken
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

function verifyToken(token, apns_token, callback2) {

    verifier.verify(token, google_client_id, function (err, tokenInfo) {
      if (!err) {
        var data = tokenInfo;
        callback2(null, tokenInfo, apns_token);
      } else {
        var error = new Error("Invalid Token");
        return callback2(error);
      }
    });

}

function endpointDriver(data, apns_token, callback) {

    //Get the User -> see if the user has an endpoint ARN set
    //If he does, make a get request to apns and compare the two tokens 
    //if they are the same then do nothing 
    //if they aren't the same then make a post request and update the arn
    var params = {
        TableName: user_table, 
        Key: {
            google_id : data.sub
        }
    }

    docClient.get(params, function(err, user_item) {
        if (err) {
            return callback(err)
        } else {
            var user = user_item['Item'];
            if (user != undefined) {
                if (apns_token != 'declined') {
                    if ( user['sns_endpoint_arn'] != undefined) {
                        return updateEndpointARN(data, apns_token, user['sns_endpoint_arn'], callback);
                    } else {
                        return createEndpointARN(data, apns_token, callback);
                    }
                } else {
                    return callback(null, data, apns_token, undefined, callback);
                }

            } else {
                var error = new Error("User not found");
                return callback(error);
            }
        }
    });

}

function updateEndpointARN(data, apns_token, sns_endpoint_arn, callback) {

    var sns = new aws.SNS();
    var params = {
      Attributes: { /* required */
        Token : apns_token,
        CustomUserData : data.sub, 
        Enabled : 'true'
      },
      EndpointArn: sns_endpoint_arn
    };

    sns.setEndpointAttributes(params, function(err, end_point_data) {
        if (err) {
            return callback(err);
        } else {
            return callback(null, data, apns_token, sns_endpoint_arn)
        }
    });

}

function createEndpointARN(data, apns_token, callback) {
    var sns = new aws.SNS();
    var params =  { 'PlatformApplicationArn': platform_application_arn , 'Token': apns_token };

    sns.createPlatformEndpoint(params,function(err,EndPointResult) {
        if (err) {
            return callback(err);
        } else {
            var sns_endpoint_arn = EndPointResult["EndpointArn"];
            return callback(null, data, apns_token, sns_endpoint_arn);
        }
    });
}

function updateAPNSToken(data, apns_token, sns_endpoint_arn, callback2) {
    var params = {};

    if (apns_token === 'declined') {
        params = {
            TableName: user_table,
            Key: {
                "google_id" : data.sub
            },
            UpdateExpression: "set #apns_token = :apns_token",
            ExpressionAttributeNames : {
                "#apns_token" : "apns_token"
            },
            ExpressionAttributeValues:{
                ":apns_token" : apns_token
            },
            ReturnValues:"ALL_NEW"
        };
    } else {
        params = {
            TableName: user_table,
            Key: {
                "google_id" : data.sub
            },
            UpdateExpression: "set #apns_token = :apns_token, #sns_endpoint_arn = :sns_endpoint_arn",
            ExpressionAttributeNames : {
                "#apns_token" : "apns_token",
                "#sns_endpoint_arn" : "sns_endpoint_arn"
            },
            ExpressionAttributeValues:{
                ":apns_token" : apns_token,
                ":sns_endpoint_arn" : sns_endpoint_arn
            },
            ReturnValues:"ALL_NEW"
        };
    }

    docClient.update(params, function(err, updated_data){
        if (err) {
            return callback2(err);
        } else {
            var response = { message : "apns_token updated successfully"}
            return callback2(null, response);
        }
    });

}


