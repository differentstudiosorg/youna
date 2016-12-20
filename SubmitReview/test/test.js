var LambdaTester = require('lambda-tester');
var handler = require('../index').handler;
var TOKEN = process.env.TOKEN;
var TOKEN_TWO = process.env.TOKEN_TWO;
var expect = require( 'chai' ).expect;

describe('submitReview', function() {

     it(' should give an missing/undefined token error ', function() {
        return LambdaTester( handler )
            .event({
                body : {}
            })
            .context( {
              invokedFunctionArn : "someARNS:test"
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Token is either null or undefined");
            });
     });

     it(' should give a token undefined error ', function() {
        return LambdaTester( handler )
            .event( { 
                body : {
                  token : "token",
                  review_text : "blah",
                  answer_id : "blah",
                  rating : 1
                }
              }
            )
            .context( {
              invokedFunctionArn : "someARNS:test"
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Invalid Token");
            });
      });


     it(' should submit a review ', function() {
        return LambdaTester( handler )
            .event({
                body : {
                    rating: 2,
                    answer_id: "5694548978027448374379",
                    review_text : "blah blah",
                    token: TOKEN
                }
            })
            .context( {
              invokedFunctionArn : "someARNS:test"
            })
            .expectResult(function(result) {
              expect(result.review_id).to.exist;
            });
     });

});