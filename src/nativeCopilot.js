'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { analyzeSession, totalsFromTurns } = require('./sessionAnalyzer');
const { isoDay, oneLine, safeJsonParse } = require('./utils');

class NativeCopilotCollector {
  constructor(vscode, store, output, onUpdated) {
    this.vscode = vscode;
    this.store = store;
    this.output = output;
    this.onUpdated = onUpdated || (() => {});
    this.timer = null;
    this.running = null;
  }

  register(context) {
    const command = this.vscode.commands.registerCommand('copilotInsights.syncSessions', async () => {
      const result = await this.sync({ force: false });
      this.vscode.window.showInformationMessage(`Copilot Insights: ${result.sessions} session(s) refreshed from native Copilot traces.`);
    });
    const enableExact = this.vscode.commands.registerCommand('copilotInsights.enableExactTelemetry', () => this.enableExactTelemetry());
    context.subscriptions.push(command, enableExact);
    setTimeout(() => this.offerExactTelemetryOnce().catch(e => this.logError(e)), 900);
    const refreshSeconds = Math.max(15, Math.min(600, Number(this.vscode.workspace.getConfiguration('copilotInsights').get('nativeRefreshSeconds', 60)) || 60));
    this.timer = setInterval(() => this.sync().catch(e => this.logError(e)), refreshSeconds * 1000);
    context.subscriptions.push({ dispose: () => clearInterval(this.timer) });
    setTimeout(() => this.sync().catch(e => this.logError(e)), 1800);
  }

  async offerExactTelemetryOnce() {
    const enabled = Boolean(this.vscode.workspace.getConfiguration().get('github.copilot.chat.agentDebugLog.fileLogging.enabled', false));
    if (enabled || this.store.getMeta('native:exactTelemetryPrompted') === 'never') return;
    const installed = this.vscode.extensions.getExtension('github.copilot-chat');
    if (!installed) return;
    const choice = await this.vscode.window.showInformationMessage(
      'Copilot Insights can show exact per-request input/output/cached tokens, actual models and tool execution when GitHub Copilot Agent Debug file logging is enabled. These Copilot logs can contain prompts and code context and remain local on this machine.',
      'Enable Exact Telemetry', 'Not now', 'Don’t ask again');
    if (choice === 'Enable Exact Telemetry') await this.enableExactTelemetry();
    if (choice === 'Don’t ask again') this.store.setMeta('native:exactTelemetryPrompted', 'never');
  }

  async enableExactTelemetry() {
    const cfg = this.vscode.workspace.getConfiguration();
    await cfg.update('github.copilot.chat.agentDebugLog.fileLogging.enabled', true, this.vscode.ConfigurationTarget.Global);
    this.store.setMeta('native:exactTelemetryPrompted', 'enabled');
    this.vscode.window.showInformationMessage('GitHub Copilot Agent Debug file logging enabled. New Copilot sessions can now expose exact per-request token/cache/model telemetry locally.');
    return true;
  }

  async sync(options = {}) {
    if (this.running) return this.running;
    this.running = this.#sync(options).finally(() => { this.running = null; });
    return this.running;
  }

