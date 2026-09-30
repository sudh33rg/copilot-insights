'use strict';

const path = require('node:path');
const { oneLine, asNumber } = require('./utils');

const TRIVIAL_HINTS = /\b(rename|typo|spelling|format|comment|one[- ]?line|small text|label|copy change)\b/i;
const COMPLEX_HINTS = /\b(race|concurr|deadlock|distributed|architecture|migration|cross[- ]?service|performance|security|refactor|root cause|intermittent|flaky)\b/i;
const VAGUE_PROMPTS = /^(fix|check|improve|update|change|make|do|look at|review)(\s+(this|it|that|everything|issue|problem))?[.!?]*$/i;

function analyzeSession(session) {
  const turns = Array.isArray(session.turns) ? session.turns : [];
  const requests = turns.flatMap(t => Array.isArray(t.llmRequests) ? t.llmRequests : []);
  const tools = turns.flatMap(t => Array.isArray(t.tools) ? t.tools : []);
  const files = collectFiles(turns, tools);
  const prompts = turns.map(t => t.user?.text || '').filter(Boolean);
  const responses = turns.map(t => t.assistant?.text || '').filter(Boolean);
  const firstPrompt = prompts[0] || '';
  const lastResponse = [...responses].reverse().find(Boolean) || '';

  const affectedAreas = inferAffectedAreas(files);
  const outcome = buildOutcome(lastResponse, files, tools);
  const taskComplexity = classifyComplexity({ firstPrompt, turns, files, tools, requests });
  const promptFindings = analyzePromptQuality({ prompts, turns, files, tools, requests });
  const modelFindings = analyzeModels({ session, requests, taskComplexity, turns, files, tools });
  const efficiency = buildEfficiency({ turns, requests, tools, files, promptFindings, modelFindings });
  const phases = detectPhases(turns);
  const promptEvolution = analyzePromptEvolution(prompts);
  const contextHealth = analyzeContextHealth(requests, turns);
  const wasteAttribution = attributeWaste({ turns, requests, tools, files, promptFindings });
  const costDrivers = explainCostDrivers({ turns, requests, tools, files, promptFindings, contextHealth });
  const conversationHealth = analyzeConversationHealth({ prompts, turns, tools });

  return {
    title: makeTitle(firstPrompt, outcome.summary),
    intent: oneLine(firstPrompt, 260),
    summary: outcome.summary,
    outcome: outcome.outcome,
    affectedAreas,
    files,
    tests: collectTests(tools),
    commands: collectCommands(tools),
    taskComplexity,
    promptFindings,
    modelFindings,
    efficiency,
    phases,
    promptEvolution,
    contextHealth,
    wasteAttribution,
    costDrivers,
    conversationHealth,
    unresolvedItems: extractUnresolved(lastResponse),
    provenance: {
      summary: 'derived', affectedAreas: 'derived', taskComplexity: 'inferred',
      promptFindings: 'inferred', modelFindings: 'inferred', files: files.length ? 'exact' : 'unavailable',
      wasteAttribution: 'inferred', contextHealth: requests.length ? 'derived' : 'unavailable', conversationHealth: 'inferred'
    }
  };
}

function totalsFromTurns(turns) {
  const requests = turns.flatMap(t => t.llmRequests || []);
  return requests.reduce((a, r) => {
    a.inputTokens += asNumber(r.inputTokens);
    a.outputTokens += asNumber(r.outputTokens);
    a.cachedTokens += asNumber(r.cachedTokens);
    if (Number.isFinite(Number(r.credits))) a.credits += Number(r.credits);
    a.llmCalls++;
    return a;
  }, { inputTokens: 0, outputTokens: 0, cachedTokens: 0, credits: 0, llmCalls: 0 });
}

function collectFiles(turns, tools) {
  const map = new Map();
  const add = (file, action = 'read', detail = '') => {
    if (!file || typeof file !== 'string') return;
    const clean = normalizeFile(file);
    if (!clean || clean.length > 600) return;
    const prior = map.get(clean) || { path: clean, actions: new Set(), details: [] };
    prior.actions.add(action);
    if (detail && prior.details.length < 6) prior.details.push(oneLine(detail, 180));
    map.set(clean, prior);
  };
  for (const t of turns) {
    for (const f of t.files || []) add(f.path || f.file || f.uri || f, f.action || 'read', f.detail || '');
  }
  for (const tool of tools) {
    const text = JSON.stringify(tool.args || tool.input || tool || {});
    const action = toolAction(tool);
    for (const p of extractPaths(text)) add(p, action, tool.name || tool.tool || '');
  }
  return [...map.values()].map(x => ({ ...x, actions: [...x.actions] }));
}

