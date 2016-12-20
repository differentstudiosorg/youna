var LambdaTester = require('lambda-tester');
var handler = require('../index').handler;
var TOKEN = process.env.TOKEN;
var expect = require( 'chai' ).expect;
var ARNS = "someARNS:test";

describe('getS3PutUrl', function() {

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

      it(' it should give invalid filename error  ', function() {
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
              expect(error.message).to.equal("Invalid filename");
            });
      });

      it(' should give an missing/undefined token error ', function() {
        return LambdaTester( handler )
            .event({
                query : {
                   type : "question",
                   filename : "2364411097067718657654020737457_1480376575.mov"
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
                    type : "question",
                    filename : "sample.mp4",
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

     it(' should return a put url ', function() {
        return LambdaTester( handler )
            .event({
                query : {
                    type : "question",
                    filename : "2364411097067718657654020737457_1480376575.mov",
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