var LambdaTester = require('lambda-tester');
var handler = require('../index').handler;
var TOKEN = process.env.TOKEN;
var expect = require( 'chai' ).expect;
var ARNS = "someARNS:test";

describe('updatePrice', function() {

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
                    price: "5.00",
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

    it(' updates price ', function() {
        return LambdaTester( handler )
            .event( { 
                body : {
                    token: TOKEN,
                    price: "5.00",
                    creator_id: "4677011097067718657654020735092_c"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectResult(function(result) {
              expect(result.message).to.equal("price update successful");
            });
     });

});