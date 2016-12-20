var LambdaTester = require('lambda-tester');
var handler = require('../index').handler;
var TOKEN = process.env.TOKEN;
var expect = require( 'chai' ).expect;
var ARNS = "someARNS:test";

describe('setAPNSToken', function() {

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

     it(' should give a missing apns_token error ', function() {
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
              expect(error.message).to.equal("apns_token is either null or undefined")
            });
     });

     it(' should give an invalid token error ', function() {
        return LambdaTester( handler )
            .event({
                body : {
                    token: "token",
                    apns_token: "apns_token"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Invalid Token")
            });
     });

    it(' pull this users information / creates the user ', function() {
        return LambdaTester( handler )
            .event( { 
                body : {
                    token: TOKEN,
                    apns_token: "79d5b3fef339026342ce63ed4cbed0c5db79a43f65082bc268cf5d311940c241"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectResult(function(result) {
                expect( result.message ).to.exist;
            });
     });

});