  async #sync({ force = false } = {}) {
    const started = Date.now();
    const roots = discoverStorageRoots(this.vscode);
    let sessions = 0, files = 0, skipped = 0;
    for (const root of roots) {
      const workspaces = safeDirEntries(root).filter(x => x.isDirectory()).slice(0, 10000);
      for (const entry of workspaces) {
        const wsDir = path.join(root, entry.name);
        const ws = readWorkspaceLabel(wsDir);
        const transcriptFiles = findTranscriptFiles(wsDir);
        const debugFiles = findDebugFiles(wsDir);
        const debugBySession = indexDebugFiles(debugFiles);
        for (const transcriptFile of transcriptFiles) {
          files++;
          const baseFingerprint = fileFingerprint(transcriptFile);
          if (!baseFingerprint) continue;
          const parsedHeaderId = path.basename(transcriptFile).replace(/\.jsonl?$|\.json$/i,'');
          const relatedHint = chooseDebugForSession(parsedHeaderId, transcriptFile, debugBySession);
          const fingerprint = `${baseFingerprint}|${relatedHint ? (fileFingerprint(relatedHint) || '') : ''}`;
          const key = `scan:${hash(transcriptFile)}`;
          if (!force && this.store.getMeta(key) === fingerprint) { skipped++; continue; }
          try {
            const parsed = parseTranscript(transcriptFile, ws);
            if (!parsed) { this.store.setMeta(key, fingerprint); continue; }
            const related = chooseDebugForSession(parsed.id, transcriptFile, debugBySession) || relatedHint;
            const compositeFingerprint = `${baseFingerprint}|${related ? (fileFingerprint(related) || '') : ''}`;
            const debug = related ? parseDebugLog(related) : { turns: [], requests: [], tools: [] };
            const merged = mergeSession(parsed, debug, related);
            const captureLevel = this.vscode.workspace.getConfiguration('copilotInsights').get('captureLevel', 'full');
            const record = toStoreRecord(merged, captureLevel);
            this.store.insertSession(record);
            this.store.setMeta(key, compositeFingerprint);
            if (related) this.store.setMeta(`scan:${hash(related)}`, fileFingerprint(related) || '');
            sessions++;
          } catch (e) {
            this.output.appendLine(`[native] parse failed ${transcriptFile}: ${e.stack || e}`);
          }
        }
      }
    }
    if (sessions) this.onUpdated();
    this.store.setMeta('native:lastSyncAt', String(Date.now()));
    this.output.appendLine(`[native] scan roots=${roots.length} files=${files} refreshed=${sessions} unchanged=${skipped} in ${Date.now()-started}ms`);
    return { roots: roots.length, files, sessions, skipped };
  }

  logError(e) { this.output.appendLine(`[native] scan failed: ${e.stack || e}`); }
}

function discoverStorageRoots(vscode, env = process.env, platform = process.platform, home = os.homedir()) {
  const configured = vscode?.workspace?.getConfiguration?.('copilotInsights')?.get?.('nativeStorageRoots', []) || [];
  const candidates = [...configured];
  if (platform === 'win32') {
    const app = env.APPDATA;
    if (app) for (const name of ['Code','Code - Insiders']) candidates.push(path.join(app,name,'User','workspaceStorage'));
  } else if (platform === 'darwin') {
    for (const name of ['Code','Code - Insiders']) candidates.push(path.join(home,'Library','Application Support',name,'User','workspaceStorage'));
  } else {
    for (const name of ['Code','Code - Insiders']) candidates.push(path.join(env.XDG_CONFIG_HOME || path.join(home,'.config'),name,'User','workspaceStorage'));
  }
  return [...new Set(candidates.map(x=>path.resolve(String(x))))].filter(isDirectory);
}

function findTranscriptFiles(wsDir) {
  const candidates = [path.join(wsDir,'chatSessions'), path.join(wsDir,'GitHub.copilot-chat','chatSessions'), path.join(wsDir,'GitHub.copilot-chat','transcripts'), path.join(wsDir,'github.copilot-chat','transcripts')];
  const out = [];
  for (const d of candidates) for (const e of safeDirEntries(d)) if (e.isFile() && /\.jsonl$|\.json$/i.test(e.name)) out.push(path.join(d,e.name));
  return out;
}
function findDebugFiles(wsDir) {
  const roots = [path.join(wsDir,'GitHub.copilot-chat','debug-logs'), path.join(wsDir,'github.copilot-chat','debug-logs')];
  const out=[];
  for (const r of roots) {
    for (const s of safeDirEntries(r)) {
      const sd = path.join(r,s.name);
      if (s.isDirectory()) for (const f of safeDirEntries(sd)) if (f.isFile() && /\.jsonl$/i.test(f.name)) out.push(path.join(sd,f.name));
      else if (s.isFile() && /\.jsonl$/i.test(s.name)) out.push(sd);
    }
  }
  return out;
}
function indexDebugFiles(files) {
  const m=new Map();
  for (const f of files) { const sessionId=path.basename(path.dirname(f)); if (!m.has(sessionId)) m.set(sessionId,[]); m.get(sessionId).push(f); }
  return m;
}
function chooseDebugForSession(sessionId, transcriptFile, debugBySession) {
  if (debugBySession.has(sessionId)) return newest(debugBySession.get(sessionId));
  const base=path.basename(transcriptFile).replace(/\.jsonl?$|\.json$/i,'');
  if (debugBySession.has(base)) return newest(debugBySession.get(base));
  for (const [id,files] of debugBySession) if (sessionId.includes(id)||id.includes(sessionId)||base.includes(id)||id.includes(base)) return newest(files);
  return null;
}
function newest(files){return [...files].sort((a,b)=>(safeStat(b)?.mtimeMs||0)-(safeStat(a)?.mtimeMs||0))[0]||null;}

