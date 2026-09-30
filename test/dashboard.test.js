'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');
const {dashboardHtml,sidebarHtml}=require('../src/dashboard');
function scripts(html){return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);}
test('dashboard generated scripts are syntactically valid and session list exposes exact telemetry columns',()=>{
  const html=dashboardHtml();for(const script of scripts(html))new vm.Script(script);
  for(const label of ['Input','Cached','Output','Credits','Turns','Efficiency'])assert.match(html,new RegExp('>'+label+'<'));
  assert.match(html,/Model routing/);assert.match(html,/Why did this consume so much/);
});
test('sidebar generated script is syntactically valid',()=>{for(const script of scripts(sidebarHtml()))new vm.Script(script);});
