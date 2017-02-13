var LambdaTester = require('lambda-tester');
var handler = require('../index').handler;
var expect = require( 'chai' ).expect;
var ARNS = "someARNS:test";

describe('getQuestionInfo', function() {

      it(' should give an missing/undefined question_id error ', function() {
        return LambdaTester( handler )
            .event({
                query : {}
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("question_id is either null or undefined")
            });
     });

     it(' should give an invalid question_id error ', function() {
        return LambdaTester( handler )
            .event({
                query : {
                    question_id: "aaa"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Can't find question")
            });
     });

    it(' should give question ', function() {
        return LambdaTester( handler )
            .event( { 
                query : {
                    question_id: "7136710524098404712685"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectResult(function(result) {
                expect(result.question).to_exist;
                expect(result.creator).to_exist;
            });
     });

});