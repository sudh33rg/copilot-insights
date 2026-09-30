'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {parseTranscript,parseDebugLog,mergeSession,toStoreRecord,normalizeLlmRequest}=require('../src/nativeCopilot');

test('native transcript and debug log merge into exact multi-turn session telemetry',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ci-native-'));const transcript=path.join(dir,'s1.jsonl'),debug=path.join(dir,'main.jsonl');
  fs.writeFileSync(transcript,[
    {type:'user_message',sessionId:'s1',timestamp:'2026-09-08T10:00:00Z',message:'Fix the timeout in execution manager',selectedModel:'auto',selectionMode:'auto'},
    {type:'agent_response',sessionId:'s1',timestamp:'2026-09-08T10:00:05Z',message:'I will inspect the execution path.'},
    {type:'user_message',sessionId:'s1',timestamp:'2026-09-08T10:00:10Z',message:'Also add a regression test.'},
    {type:'agent_response',sessionId:'s1',timestamp:'2026-09-08T10:00:20Z',message:'Fixed the race and added regression coverage.'}
  ].map(JSON.stringify).join('\n'));
  fs.writeFileSync(debug,[
    {type:'llm_request',timestamp:'2026-09-08T10:00:02Z',model:'gpt-5.6',usage:{inputTokens:1000,outputTokens:100,cachedTokens:600}},
    {type:'tool_call',timestamp:'2026-09-08T10:00:04Z',toolName:'read_file',args:{path:'src/execution/execution-manager.ts'}},
    {type:'llm_request',timestamp:'2026-09-08T10:00:12Z',model:'gpt-5.6',usage:{inputTokens:2000,outputTokens:250,cachedTokens:1400}},
    {type:'tool_call',timestamp:'2026-09-08T10:00:14Z',toolName:'apply_patch',args:{path:'src/execution/execution-manager.ts'}},
    {type:'tool_call',timestamp:'2026-09-08T10:00:16Z',toolName:'run_tests',args:{command:'npm test execution-manager'}}
  ].map(JSON.stringify).join('\n'));
  const s=parseTranscript(transcript,'LoadRunner Cloud');const d=parseDebugLog(debug);const merged=mergeSession(s,d,debug);const rec=toStoreRecord(merged,'full');
  assert.equal(rec.id,'s1');assert.equal(rec.inputTokens,3000);assert.equal(rec.outputTokens,350);assert.equal(rec.metadata.cachedTokens,2000);assert.equal(rec.metadata.turns.length,2);assert.equal(rec.metadata.selectionMode,'AUTO');assert.equal(rec.metadata.actualModels[0],'gpt-5.6');
  assert.ok(rec.metadata.analysis.files.some(f=>f.path.includes('execution-manager.ts')));assert.match(rec.metadata.analysis.summary,/regression coverage/i);
  const req=rec.metadata.turns[0].llmRequests[0];assert.equal(req.selectionMode,'AUTO');assert.equal(req.selectionSource,'COPILOT_AUTO');
});

test('llm request extracts exact token categories and resolved model',()=>{
  const r=normalizeLlmRequest({type:'llm_request',modelId:'claude-sonnet',usage:{input_tokens:44,output_tokens:7,cached_tokens:33},selectedModel:'auto'},123);
  assert.equal(r.inputTokens,44);assert.equal(r.outputTokens,7);assert.equal(r.cachedTokens,33);assert.equal(r.resolvedModel,'claude-sonnet');assert.equal(r.selectionMode,'AUTO');
});

test('canonical chatSessions snapshot requests become turns',()=>{
  const {normalizeSessionSnapshot}=require('../src/nativeCopilot');
  const turns=normalizeSessionSnapshot({requests:[
    {message:{text:'Investigate the run timeout'},response:[{value:'I found the issue.'}],modelId:'auto'},
    {message:{text:'Apply the fix'},response:[{value:{value:'Updated the execution manager.'}}],modelId:'auto'}
  ]});
  assert.equal(turns.length,2);assert.equal(turns[0].user.text,'Investigate the run timeout');assert.equal(turns[1].assistant.text,'Updated the execution manager.');
});
