'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, JsonStore } = require('../src/storage');

function session(id, day='2026-09-08', workspace='alpha') {
  return { id, startedAt: Date.parse(`${day}T10:00:00Z`), endedAt: Date.parse(`${day}T10:00:01Z`), day, workspace, model:'m1', mode:'chat', source:'test', captureLevel:'full', prompt:'secret prompt', response:'secret response', promptSummary:'prompt', responseSummary:'response', inputTokens:10, outputTokens:5, credits:null, creditStatus:'unavailable', durationMs:1000, status:'complete', metadata:{} };
}

test('store inserts, queries and clears content without losing metrics', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ci-store-'));
  const store = createStore(dir);
  store.insertSession(session('s1'));
  store.upsertDailyUsage({ day:'2026-09-08', source:'github-user-billing', account:'me', credits:12.5, interactions:3, raw:{} });
  store.replaceModelUsage('2026-09-08','github-user-billing','me',[{model:'GPT-X',credits:12.5,interactions:3}]);
  assert.equal(store.getSession('s1').prompt, 'secret prompt');
  assert.equal(store.listDailyUsage().length, 1);
  store.clear('content');
  assert.equal(store.getSession('s1').prompt, null);
  assert.equal(store.getSession('s1').inputTokens, 10);
  assert.equal(store.listDailyUsage()[0].credits, 12.5);
  store.clear('usage');
  assert.equal(store.listDailyUsage().length, 0);
  assert.equal(store.getSession('s1').id, 's1');
  store.clear('all');
  assert.equal(store.listSessions().length, 0);
  store.close();
});

test('workspace-scoped clear does not remove other workspaces or aggregate GitHub usage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ci-store-'));
  const store = new JsonStore(path.join(dir,'usage.json'));
  store.insertSession(session('a','2026-09-08','alpha'));
  store.insertSession(session('b','2026-09-08','beta'));
  store.upsertDailyUsage({day:'2026-09-08',source:'github-user-billing',account:'me',credits:5});
  store.clear('all',{workspace:'alpha'});
  assert.equal(store.getSession('a'), null);
  assert.equal(store.getSession('b').workspace, 'beta');
  assert.equal(store.listDailyUsage().length, 1);
});

test('clear content scrubs native turn text and tool arguments while retaining telemetry',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'copilot-insights-store-'));
  const store=createStore(dir);store.insertSession({id:'native',startedAt:1,day:'2026-09-08',workspace:'w',source:'vscode-github-copilot-native',captureLevel:'full',inputTokens:10,outputTokens:2,metadata:{cachedTokens:7,turns:[{user:{text:'secret prompt'},assistant:{text:'secret response'},tools:[{name:'apply_patch',args:{path:'secret.ts'},result:'ok'}]}],analysis:{title:'secret',intent:'secret',summary:'secret',affectedAreas:[{name:'execution'}]}}});
  store.clear('content');const s=store.getSession('native');assert.equal(s.metadata.turns[0].user.text,null);assert.equal(s.metadata.turns[0].assistant.text,null);assert.equal(s.metadata.turns[0].tools[0].args,null);assert.equal(s.metadata.cachedTokens,7);assert.equal(s.inputTokens,10);assert.equal(s.metadata.analysis.summary,null);assert.deepEqual(s.metadata.analysis.affectedAreas,[{name:'execution'}]);store.close();
});
