var aws = require('aws-sdk');
aws.config.update({region: 'us-east-1'});
var async = require('async');
var verifier = require('google-id-token-verifier');
var docClient = new aws.DynamoDB.DocumentClient();
var ddb = new aws.DynamoDB();
var user_table = '';
var creator_table = '';
var answer_table = '';
var review_table = '';
var creator_details_table = '';
var google_client_id = '';
var config_table = 'lambda_config';
var STAGES = ['prod', 'devo', 'test'];

//Global config variables 
var USERS_DYNAMODB_TABLE = "users_dynamodb_table";
var CREATORS_DYNAMODB_TABLE = "creators_dynamodb_table";
var ANSWERS_DYANMODB_TABLE = "answers_dynamodb_table";
var CREATORS_DETAILS_DYNAMODB_TABLE = "creator_details_dynamodb_table";
var REVIEWS_DYNAMODB_TABLE = "reviews_dynamodb_table";
var GOOGLE_CLIENT_ID = "google_client_id";


function genRand() {
    return Math.floor(Math.random()*8999999999+1000000000);
}

//Taking the chance that they don't overlap - fingers crossed 
function generateReviewId() {
    return genRand().toString() + genRand().toString();
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
        AttributesToGet: [ USERS_DYNAMODB_TABLE, CREATORS_DYNAMODB_TABLE, CREATORS_DETAILS_DYNAMODB_TABLE, REVIEWS_DYNAMODB_TABLE, GOOGLE_CLIENT_ID, ANSWERS_DYANMODB_TABLE]
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
            user_table = env_config["Item"][USERS_DYNAMODB_TABLE]["S"];
            creator_table = env_config["Item"][CREATORS_DYNAMODB_TABLE]["S"];
            creator_details_table = env_config["Item"][CREATORS_DETAILS_DYNAMODB_TABLE]["S"];
            answer_table = env_config["Item"][ANSWERS_DYANMODB_TABLE]["S"];
            review_table = env_config["Item"][REVIEWS_DYNAMODB_TABLE]["S"];
            google_client_id = env_config["Item"][GOOGLE_CLIENT_ID]["S"];

            var token = event.body.token; 
            var review_text = event.body.review_text;
            var answer_id = event.body.answer_id;
            var rating = event.body.rating;
            var date = getDateTime();

            if (token === undefined || token === null || token === '') {
                var error = new Error("Token is either null or undefined");
                return callback(error);
            }

            if (rating === undefined || rating === null || rating === '' || rating < 0) {
                var error = new Error("Rating is either null or undefined or invalid");
                return callback(error);
            }

            var review = {
                review_id : generateReviewId(),
                review_text : review_text,
                rating : rating, 
                answer_id : answer_id,
                date : date
            };

            async.waterfall([
                async.apply(verifyToken, token, review),
                getUser,
                updateAnswer, 
                submitReview,
                getCreator,
                updateCreatorRating
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

function verifyToken(token, review, callback) {

    verifier.verify(token, google_client_id, function (err, tokenInfo) {
      if (!err) {
        var data = tokenInfo;
        return callback(null, tokenInfo, review);
      } else {
        var error = new Error("Invalid Token");
        return callback(error);
      }
    });

}

function getUser(data, review, callback) {

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

            if (user != undefined && user['user_id'] != undefined) {
                review.review_from = user['user_id'];
                review.reviewer_profile_url = user['profile_pic'];
                review.reviewer_name = user['name'];
                return callback(null, review);
            }

            else {
                var error = new Error("The user is not in our database");
                return callback(error);
            }

        }

    });

}

function updateAnswer(review, callback) {

    var answer_id = review.answer_id;
    var rating = review.rating;

    var params = {
        TableName : answer_table,
        Key : {
            answer_id : answer_id
        },
        UpdateExpression: "set #rating = :rating",
        ExpressionAttributeNames:{
            "#rating" : "rating"
        },
        ExpressionAttributeValues:{
            ":rating" : rating
        },
        ReturnValues:"ALL_NEW"
    }

    docClient.update(params, function(err, data){
        if (err) {
            return callback(err);
        } else {
            review.review_for = data['Attributes']['answerer_id'];
            return callback(null, review);
        }
    });
}

function submitReview(review, callback) {

    var params = {
        TableName : review_table,
        Item : review
    }

    docClient.put(params, function(err) {
        if (err) {
            return callback(err);
        } else {
            return callback(null, review);
        }
    });

}

function getCreator(review, callback){

    var creator_id = review.review_for;

    var params = {
        TableName : creator_table,
        Key : {
            creator_id : creator_id
        }
    }

    docClient.get(params, function(err, creator_item) {
        if (err) {
            return callback(err);
        } else {
            var creator = creator_item['Item'];
            if (creator != undefined && creator['num_ratings'] != undefined) {
                return callback(null, review, creator);
            } else {
                var error = new Error("Creator not found");
                return callback(error);
            }
        }
    })
}

function calculateNewTotalRating(num_ratings, new_rating, avg_rating) {
    if(num_ratings === 0) return parseFloat(new_rating.toFixed(1));
    var new_total_rating_string = (((num_ratings * avg_rating) + (new_rating)) / (num_ratings + 1)).toFixed(1);
    var new_total_rating_number = parseFloat(new_total_rating_string);
    return new_total_rating_number;
}

function updateCreatorRating(review, creator, callback) {

   var num_ratings = creator.num_ratings;
   var avg_rating = creator.rating;
   var new_rating = review.rating;
   var new_total_rating = calculateNewTotalRating(num_ratings, new_rating, avg_rating);
   num_ratings++;

   var params = {
        TableName : creator_table,
        Key : {
            creator_id : creator.creator_id
        },
        UpdateExpression: "set #reviews = list_append(#reviews, :review), #rating = :rating, #num_ratings = :num_ratings",
        ExpressionAttributeNames:{
            "#reviews" : "reviews",
            "#rating" : "rating",
            "#num_ratings" : "num_ratings"
        },
        ExpressionAttributeValues:{
            ":review" : [review],
            ":rating" : new_total_rating,
            ":num_ratings" : num_ratings
        },
        ReturnValues:"ALL_NEW"
   }

   docClient.update(params, function(err, data) {
        if (err) {
            return callback(err);
        } else {
            return callback(null, review);
        }
   });

}