function normalizeFile(value) {
  let s = String(value).replace(/^file:\/\//, '').replace(/\\/g, '/');
  try { s = decodeURIComponent(s); } catch {}
  return s;
}

function extractPaths(text) {
  const out = new Set();
  const rx = /(?:[A-Za-z]:)?(?:\/[\w.@()+\- ]+){1,12}\.[A-Za-z0-9_-]{1,12}|(?:[\w.@()+\-]+\/){1,10}[\w.@()+\-]+\.[A-Za-z0-9_-]{1,12}/g;
  for (const m of String(text || '').matchAll(rx)) out.add(m[0]);
  return [...out];
}

function toolAction(tool) {
  const n = String(tool.name || tool.tool || tool.type || '').toLowerCase();
  if (/delete|remove/.test(n)) return 'deleted';
  if (/create|write|insert|edit|replace|patch|apply/.test(n)) return 'modified';
  if (/test/.test(n)) return 'tested';
  if (/terminal|shell|command|run/.test(n)) return 'executed';
  return 'read';
}

function inferAffectedAreas(files) {
  const m = new Map();
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean);
    const base = parts.length > 1 ? parts.slice(Math.max(0, parts.length - 3), -1).join(' / ') : path.dirname(f.path);
    const key = humanizeArea(base || path.extname(f.path).slice(1) || 'Code');
    const row = m.get(key) || { name: key, files: 0, modified: 0, tested: 0 };
    row.files++;
    if (f.actions.some(a => /modified|created|deleted/.test(a))) row.modified++;
    if (f.actions.includes('tested')) row.tested++;
    m.set(key, row);
  }
  return [...m.values()].sort((a,b)=>b.modified-a.modified || b.files-a.files).slice(0, 12);
}

function humanizeArea(s) {
  return oneLine(String(s || '').replace(/[_.-]+/g, ' ').replace(/\b(src|lib|app|packages?|services?)\b/gi, '').replace(/\s+/g, ' ').trim(), 80) || 'Code';
}

function buildOutcome(lastResponse, files, tools) {
  const modified = files.filter(f => f.actions.some(a => /modified|created|deleted/.test(a))).length;
  const tests = collectTests(tools);
  let summary = summarizeMeaningful(lastResponse);
  if (!summary) {
    summary = modified ? `Copilot changed ${modified} file${modified===1?'':'s'} in this session.` : 'Copilot completed the recorded conversation without a structured final summary.';
  }
  const bits = [];
  if (modified) bits.push(`${modified} file${modified===1?'':'s'} changed`);
  if (tests.length) bits.push(`${tests.length} test-related action${tests.length===1?'':'s'}`);
  return { summary, outcome: bits.length ? bits.join(' · ') : 'No code-change evidence captured' };
}

