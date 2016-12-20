//Uses a different token system will be tested later
var LambdaTester = require('lambda-tester');
var handler = require('../index').handler;
var TOKEN = process.env.TOKEN;
var expect = require( 'chai' ).expect;
var ARNS = "someARNS:test";

describe('getInfo', function() {

      it(' should give an missing/undefined token error ', function() {
        return LambdaTester( handler )
            .event({
                query : {}
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Token is either null or undefined")
            });
     });

     it(' user is not a creator ', function() {
        return LambdaTester( handler )
            .event({
                query : {
                    token: "token"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Invalid Token")
            });
     });

    it(' pull the creator info ', function() {
        return LambdaTester( handler )
            .event( { 
                query : {
                    token: TOKEN
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectResult(function(result) {
                expect( result.user ).to.exist;
                expect( result.creators ).to.exist;
            });
     });

});