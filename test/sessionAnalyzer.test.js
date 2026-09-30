'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {analyzeSession,totalsFromTurns}=require('../src/sessionAnalyzer');

test('analyzer flags a vague prompt and derives coding affected areas',()=>{
 const turns=[{user:{text:'Fix this'},assistant:{text:'Updated the controller and test.'},llmRequests:[{inputTokens:200000,outputTokens:3000,cachedTokens:160000,resolvedModel:'gpt-5.6',selectionMode:'AUTO'}],tools:[{name:'apply_patch',args:{path:'src/controllers/run-controller.ts'}},{name:'run_tests',args:{command:'npm test run-controller'}}]}];
 const a=analyzeSession({turns,selectionMode:'AUTO'});assert.ok(a.promptFindings.some(x=>x.id==='underspecified-initial-prompt'));assert.ok(a.files.some(x=>x.path.includes('run-controller.ts')));assert.ok(a.affectedAreas.length>0);assert.equal(totalsFromTurns(turns).cachedTokens,160000);
});