function summarizeMeaningful(text) {
  if (!text) return '';
  const clean = String(text).replace(/```[\s\S]*?```/g, ' [code] ').replace(/[#>*_`~-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(x => x.length > 20);
  return oneLine(sentences.slice(-3).join(' ') || clean, 420);
}

function classifyComplexity({ firstPrompt, turns, files, tools, requests }) {
  let score = 0;
  if (TRIVIAL_HINTS.test(firstPrompt)) score -= 2;
  if (COMPLEX_HINTS.test(firstPrompt)) score += 3;
  if (files.length > 3) score++;
  if (files.length > 10) score += 2;
  if (turns.length > 3) score++;
  if (turns.length > 8) score++;
  if (tools.length > 15) score++;
  if (requests.length > 8) score++;
  const totalTokens = requests.reduce((a,r)=>a+asNumber(r.inputTokens)+asNumber(r.outputTokens),0);
  if (totalTokens > 250000) score++;
  if (score <= -1) return 'TRIVIAL';
  if (score <= 1) return 'SMALL';
  if (score <= 3) return 'MEDIUM';
  if (score <= 5) return 'COMPLEX';
  return 'VERY_COMPLEX';
}

function analyzePromptQuality({ prompts, turns, files, tools, requests }) {
  const findings = [];
  const first = prompts[0] || '';
  if (first && (VAGUE_PROMPTS.test(first.trim()) || first.trim().length < 18)) {
    findings.push(finding('underspecified-initial-prompt', 'warning', 'Initial prompt may be underspecified', 'The initial request is very short or generic, which can force Copilot to spend extra turns discovering scope.'));
  }
  if (prompts.length >= 4) {
    const added = prompts.slice(1).filter(p => /\b(don't|do not|also|must|instead|actually|make sure|only|without|preserve|test)\b/i.test(p)).length;
    if (added >= 2) findings.push(finding('late-constraints', 'warning', 'Important constraints arrived late', `${added} later prompts appear to add or correct constraints after work had begun.`));
  }
  const correctionCount = prompts.slice(1).filter(p => /\b(no|wrong|instead|revert|undo|not what|i meant|don't|do not|stop|fix that)\b/i.test(p)).length;
  if (correctionCount >= 2) findings.push(finding('repeated-corrections', 'warning', 'Repeated corrective turns', `${correctionCount} later prompts look corrective, suggesting the initial direction may not have been precise enough.`));
  const discoveryCalls = tools.filter(t => /search|grep|read|find|list/i.test(String(t.name || t.tool || t.type || ''))).length;
  if (files.length <= 2 && discoveryCalls >= 12) findings.push(finding('discovery-heavy', 'info', 'Discovery was large relative to the final scope', `${discoveryCalls} discovery-oriented tool calls were observed for a small affected-file set.`));
  const totalIn = requests.reduce((a,r)=>a+asNumber(r.inputTokens),0);
  const totalOut = requests.reduce((a,r)=>a+asNumber(r.outputTokens),0);
  if (totalIn > 150000 && totalOut < 8000 && files.length <= 2) findings.push(finding('context-heavy-small-output', 'warning', 'Large context for a small outcome', 'The session consumed substantial input context while producing little output and touching few files.'));
  return findings;
}

function analyzeModels({ session, requests, taskComplexity, turns, files, tools }) {
  const findings = [];
  const routed = requests.filter(r => r.resolvedModel || r.model);
  const selectionModes = new Set(routed.map(r => r.selectionMode || session.selectionMode || 'UNKNOWN'));
  const highCapability = routed.some(r => /opus|pro|max|reason|gpt-5\.6|gpt-5\.4|o3|o4/i.test(String(r.resolvedModel || r.model || '')));
  const simple = taskComplexity === 'TRIVIAL' || taskComplexity === 'SMALL';
  const costlyBehavior = routed.length <= 4 && files.filter(f=>f.actions.some(a=>/modified|created|deleted/.test(a))).length <= 2 && tools.length < 10;
  if (simple && highCapability && costlyBehavior) {
    if (selectionModes.has('AUTO')) findings.push(finding('auto-overroute', 'warning', 'Copilot Auto may have over-routed this task', 'A high-capability model handled a small, localized task with limited execution complexity.', { responsibility: 'COPILOT_AUTO' }));
    else if (selectionModes.has('MANUAL')) findings.push(finding('manual-overprovision', 'warning', 'Manual model choice may be oversized', 'A high-capability model handled a small, localized task that may not have required it.', { responsibility: 'USER' }));
  }
  const retries = turns.filter(t => /error|failed|retry/i.test(JSON.stringify(t))).length;
  if ((taskComplexity === 'COMPLEX' || taskComplexity === 'VERY_COMPLEX') && retries >= 3 && !highCapability) findings.push(finding('possible-underroute', 'warning', 'Model may have been undersized for this task', 'The task was complex and accumulated several failed/retry signals.', { responsibility: selectionModes.has('AUTO') ? 'COPILOT_AUTO' : 'USER_OR_UNKNOWN' }));
  return findings;
}

function buildEfficiency({ turns, requests, tools, files, promptFindings, modelFindings }) {
  let score = 100;
  score -= promptFindings.filter(x=>x.severity==='warning').length * 10;
  score -= modelFindings.filter(x=>x.severity==='warning').length * 8;
  const cached = requests.reduce((a,r)=>a+asNumber(r.cachedTokens),0);
  const input = requests.reduce((a,r)=>a+asNumber(r.inputTokens),0);
  const modified = files.filter(f=>f.actions.some(a=>/modified|created|deleted/.test(a))).length;
  if (turns.length > 8 && modified <= 1) score -= 10;
  if (requests.length > 12 && modified <= 1) score -= 10;
  const cacheRatio = input ? cached / input : 0;
  return {
    score: Math.max(0, Math.min(100, score)),
    llmCalls: requests.length,
    toolCalls: tools.length,
    modifiedFiles: modified,
    cacheRatio: Number(cacheRatio.toFixed(3)),
    correctionSignals: promptFindings.filter(x=>x.id==='repeated-corrections').length
  };
}

function detectPhases(turns) {
  if (!turns.length) return [];
  const phases = [];
  let start = 0;
  let current = phaseForTurn(turns[0]);
  for (let i=1;i<turns.length;i++) {
    const p = phaseForTurn(turns[i]);
    if (p !== current) { phases.push({ name: current, fromTurn: start + 1, toTurn: i }); start = i; current = p; }
  }
  phases.push({ name: current, fromTurn: start + 1, toTurn: turns.length });
  return phases;
}
function phaseForTurn(t) {
  const text = `${t.user?.text||''} ${t.assistant?.text||''} ${(t.tools||[]).map(x=>x.name||x.tool||'').join(' ')}`;
  if (/test|verify|validation|spec/i.test(text)) return 'Testing / verification';
  if (/edit|write|patch|apply|implement|refactor|fix/i.test(text)) return 'Implementation';
  if (/search|inspect|investigate|read|find|trace|why/i.test(text)) return 'Discovery / diagnosis';
  return 'Conversation';
}


function analyzePromptEvolution(prompts) {
  const changes=[];
  for(let i=1;i<prompts.length;i++) {
    const p=prompts[i];
    const hits=[];
    if(/\b(don't|do not|without|only|must|preserve|avoid)\b/i.test(p))hits.push('constraint');
    if(/\b(test|coverage|verify|validation)\b/i.test(p))hits.push('verification');
    if(/\b(instead|actually|i meant|wrong|revert|undo)\b/i.test(p))hits.push('correction');
    if(/\b(also|and also|one more|additionally)\b/i.test(p))hits.push('scope addition');
    if(hits.length)changes.push({turn:i+1,kinds:hits,text:oneLine(p,220)});
  }
  return {initial:oneLine(prompts[0]||'',260),changes};
}

function analyzeContextHealth(requests, turns) {
  if(!requests.length)return {status:'UNAVAILABLE',inputGrowth:0,cacheRatio:0,warning:null};
  const inputs=requests.map(r=>asNumber(r.inputTokens)).filter(x=>x>0), cached=requests.reduce((a,r)=>a+asNumber(r.cachedTokens),0), totalInput=requests.reduce((a,r)=>a+asNumber(r.inputTokens),0);
  const first=inputs[0]||0,last=inputs[inputs.length-1]||0,growth=first?last/first:0,cacheRatio=totalInput?cached/totalInput:0;
  let warning=null,status='HEALTHY';
  if(turns.length>=5 && growth>=2 && last>50000){status='BLOATED';warning='Context grew substantially across the session; a fresh chat may have been more efficient for later small follow-ups.';}
  else if(cacheRatio>=0.75 && totalInput>150000){status='CACHE_HEAVY';warning='Most input tokens were cached/repeated context. This may be appropriate for a long task, but small follow-ups can become expensive.';}
  return {status,inputGrowth:Number(growth.toFixed(2)),cacheRatio:Number(cacheRatio.toFixed(3)),firstInput:first,lastInput:last,warning};
}

function attributeWaste({turns,requests,tools,files,promptFindings}) {
  const total=requests.reduce((a,r)=>a+asNumber(r.inputTokens)+asNumber(r.outputTokens),0);
  if(!total)return {basis:'unavailable',categories:[]};
  let correctionWeight=promptFindings.some(f=>f.id==='repeated-corrections')?0.12:0;
  let discoveryWeight=tools.length?Math.min(0.35,tools.filter(t=>/search|read|find|grep|list/i.test(String(t.name||t.tool||''))).length/Math.max(1,tools.length)*0.35):0;
  let retryWeight=turns.filter(t=>/fail|error|retry|revert|undo/i.test(JSON.stringify(t))).length/Math.max(1,turns.length)*0.18;
  let repeatedWeight=requests.reduce((a,r)=>a+asNumber(r.cachedTokens),0)/Math.max(1,requests.reduce((a,r)=>a+asNumber(r.inputTokens),0))*0.18;
  correctionWeight=Math.min(.2,correctionWeight);retryWeight=Math.min(.18,retryWeight);repeatedWeight=Math.min(.18,repeatedWeight);
  const productive=Math.max(.05,1-correctionWeight-discoveryWeight-retryWeight-repeatedWeight);
  const raw=[['Productive implementation / reasoning',productive],['Repository discovery',discoveryWeight],['Repeated cached context',repeatedWeight],['Retries / abandoned direction',retryWeight],['User corrections',correctionWeight]].filter(x=>x[1]>0);
  const norm=raw.reduce((a,x)=>a+x[1],0);
  return {basis:'inferred-from-trace',categories:raw.map(([name,w])=>({name,percent:Math.round(w/norm*100),estimatedTokens:Math.round(total*w/norm)}))};
}

function explainCostDrivers({turns,requests,tools,files,promptFindings,contextHealth}) {
  const drivers=[];const input=requests.reduce((a,r)=>a+asNumber(r.inputTokens),0),cached=requests.reduce((a,r)=>a+asNumber(r.cachedTokens),0),output=requests.reduce((a,r)=>a+asNumber(r.outputTokens),0);
  if(cached>50000)drivers.push({title:'Repeated/cached context',detail:`${cached.toLocaleString()} cached tokens were observed across model calls.`,confidence:'exact'});
  if(requests.length>=8)drivers.push({title:'Many model rounds',detail:`${requests.length} LLM requests occurred in this session.`,confidence:'exact'});
  const discovery=tools.filter(t=>/search|read|find|grep|list/i.test(String(t.name||t.tool||''))).length;if(discovery>=10)drivers.push({title:'Large discovery phase',detail:`${discovery} discovery-oriented tool calls were observed.`,confidence:'derived'});
  if(promptFindings.some(f=>f.id==='repeated-corrections'))drivers.push({title:'Corrective conversation turns',detail:'Multiple later prompts appear to correct earlier direction.',confidence:'inferred'});
  if(contextHealth.warning)drivers.push({title:'Context growth',detail:contextHealth.warning,confidence:'derived'});
  if(!drivers.length && (input+output)>0)drivers.push({title:'Normal model/context work',detail:`${(input+output).toLocaleString()} non-cache input/output tokens were observed without a dominant anomaly.`,confidence:'derived'});
  return drivers;
}

function analyzeConversationHealth({prompts,turns,tools}) {
  const issues=[];
  const corrections=prompts.slice(1).filter(p=>/\b(wrong|instead|revert|undo|not what|i meant|stop)\b/i.test(p)).length;
  if(corrections>=2)issues.push({id:'direction-instability',severity:'warning',title:'Direction changed repeatedly',detail:`${corrections} strong correction/reversal signals were found.`});
  const editTools=tools.filter(t=>/edit|write|patch|apply|replace/i.test(String(t.name||t.tool||'')));
  if(editTools.length>=8 && turns.length>=5)issues.push({id:'edit-churn',severity:'info',title:'High edit churn',detail:`${editTools.length} edit-oriented tool calls occurred across ${turns.length} turns.`});
  return {status:issues.some(x=>x.severity==='warning')?'NEEDS_ATTENTION':issues.length?'WATCH':'HEALTHY',issues};
}

function collectTests(tools) {
  return tools.filter(t => /test|spec|pytest|jest|vitest|mocha|cargo test|npm test/i.test(JSON.stringify(t))).slice(0,50).map(t => ({ name: oneLine(t.name || t.tool || 'test', 80), status: inferStatus(t), detail: oneLine(JSON.stringify(t.result || t.output || t.args || ''), 200) }));
}
function collectCommands(tools) {
  return tools.filter(t => /terminal|shell|command|run/i.test(String(t.name || t.tool || t.type || ''))).slice(0,50).map(t => oneLine(extractCommand(t), 240)).filter(Boolean);
}
function extractCommand(t) { return t.command || t.args?.command || t.input?.command || t.args?.cmd || t.input?.cmd || ''; }
function inferStatus(t) { const s = JSON.stringify(t.result || t.output || '').toLowerCase(); if (/fail|error|non-zero/.test(s)) return 'failed'; if (/pass|success|exit code 0/.test(s)) return 'passed'; return 'observed'; }
function extractUnresolved(text) { return String(text||'').split(/\n+/).filter(x=>/\b(todo|remaining|unresolved|could not|unable|not verified|follow[- ]?up)\b/i.test(x)).slice(0,10).map(x=>oneLine(x,220)); }
function makeTitle(prompt, summary) { const source = prompt || summary || 'Copilot session'; return oneLine(source.replace(/^\s*(please\s+)?/i,''), 90); }
function finding(id, severity, title, detail, extra={}) { return { id, severity, title, detail, ...extra, confidence: 'inferred' }; }

module.exports = { analyzeSession, totalsFromTurns, classifyComplexity, analyzePromptQuality, analyzeModels, collectFiles };
