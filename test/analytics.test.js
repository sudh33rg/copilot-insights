'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../src/storage');
const { buildDashboard } = require('../src/analytics');

test('dashboard keeps GitHub credits authoritative and tracked tokens separate', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ci-analytics-'));
  const s=new JsonStore(path.join(dir,'data.json'));
  s.upsertDailyUsage({day:'2026-09-08',source:'github-organization-metrics',account:'org',credits:20,interactions:4});
  s.insertSession({id:'s',startedAt:1,day:'2026-09-08',workspace:'repo',model:'GPT-X',source:'tracked',captureLevel:'summaries',inputTokens:100,outputTokens:40,durationMs:3,status:'complete'});
  const d=buildDashboard(s,{today:'2026-09-08',fromDay:'2026-09-01'});
  assert.equal(d.totals.todayCredits,20);
  assert.equal(d.totals.monthTokens,140);
  assert.equal(d.totals.trackedSessions,1);
  assert.equal(d.attribution.creditKnownSessions,0);
  assert.match(d.attribution.note,/Per-session AI credits/);
});

test('latest GitHub source wins per day instead of double counting after scope changes', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ci-analytics-'));
  const s=new JsonStore(path.join(dir,'data.json'));
  s.upsertDailyUsage({day:'2026-09-08',source:'github-user-billing',account:'me',credits:10,interactions:2});
  const first=s.state.dailyUsage[0]; first.updatedAt=1;
  s.upsertDailyUsage({day:'2026-09-08',source:'github-organization-metrics',account:'org',credits:14,interactions:3});
  const d=buildDashboard(s,{today:'2026-09-08',fromDay:'2026-09-01'});
  assert.equal(d.totals.todayCredits,14);
  assert.equal(d.totals.monthCredits,14);
});
