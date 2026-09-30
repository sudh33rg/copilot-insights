'use strict';

const { localDay, daysAgo, asNumber } = require('./utils');

function sum(rows, key) { return rows.reduce((a, r) => a + asNumber(r[key]), 0); }
function aggregateBy(rows, keyFn, valueFn) { const m=new Map(); for(const row of rows){const k=keyFn(row)||'Unknown';m.set(k,(m.get(k)||0)+valueFn(row));} return [...m.entries()].map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value); }
function chooseAuthoritativeUsage(rows) { const byDay=new Map(); for(const row of rows){const e=byDay.get(row.day);if(!e||asNumber(row.updatedAt)>=asNumber(e.updatedAt))byDay.set(row.day,row);} return [...byDay.values()].sort((a,b)=>a.day.localeCompare(b.day)); }

function buildDashboard(store, opts = {}) {
  const today = opts.today || localDay();
  const currentMonth = today.slice(0,7), monthStart=`${currentMonth}-01`;
  const fromDay = opts.fromDay || daysAgo(today,27), queryStart=fromDay<monthStart?fromDay:monthStart;
  const allSessions=store.listSessions({fromDay:queryStart,toDay:today,limit:10000});
  const allUsage=store.listDailyUsage({fromDay:queryStart,toDay:today});
  const allModels=store.listModelUsage({fromDay:queryStart,toDay:today});
  const authoritative=chooseAuthoritativeUsage(allUsage.filter(x=>String(x.source||'').startsWith('github')));
  const rangeSessions=allSessions.filter(s=>s.day>=fromDay), rangeUsage=authoritative.filter(x=>x.day>=fromDay);
  const dayMap=new Map();
  for(const row of rangeUsage) dayMap.set(row.day,{day:row.day,credits:asNumber(row.credits),interactions:asNumber(row.interactions),inputTokens:0,outputTokens:0,cachedTokens:0,authoritativeCredits:true,source:row.source,account:row.account});
  for(const s of rangeSessions){const d=dayMap.get(s.day)||{day:s.day,credits:0,interactions:0,inputTokens:0,outputTokens:0,cachedTokens:0,authoritativeCredits:false};d.inputTokens+=asNumber(s.inputTokens);d.outputTokens+=asNumber(s.outputTokens);d.cachedTokens+=asNumber(s.metadata?.cachedTokens);d.trackedSessions=(d.trackedSessions||0)+1;dayMap.set(s.day,d);}
  const daily=[...dayMap.values()].sort((a,b)=>a.day.localeCompare(b.day));
  const todayUsage=daily.find(x=>x.day===today)||{credits:0,inputTokens:0,outputTokens:0,cachedTokens:0};
  const monthUsage=authoritative.filter(x=>x.day.startsWith(currentMonth)), monthSessions=allSessions.filter(x=>x.day.startsWith(currentMonth));
  const chosenKeys=new Set(authoritative.map(x=>`${x.day}|${x.source}|${x.account||''}`));
  const selectedModels=allModels.filter(m=>chosenKeys.has(`${m.day}|${m.source}|${m.account||''}`)&&m.day>=fromDay);
  const modelTokens=aggregateBy(rangeSessions,s=>modelDisplay(s),s=>asNumber(s.inputTokens)+asNumber(s.outputTokens));
  const modelCredits=aggregateBy(selectedModels,m=>m.model||'Unknown',m=>asNumber(m.credits));
  const workspaces=aggregateBy(rangeSessions,s=>s.workspace||'No workspace',()=>1);
  const efficiencies=rangeSessions.map(s=>asNumber(s.metadata?.analysis?.efficiency?.score)).filter(x=>x>0);
  const findings=collectFindings(rangeSessions);
  return {
    generatedAt:Date.now(),today,range:{fromDay,toDay:today},
    totals:{
      todayCredits:asNumber(todayUsage.credits),monthCredits:sum(monthUsage,'credits'),
      todayTokens:asNumber(todayUsage.inputTokens)+asNumber(todayUsage.outputTokens),
      monthTokens:monthSessions.reduce((a,s)=>a+asNumber(s.inputTokens)+asNumber(s.outputTokens),0),
      monthCachedTokens:monthSessions.reduce((a,s)=>a+asNumber(s.metadata?.cachedTokens),0),
      trackedSessions:monthSessions.length,interactions:sum(monthUsage,'interactions'),
      avgEfficiency:efficiencies.length?Math.round(efficiencies.reduce((a,b)=>a+b,0)/efficiencies.length):null
    },
    daily,modelCredits,modelTokens,workspaces,
    selectionModes:aggregateBy(rangeSessions,s=>s.metadata?.selectionMode||'UNKNOWN',()=>1),
    complexity:aggregateBy(rangeSessions,s=>s.metadata?.analysis?.taskComplexity||'UNKNOWN',()=>1),
    findings,
    sessions:enrichComparisons(rangeSessions.slice(0,500).map(sessionListDto)),
    baselines:buildBaselines(rangeSessions),
    attribution:computeAttribution(daily,rangeSessions)
  };
}


