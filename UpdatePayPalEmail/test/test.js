var LambdaTester = require('lambda-tester');
var handler = require('../index').handler;
var TOKEN = process.env.TOKEN;
var expect = require( 'chai' ).expect;
var ARNS = "someARNS:test";

describe('updatePayPalEmail', function() {

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
                    paypal_email: "mehulpatel696@gmail.com",
                    creator_id: "id"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Invalid Token")
            });
     });

    it(' updates email ', function() {
        return LambdaTester( handler )
            .event( { 
                body : {
                    token: TOKEN,
                    paypal_email: "test@youna.io",
                    creator_id: "4677011097067718657654020735092_c"
                    
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectResult(function(result) {
              expect(result.message).to.equal("Updated email successfully");
            });
     });

});