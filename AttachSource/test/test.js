var LambdaTester = require('lambda-tester');
var handler = require('../index').handler;
var TOKEN = process.env.TOKEN;
var expect = require( 'chai' ).expect;
var ARNS = "someARNS:test";

describe('attachSource', function() {

      it(' should give an missing/undefined token error ', function() {
        return LambdaTester( handler )
            .event({
                body : {}
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Token is either null or undefined")
            });
     });

     it(' should give a missing source error ', function() {
        return LambdaTester( handler )
            .event({
                body : {
                    token: "token"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Source is either null or undefined")
            });
     });

     it(' should give an invalid token error ', function() {
        return LambdaTester( handler )
            .event({
                body : {
                    token: "token",
                    source: "apns_token"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Invalid Token")
            });
     });

    it(' attaches soruce card ', function() {
        return LambdaTester( handler )
            .event( { 
                body : {
                    token: TOKEN,
                    source: "source_to_set"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
                expect(error.raw.message).to.equal("No such token: source_to_set");
            });
     });

});