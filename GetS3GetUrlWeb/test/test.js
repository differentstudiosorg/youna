var LambdaTester = require('lambda-tester');
var handler = require('../index').handler;
var TOKEN = process.env.TOKEN;
var TOKEN_TWO = process.env.TOKEN_TWO;
var expect = require( 'chai' ).expect;
var ARNS = "someARNS:test";

describe('getS3GetUrlWeb', function() {

      it(' it should give invalid type error  ', function() {
        return LambdaTester( handler )
            .event( { 
                query : {}
              }
            )
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("Invalid type. Must be either a question or an answer");
            });
      });

      it(' it should give invalid video_id error  ', function() {
        return LambdaTester( handler )
            .event( { 
                query : {
                  type : "question"
                }
              }
            )
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectError(function(error) {
              expect(error.message).to.equal("filename is either null or undefined");
            });
      });

     it(' should return a get url ', function() {
        return LambdaTester( handler )
            .event({
                query : {
                    type : "question",
                    filename : "2899510285765795766970931768913_1477677846.mov"
                }
            })
            .context( {
              invokedFunctionArn : ARNS
            })
            .expectResult(function(result) {
               expect(result.url).to.exist;
            });
     });

});