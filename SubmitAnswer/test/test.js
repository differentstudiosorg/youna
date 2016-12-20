var LambdaTester = require('lambda-tester');
var handler = require('../index').handler;
var TOKEN = process.env.TOKEN;
var expect = require( 'chai' ).expect;
var ARNS = "someARNS:test";

describe('submitAnswer', function() {

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
                    filename: "23644110970677657654020737457_1480376575.mov",
                    question_id: "99430634203177428877",
                    asker_id: "23644110970678657654020737457",
                    answerer_id: "467701109706771865764020735092_c"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Invalid Token")
            });
     });

    it(' submits answer ', function() {
        return LambdaTester( handler )
            .event( { 
                body : {
                    token: TOKEN,
                    filename: "2364411097067718657654020737457_1480376575.mov",
                    question_id: "9943063420693177428877",
                    asker_id: "2364411097067718657654020737457",
                    answerer_id: "4677011097067718657654020735092_c"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectResult(function(result) {
              expect(result.answer_id).to.exist;
            });
     });

});