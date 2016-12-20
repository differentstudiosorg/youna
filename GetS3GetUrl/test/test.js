var LambdaTester = require('lambda-tester');
var handler = require('../index').handler;
var TOKEN = process.env.TOKEN;
var TOKEN_TWO = process.env.TOKEN_TWO;
var expect = require( 'chai' ).expect;
var ARNS = "someARNS:test";

describe('getS3GetUrl', function() {

      it(' it should give invalid type error  ', function() {
        return LambdaTester( handler )
            .event( { 
                query : {}
              }
            )
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Invalid type. Must be either a question or an answer");
            });
      });

      it(' it should give invalid video_id error  ', function() {
        return LambdaTester( handler )
            .event( { 
                query : {
                  type : "question"
                }
              }
            )
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Video id is either null or undefined");
            });
      });

      it(' should give an missing/undefined token error ', function() {
        return LambdaTester( handler )
            .event({
                query : {
                   type : "answer",
                   video_id : "abcde"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Token is either null or undefined");
            });
     });

     it(' should give an invalid token error ', function() {
        return LambdaTester( handler )
            .event({
                query : {
                    type : "answer",
                    video_id : "abcde",
                    token: "token"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Invalid Token");
            });
     });

     it(' should give a video you are trying to access does not exist error ', function() {
        return LambdaTester( handler )
            .event({
                query : {
                    type : "question",
                    video_id : "994306342069317742887",
                    token: TOKEN
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
               expect(error.message).to.equal("The video you're trying to access doesn't exist");
            });
     });

     it(' should give an user does not have access to the video error ', function() {
        return LambdaTester( handler )
            .event({
                query : {
                    type : "question",
                    video_id : "3581396491760211302346",
                    token: TOKEN
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
               expect(error.message).to.equal("The user doesn't have access to this video/thumbanil");
            });
     });

     it(' should return a get url ', function() {
        return LambdaTester( handler )
            .event({
                query : {
                    type : "question",
                    video_id : "9943063420693177428877",
                    token: TOKEN
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectResult(function(result) {
               expect(result.url).to.exist;
            });
     });

});