function parseTranscript(filename, workspace) {
  const rows = readJsonRecords(filename);
  if (!rows.length) return null;
  const sessionId = findSessionId(rows, filename);
  const turns = rows.length === 1 ? (normalizeSessionSnapshot(rows[0]) || normalizeTranscriptRows(rows)) : normalizeTranscriptRows(rows);
  const startedAt = firstTimestamp(rows) || safeStat(filename)?.birthtimeMs || safeStat(filename)?.mtimeMs || Date.now();
  const endedAt = lastTimestamp(rows) || safeStat(filename)?.mtimeMs || startedAt;
  const selected = inferSelection(rows);
  return {
    id: sessionId, sourceFile: filename, workspace, startedAt, endedAt,
    turns, selectionMode: selected.mode, selectedModel: selected.model,
    mode: inferChatMode(rows), rawMetadata: { transcriptRows: rows.length }
  };
}

function parseDebugLog(filename) {
  const rows = readJsonRecords(filename);
  const requests=[]; const tools=[]; const turnMarkers=[];
  for (const row of rows) {
    const type = eventType(row);
    const ts = timestamp(row);
    if (/llm[_ .-]?request|model[_ .-]?request|chat[_ .-]?request/i.test(type)) requests.push(normalizeLlmRequest(row, ts));
    if (/tool|command|terminal|edit|patch|read|search/i.test(type)) tools.push(normalizeTool(row, ts));
    if (/turn[_ .-]?(start|end)|user[_ .-]?message|agent[_ .-]?response/i.test(type)) turnMarkers.push({ type, ts, raw: row });
  }
  return { file: filename, rows: rows.length, requests: requests.filter(Boolean), tools: tools.filter(Boolean), turnMarkers };
}

function mergeSession(transcript, debug, debugFile) {
  const turns = transcript.turns.length ? transcript.turns.map((t,i)=>({ ...t, index:i+1, llmRequests:[], tools:[] })) : [{ index:1, user:{text:''}, assistant:{text:''}, llmRequests:[], tools:[] }];
  assignByTime(turns, debug.requests, 'llmRequests');
  assignByTime(turns, debug.tools, 'tools');
  for (const t of turns) {
    for (const r of t.llmRequests) {
      if (!r.selectionMode || r.selectionMode === 'UNKNOWN') r.selectionMode = transcript.selectionMode || 'UNKNOWN';
      r.selectedModel = r.selectedModel || transcript.selectedModel || (r.selectionMode === 'AUTO' ? 'auto' : null);
      r.selectionSource = selectionSource(r.selectionMode, r.kind);
    }
  }
  const totals=totalsFromTurns(turns);
  const analysis=analyzeSession({ ...transcript, turns });
  const actualModels=[...new Set(debug.requests.map(r=>r.resolvedModel||r.model).filter(Boolean))];
  return { ...transcript, turns, totals, analysis, debugFile, actualModels, debugRows:debug.rows };
}

function assignByTime(turns, events, field) {
  for (const ev of events) {
    let best = turns[turns.length-1];
    if (ev.ts) {
      for (const t of turns) {
        const start=t.startedAt||t.user?.ts||0, end=t.endedAt||t.assistant?.ts||Number.MAX_SAFE_INTEGER;
        if (ev.ts>=start && ev.ts<=end) { best=t; break; }
        if (start && ev.ts<start) { best=t; break; }
      }
    }
    best[field].push(ev);
  }
}

function toStoreRecord(s, captureLevel) {
  const primaryModel = s.actualModels[0] || s.selectedModel || 'Unknown';
  const turns = applyCaptureLevel(s.turns, captureLevel);
  const metadata = {
    native: true, sourceFile: s.sourceFile, debugFile: s.debugFile || null,
    selectedModel: s.selectedModel || null, selectionMode: s.selectionMode || 'UNKNOWN',
    actualModels: s.actualModels, cachedTokens: s.totals.cachedTokens, llmCalls:s.totals.llmCalls,
    turns, analysis:s.analysis,
    provenance: { session:'exact', transcript:'exact', llmTelemetry:s.debugFile?'exact':'unavailable', analysis:'derived/inferred' }
  };
  return {
    id:s.id, startedAt:s.startedAt, endedAt:s.endedAt, day:isoDay(s.startedAt), workspace:s.workspace,
    model:primaryModel, mode:s.mode||'chat', source:'vscode-github-copilot-native', captureLevel,
    prompt:captureLevel==='full' ? s.turns.map(t=>t.user?.text).filter(Boolean).join('\n\n') : null,
    response:captureLevel==='full' ? s.turns.map(t=>t.assistant?.text).filter(Boolean).join('\n\n') : null,
    promptSummary:captureLevel==='metrics'?null:(s.analysis.intent || ''),
    responseSummary:captureLevel==='metrics'?null:(s.analysis.summary || ''),
    inputTokens:s.totals.inputTokens, outputTokens:s.totals.outputTokens,
    credits:s.totals.credits > 0 ? s.totals.credits : null,
    creditStatus:s.totals.credits > 0 ? 'exact-from-copilot-trace' : 'unavailable-per-session',
    durationMs:Math.max(0,s.endedAt-s.startedAt), status:'complete', metadata
  };
}

