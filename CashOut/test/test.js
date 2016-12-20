var LambdaTester = require('lambda-tester');
var handler = require('../index').handler;
var TOKEN = process.env.TOKEN;
var expect = require( 'chai' ).expect;
var ARNS = "someARNS:test";

describe('cashout', function() {
      this.timeout(15000);
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

     it(' should give an invalid token error ', function() {
        return LambdaTester( handler )
            .event({
                body : {
                    token: "token",
                    creator_id: "apns_token"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Invalid Token")
            });
     });

    it(' should cashout ', function() {
        return LambdaTester( handler )
            .event( { 
                body : {
                    token: TOKEN,
                    creator_id: "4677011097067718657654020735092_c"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectResult(function(result) {
                expect(result.message).to.equal("Cashout successfull");
            });
     });

});