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
var config_table = 'lambda_config';
var paypal = require('paypal-rest-sdk');
var money = require('money-math');


//Global config variables 
var USERS_DYNAMODB_TABLE = "users_dynamodb_table";
var CREATORS_DYNAMODB_TABLE = "creators_dynamodb_table";
var CREATORS_DETAILS_DYNAMODB_TABLE = "creator_details_dynamodb_table";
var GOOGLE_CLIENT_ID = "google_client_id";
var PAYPAL_MODE = "paypal_mode";
var PAYPAL_CLIENT_SECRET = "paypal_client_secret";
var PAYPAL_CLIENT_ID = "paypal_client_id";
var STAGES = ['prod', 'devo', 'test'];

function loadConfig(ddbtable, stage_value, context, callback) {

    var params = {
        Key:{
            stage:{
                S: stage_value 
            } 
        },
        TableName:ddbtable,
        AttributesToGet: [ USERS_DYNAMODB_TABLE, CREATORS_DYNAMODB_TABLE, CREATORS_DETAILS_DYNAMODB_TABLE, GOOGLE_CLIENT_ID, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE]
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
        loadConfig(config_table, stage, context, function(env_config){

            //set the table
            user_table = env_config["Item"][USERS_DYNAMODB_TABLE]["S"];
            creator_table = env_config["Item"][CREATORS_DYNAMODB_TABLE]["S"];
            creator_details_table = env_config["Item"][CREATORS_DETAILS_DYNAMODB_TABLE]["S"];
            google_client_id = env_config["Item"][GOOGLE_CLIENT_ID]["S"];


            paypal.configure({
                'mode': env_config['Item'][PAYPAL_MODE]['S'], //sandbox or live
                'client_id': env_config['Item'][PAYPAL_CLIENT_ID]['S'],
                'client_secret': env_config['Item'][PAYPAL_CLIENT_SECRET]['S'],
                'headers' : {
                    'custom': 'header'
                }
            });

            var token = event.body.token; 
            var creator_id = event.body.creator_id;

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
                verifyCreator, 
                cashOut, 
                updateBalance
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

function verifyToken(token, creator_id, callback) {

    verifier.verify(token, google_client_id, function (err, tokenInfo) {
      if (!err) {
        var data = tokenInfo;
        return callback(null, tokenInfo.sub, creator_id);
      } else {
        var error = new Error("Invalid Token");
        return callback(error);
      }
    });

}

function amountToCashOut(amount) {
    if (Number(amount) === 0) return 0;
    if (money.cmp(amount, "10.00") < 0) {
        return Number(money.subtract(amount, "0.25"));
    } else return Number(amount)
}



function verifyCreator(google_id, creator_id, callback) {

    var params = {
        TableName : creator_details_table,
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
                var balance = amountToCashOut(creator_details['balance']);
                if (typeof balance != 'number') {
                    var error = new Error('error with balance converison');
                    return callback(error);
                }
                if (balance <= 0) {
                    var error = new Error("can't cashout 0 dollars ");
                    return callback(error);
                }
                else {
                    var paypal_email = creator_details['paypal_email'];
                    return callback(null, balance, paypal_email, creator_id);
                }
            } else {
                var error = new Error("Token doesn't match creator id");
                return callback(error);
            }
        }
    });

}

function cashOut(balance, paypal_email, creator_id, callback) {

    var sender_batch_id = Math.random().toString(36).substring(9) + Math.random().toString(36).substring(9);
    sender_batch_id = sender_batch_id.substr(0,25);

    var create_payout_json = {
        "sender_batch_header": {
            "sender_batch_id": sender_batch_id,
            "email_subject": "You just recieved a payment from You&A LLC "
        },
        "items": [
            {
                "recipient_type": "EMAIL",
                "amount": {
                    "value": balance,
                    "currency": "USD"
                },
                "receiver": paypal_email,
                "note": "We appreciate you answering some of your user's questions!"
            }
        ]
    };

    var sync_mode = 'true';

    paypal.payout.create(create_payout_json, sync_mode, function (error, payout) {
        if (error) {
            return callback(error);
        } else {
            if (payout.items[0].errors != undefined) {
                var error = new Error(payout.items[0].errors.name);
                return callback(error);
            } else {
                return callback(null, creator_id)
            }
        }
    });

}

function updateBalance(creator_id, callback) {

    var updated_balance = "0.00";
    var params = {
        TableName: creator_details_table,
        Key:{
            "creator_id" : creator_id
        },
        UpdateExpression: "set #balance = :balance",
        ExpressionAttributeNames:{
            "#balance" : "balance"
        },
        ExpressionAttributeValues:{
            ":balance" : updated_balance
        },
        ReturnValues:"ALL_NEW"
    };

    docClient.update(params, function(err, data){
        if (err) {
            return callback(err);
        } else {
            var response = {}; 
            response.message = "Cashout successfull";
            return callback(null, response)
        }
    });
}