function buildBaselines(sessions){
  const groups=new Map();
  for(const s of sessions){const key=`${s.metadata?.analysis?.taskComplexity||'UNKNOWN'}|${s.metadata?.selectionMode||'UNKNOWN'}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s);}
  const out=[];for(const [key,rows] of groups){if(rows.length<2)continue;const [complexity,selectionMode]=key.split('|');const tokens=rows.map(s=>asNumber(s.inputTokens)+asNumber(s.outputTokens)).sort((a,b)=>a-b);const efficiencies=rows.map(s=>asNumber(s.metadata?.analysis?.efficiency?.score)).filter(Boolean).sort((a,b)=>a-b);out.push({complexity,selectionMode,sessions:rows.length,medianTokens:median(tokens),medianEfficiency:efficiencies.length?median(efficiencies):null});}return out.sort((a,b)=>b.sessions-a.sessions);
}
function enrichComparisons(rows){
  const groups=new Map();for(const s of rows){const k=`${s.complexity}|${s.selectionMode}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(s);}
  for(const s of rows){const peers=groups.get(`${s.complexity}|${s.selectionMode}`)||[];if(peers.length<3)continue;const mt=median(peers.map(x=>x.inputTokens+x.outputTokens).sort((a,b)=>a-b));const me=median(peers.map(x=>x.efficiency).filter(x=>x!=null).sort((a,b)=>a-b));s.comparison={peerSessions:peers.length,medianTokens:mt,medianEfficiency:me,tokenRatio:mt?Number(((s.inputTokens+s.outputTokens)/mt).toFixed(2)):null};}
  return rows;
}
function median(a){if(!a.length)return 0;const i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;}

function collectFindings(sessions){
  const map=new Map();
  for(const s of sessions){for(const f of [...(s.metadata?.analysis?.promptFindings||[]),...(s.metadata?.analysis?.modelFindings||[])]){const row=map.get(f.id)||{id:f.id,title:f.title,severity:f.severity,count:0,sessions:[]};row.count++;if(row.sessions.length<10)row.sessions.push(s.id);map.set(f.id,row);}}
  return [...map.values()].sort((a,b)=>severityRank(b.severity)-severityRank(a.severity)||b.count-a.count);
}
function severityRank(s){return s==='error'?3:s==='warning'?2:s==='info'?1:0;}
function modelDisplay(s){const mode=s.metadata?.selectionMode||'UNKNOWN';const actual=s.metadata?.actualModels||[];if(mode==='AUTO')return `Auto → ${actual[0]||s.model||'Unknown'}`;if(mode==='MANUAL')return `${actual[0]||s.model||'Unknown'} · Manual`;return actual[0]||s.model||'Unknown';}
function sessionListDto(s){
  const m=s.metadata||{}, a=m.analysis||{}, turns=m.turns||[];
  return {id:s.id,startedAt:s.startedAt,day:s.day,workspace:s.workspace,model:s.model,modelDisplay:modelDisplay(s),mode:s.mode,source:s.source,captureLevel:s.captureLevel,
    title:a.title||s.promptSummary||'Copilot session',summary:a.summary||s.responseSummary||'',outcome:a.outcome||'',affectedAreas:a.affectedAreas||[],
    inputTokens:s.inputTokens||0,outputTokens:s.outputTokens||0,cachedTokens:asNumber(m.cachedTokens),credits:Number.isFinite(s.credits)?s.credits:null,creditStatus:s.creditStatus||'unavailable',
    durationMs:s.durationMs||0,status:s.status,turns:turns.length,llmCalls:asNumber(m.llmCalls),selectionMode:m.selectionMode||'UNKNOWN',actualModels:m.actualModels||[],selectedModel:m.selectedModel||null,
    complexity:a.taskComplexity||'UNKNOWN',efficiency:a.efficiency?.score??null,modifiedFiles:a.efficiency?.modifiedFiles||0,findings:[...(a.promptFindings||[]),...(a.modelFindings||[])].map(f=>({id:f.id,title:f.title,severity:f.severity}))};
}
function computeAttribution(daily,sessions){let authoritativeCredits=0,daysWithCredits=0;for(const d of daily)if(d.authoritativeCredits){authoritativeCredits+=asNumber(d.credits);daysWithCredits++;}const trackedTokenSessions=sessions.filter(s=>s.inputTokens||s.outputTokens).length;const creditKnownSessions=sessions.filter(s=>Number.isFinite(s.credits)).length;const exactNativeSessions=sessions.filter(s=>s.source==='vscode-github-copilot-native').length;return {authoritativeCredits,daysWithCredits,trackedSessions:sessions.length,exactNativeSessions,trackedTokenSessions,creditKnownSessions,note:creditKnownSessions?'Some sessions contain direct credit telemetry from Copilot traces.':'Per-session AI credits stay unavailable unless Copilot emits them; GitHub daily totals are never distributed heuristically.'};}

module.exports={buildDashboard,computeAttribution,aggregateBy,chooseAuthoritativeUsage,sessionListDto,modelDisplay};
