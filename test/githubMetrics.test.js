'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { usageCredits, mapLimit } = require('../src/githubMetrics');

test('usageCredits understands credit quantities', () => {
  assert.equal(usageCredits({unitType:'ai-credits',grossQuantity:12.5}),12.5);
  assert.equal(usageCredits({unitType:'credits',netQuantity:8}),8);
  assert.equal(usageCredits({unitType:'other',pricePerUnit:0.01,grossAmount:1.2}),120);
});

test('mapLimit preserves order and bounds concurrency', async () => {
  let active=0,max=0;
  const result=await mapLimit([1,2,3,4,5,6],2,async x=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;return x*2;});
  assert.deepEqual(result,[2,4,6,8,10,12]);
  assert.ok(max<=2);
});