function applyCaptureLevel(turns, level) {
  if (level==='full') return turns;
  return turns.map(t=>({ ...t, user: t.user ? { ...t.user, text: level==='metrics'?null:oneLine(t.user.text,260) } : null,
    assistant:t.assistant ? { ...t.assistant, text: level==='metrics'?null:oneLine(t.assistant.text,420) } : null,
    llmRequests:t.llmRequests, tools:t.tools }));
}

function normalizeSessionSnapshot(root) {
  const requests = root?.requests || root?.data?.requests || root?.session?.requests;
  if (!Array.isArray(requests) || !requests.length) return null;
  const turns=[];
  for (const req of requests) {
    const userText = extractSnapshotUser(req);
    const assistantText = extractSnapshotAssistant(req);
    if (!userText && !assistantText) continue;
    const startedAt = timestamp(req) || timestamp(req?.message) || 0;
    const endedAt = timestamp(req?.response) || startedAt;
    const selectedModel = deepFind(req,['selectedModel','requestedModel','modelId','model']);
    const files = extractFilesFromObject(req);
    turns.push({startedAt,endedAt,user:userText?{text:userText,ts:startedAt}:null,assistant:assistantText?{text:assistantText,ts:endedAt}:null,files,selectedModel:selectedModel?String(selectedModel):null});
  }
  for(let i=0;i<turns.length;i++) if(!turns[i].endedAt) turns[i].endedAt=turns[i+1]?.startedAt||Number.MAX_SAFE_INTEGER;
  return turns;
}
function extractSnapshotUser(req) {
  const m=req?.message ?? req?.prompt ?? req?.request?.message ?? req?.request?.prompt;
  if(typeof m==='string')return m.trim();
  if(typeof m?.text==='string')return m.text.trim();
  if(typeof m?.value==='string')return m.value.trim();
  if(typeof m?.message==='string')return m.message.trim();
  return '';
}
function extractSnapshotAssistant(req) {
  const r=req?.response ?? req?.answer ?? req?.result;
  if(typeof r==='string')return r.trim();
  if(typeof r?.text==='string')return r.text.trim();
  if(typeof r?.value==='string')return r.value.trim();
  if(Array.isArray(r)) return r.map(part => {
    if(typeof part==='string') return part;
    const v=part?.value ?? part?.content ?? part?.text ?? part?.message;
    if(typeof v==='string')return v;
    if(typeof v?.value==='string')return v.value;
    return '';
  }).filter(Boolean).join('\n').trim();
  return '';
}

function normalizeTranscriptRows(rows) {
  const turns=[]; let current=null;
  const pushCurrent=()=>{ if(current && (current.user?.text||current.assistant?.text)) turns.push(current); current=null; };
  for (const row of rows) {
    const role = detectRole(row); const text = extractText(row); const ts=timestamp(row);
    if (role==='user' && text) { pushCurrent(); current={ startedAt:ts||0, endedAt:0, user:{text,ts}, assistant:null, files:[] }; continue; }
    if (role==='assistant' && text) { if(!current) current={startedAt:ts||0,user:null,assistant:null,files:[]}; const prior=current.assistant?.text||''; current.assistant={text:prior?`${prior}\n${text}`:text,ts}; current.endedAt=ts||current.endedAt; continue; }
    if (current) {
      const files=extractFilesFromObject(row); if(files.length) current.files.push(...files);
      const model=deepFind(row,['model','modelId','model_id']); if(model) current.selectedModel=current.selectedModel||String(model);
    }
  }
  pushCurrent();
  for(let i=0;i<turns.length;i++){ if(!turns[i].endedAt) turns[i].endedAt=turns[i+1]?.startedAt || Number.MAX_SAFE_INTEGER; }
  return turns;
}

