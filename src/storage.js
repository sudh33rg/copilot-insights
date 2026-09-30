'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { id, safeJsonParse } = require('./utils');

const SCHEMA_VERSION = 2;

class SqliteStore {
  constructor(db, filename) {
    this.db = db;
    this.filename = filename;
    this.kind = 'sqlite';
    this.#migrate();
  }

  #migrate() {
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        day TEXT NOT NULL,
        workspace TEXT,
        model TEXT,
        mode TEXT,
        source TEXT NOT NULL,
        capture_level TEXT NOT NULL,
        prompt TEXT,
        response TEXT,
        prompt_summary TEXT,
        response_summary TEXT,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        credits REAL,
        credit_status TEXT DEFAULT 'unavailable',
        duration_ms INTEGER DEFAULT 0,
        status TEXT DEFAULT 'complete',
        metadata_json TEXT DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_day ON sessions(day);
      CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace);
      CREATE INDEX IF NOT EXISTS idx_sessions_model ON sessions(model);

      CREATE TABLE IF NOT EXISTS daily_usage (
        day TEXT NOT NULL,
        source TEXT NOT NULL,
        account TEXT NOT NULL DEFAULT '',
        credits REAL DEFAULT 0,
        interactions INTEGER DEFAULT 0,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        raw_json TEXT DEFAULT '{}',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(day, source, account)
      );

      CREATE TABLE IF NOT EXISTS model_usage (
        day TEXT NOT NULL,
        source TEXT NOT NULL,
        account TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL,
        credits REAL DEFAULT 0,
        interactions INTEGER DEFAULT 0,
        PRIMARY KEY(day, source, account, model)
      );

      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      INSERT OR REPLACE INTO app_meta(key,value) VALUES('schema_version','${SCHEMA_VERSION}');
    `);
  }

  insertSession(s) {
    const stmt = this.db.prepare(`INSERT OR REPLACE INTO sessions(
      id,started_at,ended_at,day,workspace,model,mode,source,capture_level,prompt,response,
      prompt_summary,response_summary,input_tokens,output_tokens,credits,credit_status,duration_ms,status,metadata_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    stmt.run(
      s.id, s.startedAt, s.endedAt || null, s.day, s.workspace || '', s.model || '', s.mode || '', s.source || 'tracked',
      s.captureLevel || 'summaries', s.prompt ?? null, s.response ?? null, s.promptSummary ?? null, s.responseSummary ?? null,
      s.inputTokens || 0, s.outputTokens || 0, s.credits ?? null, s.creditStatus || 'unavailable', s.durationMs || 0,
      s.status || 'complete', JSON.stringify(s.metadata || {})
    );
  }

  upsertDailyUsage(row) {
    this.db.prepare(`INSERT INTO daily_usage(day,source,account,credits,interactions,input_tokens,output_tokens,raw_json,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(day,source,account) DO UPDATE SET
      credits=excluded.credits, interactions=excluded.interactions, input_tokens=excluded.input_tokens,
      output_tokens=excluded.output_tokens, raw_json=excluded.raw_json, updated_at=excluded.updated_at`).run(
        row.day, row.source, row.account || '', row.credits || 0, row.interactions || 0,
        row.inputTokens || 0, row.outputTokens || 0, JSON.stringify(row.raw || {}), Date.now()
      );
  }

  replaceModelUsage(day, source, account, rows) {
    this.#transaction(() => {
      this.db.prepare('DELETE FROM model_usage WHERE day=? AND source=? AND account=?').run(day, source, account || '');
      const ins = this.db.prepare('INSERT INTO model_usage(day,source,account,model,credits,interactions) VALUES(?,?,?,?,?,?)');
      for (const r of rows) ins.run(day, source, account || '', r.model || 'Unknown', r.credits || 0, r.interactions || 0);
    });
  }

  listSessions({ fromDay, toDay, limit = 500, workspace } = {}) {
    const where = [];
    const args = [];
    if (fromDay) { where.push('day>=?'); args.push(fromDay); }
    if (toDay) { where.push('day<=?'); args.push(toDay); }
    if (workspace) { where.push('workspace=?'); args.push(workspace); }
    let sql = 'SELECT * FROM sessions';
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY started_at DESC LIMIT ?'; args.push(limit);
    return this.db.prepare(sql).all(...args).map(mapSqlSession);
  }

  getSession(sessionId) {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
    return row ? mapSqlSession(row) : null;
  }

  listDailyUsage({ fromDay, toDay } = {}) {
    const where = []; const args = [];
    if (fromDay) { where.push('day>=?'); args.push(fromDay); }
    if (toDay) { where.push('day<=?'); args.push(toDay); }
    let sql = 'SELECT * FROM daily_usage';
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY day ASC';
    return this.db.prepare(sql).all(...args).map(r => ({
      day: r.day, source: r.source, account: r.account, credits: r.credits || 0,
      interactions: r.interactions || 0, inputTokens: r.input_tokens || 0, outputTokens: r.output_tokens || 0,
      raw: safeJsonParse(r.raw_json, {}), updatedAt: r.updated_at
    }));
  }

  listModelUsage({ fromDay, toDay } = {}) {
    const where = []; const args = [];
    if (fromDay) { where.push('day>=?'); args.push(fromDay); }
    if (toDay) { where.push('day<=?'); args.push(toDay); }
    let sql = 'SELECT * FROM model_usage';
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY day ASC';
    return this.db.prepare(sql).all(...args).map(r => ({
      day: r.day, source: r.source, account: r.account, model: r.model,
      credits: r.credits || 0, interactions: r.interactions || 0
    }));
  }

  clear(kind, options = {}) {
    const fromDay = options.fromDay || null;
    const toDay = options.toDay || null;
    const workspace = options.workspace || null;
    const clauses = []; const args = [];
    if (fromDay) { clauses.push('day>=?'); args.push(fromDay); }
    if (toDay) { clauses.push('day<=?'); args.push(toDay); }
    if (workspace) { clauses.push('workspace=?'); args.push(workspace); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    this.#transaction(() => {
      if (kind === 'content') {
        const rows = this.db.prepare(`SELECT * FROM sessions${where}`).all(...args);
        const upd = this.db.prepare('UPDATE sessions SET prompt=NULL,response=NULL,prompt_summary=NULL,response_summary=NULL,metadata_json=? WHERE id=?');
        for (const row of rows) upd.run(JSON.stringify(scrubMetadataContent(safeJsonParse(row.metadata_json, {}))), row.id);
      } else if (kind === 'sessions') {
        this.db.prepare(`DELETE FROM sessions${where}`).run(...args);
      } else if (kind === 'usage' && !workspace) {
        const usageClauses = clauses.filter(c => !c.startsWith('workspace'));
        const usageArgs = args.slice(0, usageClauses.length);
        const uw = usageClauses.length ? ` WHERE ${usageClauses.join(' AND ')}` : '';
        this.db.prepare(`DELETE FROM daily_usage${uw}`).run(...usageArgs);
        this.db.prepare(`DELETE FROM model_usage${uw}`).run(...usageArgs);
      } else if (kind === 'all') {
        if (where) this.db.prepare(`DELETE FROM sessions${where}`).run(...args);
        else this.db.prepare('DELETE FROM sessions').run();
        if (!workspace) {
          const usageClauses = clauses.filter(c => !c.startsWith('workspace'));
          const usageArgs = args.slice(0, usageClauses.length);
          const uw = usageClauses.length ? ` WHERE ${usageClauses.join(' AND ')}` : '';
          this.db.prepare(`DELETE FROM daily_usage${uw}`).run(...usageArgs);
          this.db.prepare(`DELETE FROM model_usage${uw}`).run(...usageArgs);
        }
      }
    });
  }

  deleteSession(sessionId) { this.db.prepare('DELETE FROM sessions WHERE id=?').run(sessionId); }

  purgeBefore(day) {
    this.db.prepare('DELETE FROM sessions WHERE day<?').run(day);
  }

  setMeta(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO app_meta(key,value) VALUES(?,?)').run(key, String(value));
  }
  getMeta(key) {
    const row = this.db.prepare('SELECT value FROM app_meta WHERE key=?').get(key);
    return row?.value ?? null;
  }

  #transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  exportAll() {
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      sessions: this.listSessions({ limit: 100000 }),
      dailyUsage: this.listDailyUsage(),
      modelUsage: this.listModelUsage()
    };
  }

  close() { try { this.db.close(); } catch {} }
}

