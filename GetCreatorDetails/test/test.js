var LambdaTester = require('lambda-tester');
var handler = require('../index').handler;
var TOKEN = process.env.TOKEN;
var TOKEN_TWO = process.env.TOKEN_TWO;
var expect = require( 'chai' ).expect;
var ARNS = "someARNS:test"; 

describe('getCreatorDetails', function() {

     it(' should give an missing/undefined token error ', function() {
        return LambdaTester( handler )
            .event({
                query : {}
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Token is either null or undefined");
            });
     });

     it(' should give creator_id is undefined error  ', function() {
        return LambdaTester( handler )
            .event( { 
                query : {
                  token : "token"
                }
              }
            )
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Creator Id is either null or undefined");
            });
      });

     it(' should give an invalid token error ', function() {
        return LambdaTester( handler )
            .event({
                query : {
                    creator_id: "1234",
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

     it(' should give a creator id provided is invalid error ', function() {
        return LambdaTester( handler )
            .event({
                query : {
                    creator_id: "1234",
                    token: TOKEN
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Creator id provided is invalid");
            });
     });

     it(' should return creator details', function() {
        return LambdaTester( handler )
            .event({
                query : {
                    creator_id: "4677011097067718657654020735092_c",
                    token: TOKEN
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectResult(function(result) {
              expect(result.creator).to.exist;
              expect(result.creator_details).to.exist;
            });
     });

});