function detectRole(row) {
  const role=String(deepFind(row,['role','author','speaker','kind','type','event'])||'').toLowerCase();
  if (/user|human|request|prompt/.test(role) && !/assistant|agent_response/.test(role)) return 'user';
  if (/assistant|copilot|agent_response|response/.test(role) && !/request/.test(role)) return 'assistant';
  if (row?.request?.message || row?.prompt) return 'user';
  if (row?.response?.message || row?.response?.text || row?.answer) return 'assistant';
  return null;
}
function extractText(row) {
  const candidates=[row?.message?.text,row?.message?.value,row?.message,row?.text,row?.content,row?.prompt,row?.request?.message,row?.request?.prompt,row?.response?.message,row?.response?.text,row?.response?.content,row?.answer,row?.value];
  for (const c of candidates) {
    if (typeof c==='string' && c.trim()) return c.trim();
    if (Array.isArray(c)) { const s=c.map(x=>typeof x==='string'?x:(x?.text||x?.value||'')).filter(Boolean).join('\n'); if(s.trim()) return s.trim(); }
  }
  return '';
}
function normalizeLlmRequest(row, ts) {
  const usage = row.usage || row.tokenUsage || row.metrics || row.data?.usage || row.data?.tokenUsage || row.payload?.usage || {};
  const model = deepFind(row,['resolvedModel','model','modelId','model_id','modelName']);
  if (!model && !Object.keys(usage).length) return null;
  const selected=deepFind(row,['selectedModel','requestedModel','userSelectedModel']);
  const modeRaw=String(deepFind(row,['selectionMode','modelSelectionMode','selectedBy'])||'').toLowerCase();
  const mode = /auto|router/.test(modeRaw)||String(selected).toLowerCase()==='auto' ? 'AUTO' : (/manual|user/.test(modeRaw)||selected ? 'MANUAL':'UNKNOWN');
  return {
    id:String(deepFind(row,['requestId','id','request_id'])||hash(JSON.stringify(row).slice(0,400))), ts,
    kind:/utility|title|summary|intent|rename/i.test(JSON.stringify(row).slice(0,700))?'UTILITY':'PRIMARY',
    selectedModel:selected?String(selected):null, resolvedModel:model?String(model):null, selectionMode:mode,
    inputTokens:numberFrom(usage,['inputTokens','input_tokens','prompt_tokens','promptTokens']) ?? numberFrom(row,['inputTokens','input_tokens']),
    outputTokens:numberFrom(usage,['outputTokens','output_tokens','completion_tokens','completionTokens']) ?? numberFrom(row,['outputTokens','output_tokens']),
    cachedTokens:numberFrom(usage,['cachedTokens','cached_tokens','cache_read_input_tokens','cacheReadTokens']) ?? numberFrom(row,['cachedTokens','cached_tokens']),
    credits:numberFrom(row,['credits','aiCredits','ai_credits']),
    premiumRequestCost:numberFrom(row,['premiumRequestCost','premium_request_cost']),
    reasoningEffort:deepFind(row,['reasoningEffort','reasoning_effort','thinkingLevel']) || null,
    provenance:'exact-debug-log'
  };
}
function normalizeTool(row, ts) {
  const name=String(deepFind(row,['toolName','tool','name','commandName'])||eventType(row)||'tool');
  return { id:String(deepFind(row,['toolCallId','id','callId'])||hash(JSON.stringify(row).slice(0,400))), ts, name,
    args: row.args || row.arguments || row.input || row.data?.args || row.payload?.args || {},
    result: row.result || row.output || row.data?.result || row.payload?.result || null,
    status: deepFind(row,['status','state']) || null, provenance:'exact-debug-log' };
}