class JsonStore {
  constructor(filename) {
    this.filename = filename;
    this.kind = 'json';
    this.state = { schemaVersion: SCHEMA_VERSION, sessions: [], dailyUsage: [], modelUsage: [], meta: {} };
    this.#load();
  }
  #load() {
    try { this.state = { ...this.state, ...JSON.parse(fs.readFileSync(this.filename, 'utf8')) }; } catch {}
  }
  #save() {
    const tmp = `${this.filename}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.filename);
  }
  insertSession(s) {
    const i = this.state.sessions.findIndex(x => x.id === s.id);
    if (i >= 0) this.state.sessions[i] = s; else this.state.sessions.push(s);
    this.#save();
  }
  upsertDailyUsage(row) {
    const k = x => x.day === row.day && x.source === row.source && (x.account || '') === (row.account || '');
    const i = this.state.dailyUsage.findIndex(k);
    const val = { ...row, updatedAt: Date.now() };
    if (i >= 0) this.state.dailyUsage[i] = val; else this.state.dailyUsage.push(val);
    this.#save();
  }
  replaceModelUsage(day, source, account, rows) {
    this.state.modelUsage = this.state.modelUsage.filter(x => !(x.day === day && x.source === source && (x.account || '') === (account || '')));
    this.state.modelUsage.push(...rows.map(r => ({ day, source, account: account || '', ...r })));
    this.#save();
  }
  listSessions({ fromDay, toDay, limit = 500, workspace } = {}) {
    return this.state.sessions.filter(x => (!fromDay || x.day >= fromDay) && (!toDay || x.day <= toDay) && (!workspace || x.workspace === workspace))
      .sort((a,b) => b.startedAt - a.startedAt).slice(0, limit).map(x => ({ ...x }));
  }
  getSession(sessionId) { const x = this.state.sessions.find(s => s.id === sessionId); return x ? { ...x } : null; }
  listDailyUsage({ fromDay, toDay } = {}) { return this.state.dailyUsage.filter(x => (!fromDay || x.day >= fromDay) && (!toDay || x.day <= toDay)).sort((a,b)=>a.day.localeCompare(b.day)).map(x=>({...x})); }
  listModelUsage({ fromDay, toDay } = {}) { return this.state.modelUsage.filter(x => (!fromDay || x.day >= fromDay) && (!toDay || x.day <= toDay)).sort((a,b)=>a.day.localeCompare(b.day)).map(x=>({...x})); }
  clear(kind, options = {}) {
    const match = x => (!options.fromDay || x.day >= options.fromDay) && (!options.toDay || x.day <= options.toDay) && (!options.workspace || x.workspace === options.workspace);
    if (kind === 'content') this.state.sessions = this.state.sessions.map(x => match(x) ? { ...x, prompt: null, response: null, promptSummary: null, responseSummary: null, metadata: scrubMetadataContent(x.metadata || {}) } : x);
    if (kind === 'sessions' || kind === 'all') this.state.sessions = this.state.sessions.filter(x => !match(x));
    if ((kind === 'usage' || kind === 'all') && !options.workspace) {
      const um = x => (!options.fromDay || x.day >= options.fromDay) && (!options.toDay || x.day <= options.toDay);
      this.state.dailyUsage = this.state.dailyUsage.filter(x => !um(x));
      this.state.modelUsage = this.state.modelUsage.filter(x => !um(x));
    }
    this.#save();
  }
  deleteSession(sessionId) { this.state.sessions = this.state.sessions.filter(x => x.id !== sessionId); this.#save(); }
  purgeBefore(day) { this.state.sessions = this.state.sessions.filter(x => x.day >= day); this.#save(); }
  setMeta(key, value) { this.state.meta[key] = String(value); this.#save(); }
  getMeta(key) { return this.state.meta[key] ?? null; }
  exportAll() { return { ...this.state, exportedAt: new Date().toISOString() }; }
  close() {}
}


function scrubMetadataContent(metadata) {
  const m = JSON.parse(JSON.stringify(metadata || {}));
  if (Array.isArray(m.turns)) {
    m.turns = m.turns.map(t => ({
      ...t,
      user: t.user ? { ...t.user, text: null } : null,
      assistant: t.assistant ? { ...t.assistant, text: null } : null,
      tools: Array.isArray(t.tools) ? t.tools.map(tool => ({ ...tool, args: null, result: null })) : []
    }));
  }
  if (m.analysis) {
    m.analysis = { ...m.analysis, title: null, intent: null, summary: null, unresolvedItems: [] };
  }
  return m;
}

function mapSqlSession(r) {
  return {
    id: r.id, startedAt: r.started_at, endedAt: r.ended_at, day: r.day,
    workspace: r.workspace, model: r.model, mode: r.mode, source: r.source,
    captureLevel: r.capture_level, prompt: r.prompt, response: r.response,
    promptSummary: r.prompt_summary, responseSummary: r.response_summary,
    inputTokens: r.input_tokens || 0, outputTokens: r.output_tokens || 0,
    credits: r.credits, creditStatus: r.credit_status, durationMs: r.duration_ms || 0,
    status: r.status, metadata: safeJsonParse(r.metadata_json, {})
  };
}

function createStore(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const sqliteFile = path.join(directory, 'usage.sqlite3');
  try {
    const { DatabaseSync } = require('node:sqlite');
    return new SqliteStore(new DatabaseSync(sqliteFile), sqliteFile);
  } catch (error) {
    const jsonFile = path.join(directory, 'usage.json');
    const store = new JsonStore(jsonFile);
    store.fallbackReason = String(error?.message || error);
    return store;
  }
}

module.exports = { createStore, SqliteStore, JsonStore, SCHEMA_VERSION, scrubMetadataContent };
