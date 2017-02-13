var LambdaTester = require('lambda-tester');
var handler = require('../index').handler;
var TOKEN = process.env.TOKEN;
var expect = require( 'chai' ).expect;
var ARNS = "someARNS:prod";

describe('notifyCreatorsWithPendingQuestions', function() {
      this.timeout(1200000);
      it(' should notifyEveryone ', function() {
        return LambdaTester( handler )
            .event({
                body : {}
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectResult(function(result) {
              console.log("Result");
              //expect(error.message).to.equal("Token is either null or undefined")
            });
     });

});