function inferSelection(rows) {
  let explicit=null, auto=false;
  for(const row of rows){ const m=deepFind(row,['selectedModel','requestedModel','modelId','model']); if(m){ const s=String(m); if(s.toLowerCase()==='auto') auto=true; else explicit=explicit||s; } const a=deepFind(row,['selectionMode','modelSelectionMode']); if(String(a).toLowerCase().includes('auto')) auto=true; }
  if(auto) return {mode:'AUTO',model:'auto'};
  if(explicit) return {mode:'MANUAL',model:explicit};
  return {mode:'UNKNOWN',model:null};
}
function selectionSource(mode, kind){ if(kind==='UTILITY') return 'COPILOT_INTERNAL'; if(mode==='AUTO')return 'COPILOT_AUTO'; if(mode==='MANUAL')return 'USER'; return 'UNKNOWN'; }
function inferChatMode(rows){ const s=String(deepFind(rows,['mode','chatMode','agentMode'])||'chat'); return s; }
function findSessionId(rows, filename){ const v=deepFind(rows,['sessionId','session_id','chatSessionId']); return String(v||path.basename(filename).replace(/\.jsonl?$|\.json$/i,'')); }
function firstTimestamp(rows){ for(const r of rows){const t=timestamp(r);if(t)return t;} return 0; }
function lastTimestamp(rows){ for(let i=rows.length-1;i>=0;i--){const t=timestamp(rows[i]);if(t)return t;} return 0; }
function timestamp(row){ const v=deepFind(row,['timestamp','time','ts','createdAt','created_at','date']); if(v==null)return 0; if(typeof v==='number')return v<1e12?v*1000:v; const n=Date.parse(v); return Number.isFinite(n)?n:0; }
function eventType(row){ return String(row.event || row.type || row.kind || row.name || row.eventType || row.data?.type || row.payload?.type || ''); }
function extractFilesFromObject(row){ const text=JSON.stringify(row); return [...text.matchAll(/(?:file:\/\/)?(?:[A-Za-z]:)?(?:\/[\w.@()+\- ]+){1,12}\.[A-Za-z0-9_-]{1,12}|(?:[\w.@()+\-]+\/){1,10}[\w.@()+\-]+\.[A-Za-z0-9_-]{1,12}/g)].slice(0,30).map(m=>({path:m[0],action:/edit|write|patch|change/i.test(eventType(row))?'modified':'read'})); }
function deepFind(value, keys) { const wanted=new Set(keys.map(x=>x.toLowerCase())); const seen=new Set(); function walk(v,depth){ if(v==null||depth>5||typeof v!=='object'||seen.has(v))return undefined; seen.add(v); if(Array.isArray(v)){for(const x of v){const y=walk(x,depth+1);if(y!==undefined)return y;}return undefined;} for(const [k,x] of Object.entries(v)){ if(wanted.has(k.toLowerCase()) && (typeof x==='string'||typeof x==='number'||typeof x==='boolean'))return x; } for(const x of Object.values(v)){const y=walk(x,depth+1);if(y!==undefined)return y;} return undefined;} return walk(value,0); }
function numberFrom(value, keys){ const v=deepFind(value,keys); if(v==null)return null; const n=Number(v); return Number.isFinite(n)?n:null; }

function readJsonRecords(filename) {
  const raw=fs.readFileSync(filename,'utf8').trim(); if(!raw)return [];
  if (/\.json$/i.test(filename)) { const j=safeJsonParse(raw,null); if(Array.isArray(j))return j; if(j && Array.isArray(j.entries))return j.entries; return j?[j]:[]; }
  const out=[]; for(const line of raw.split(/\r?\n/)){ const j=safeJsonParse(line,null); if(j)out.push(j); } return out;
}
function readWorkspaceLabel(wsDir) { const j=safeJsonParse(safeRead(path.join(wsDir,'workspace.json')),''); if(j?.folder) return oneLine(path.basename(String(j.folder).replace(/\/$/,'')),90)||'Workspace'; if(j?.workspace) return oneLine(path.basename(String(j.workspace).replace(/\/$/,'')),90)||'Workspace'; return `workspace:${path.basename(wsDir).slice(0,8)}`; }
function safeRead(f){try{return fs.readFileSync(f,'utf8')}catch{return ''}}
function safeDirEntries(d){try{return fs.readdirSync(d,{withFileTypes:true})}catch{return []}}
function safeStat(f){try{return fs.statSync(f)}catch{return null}}
function isDirectory(f){try{return fs.statSync(f).isDirectory()}catch{return false}}
function fileFingerprint(f){const s=safeStat(f);return s?`${s.size}:${Math.floor(s.mtimeMs)}`:null;}
function hash(s){return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0,20);}

module.exports = { NativeCopilotCollector, discoverStorageRoots, findTranscriptFiles, findDebugFiles, parseTranscript, parseDebugLog, mergeSession, normalizeLlmRequest, normalizeTranscriptRows, normalizeSessionSnapshot, toStoreRecord };
