import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEBUG_LOG_FIXTURES } from '../../../test/fixtures/fixtures';
import { parseDebugLog } from '../debuglog/parseDebugLog';
import { Database } from './database';
import { LlmCallStore } from './llmCallStore';

const log = () =>
  parseDebugLog('fx-auto-1', readFileSync(join(DEBUG_LOG_FIXTURES, 'fx-auto-1', 'main.jsonl'), 'utf8'));
const count = (database: Database, table: string): number =>
  (database.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('LlmCallStore', () => {
  it('stores calls and session metadata, and replaces a session on re-parse', () => {
    const database = new Database(':memory:');
    const store = new LlmCallStore(database);
    store.replaceSession(log(), '/x/main.jsonl', 5);
    store.replaceSession(log(), '/x/main.jsonl', 6);
    expect(count(database, 'llm_calls')).toBe(4);
    expect(database.db.prepare('SELECT * FROM debug_sessions').get()).toMatchObject({
      session_id: 'fx-auto-1',
      copilot_version: '0.99.0',
      calls: 4,
    });
    expect(database.db.prepare("SELECT role FROM llm_calls WHERE span_id = 'l3'").get()).toEqual({
      role: 'COPILOT_INTERNAL',
    });
  });

  it('stores no conversation text anywhere in the database', () => {
    const database = new Database(':memory:');
    new LlmCallStore(database).replaceSession(log(), '/x/main.jsonl', 5);
    const dump = JSON.stringify([
      database.db.prepare('SELECT * FROM llm_calls').all(),
      database.db.prepare('SELECT * FROM debug_sessions').all(),
    ]);
    expect(dump).not.toContain('SECRET');
  });

  it('deletes by session id', () => {
    const database = new Database(':memory:');
    const store = new LlmCallStore(database);
    store.replaceSession(log(), '/x/main.jsonl', 5);
    store.deleteSessions(['fx-auto-1']);
    expect(count(database, 'llm_calls')).toBe(0);
    expect(count(database, 'debug_sessions')).toBe(0);
  });

  describe('prompt file sizes', () => {
    const withSizes = () => ({
      ...log(),
      toolDefs: [
        { name: 'read_file', chars: 400 },
        { name: 'grep_search', chars: 900 },
      ],
      systemPromptChars: 46_352,
    });

    it('stores tool names with sizes and the system prompt size, and replaces them on re-parse', () => {
      const database = new Database(':memory:');
      const store = new LlmCallStore(database);
      store.replaceSession(withSizes(), '/x/main.jsonl', 5);
      store.replaceSession(
        { ...withSizes(), toolDefs: [{ name: 'only_one', chars: 10 }] },
        '/x/main.jsonl',
        6,
      );
      expect(store.getToolDefs('fx-auto-1')).toEqual([{ name: 'only_one', chars: 10 }]);
      expect(store.getPromptFiles('fx-auto-1')).toEqual({ systemPromptChars: 46_352, toolDefsChars: 10 });
    });

    it('returns null sizes when none were read', () => {
      const database = new Database(':memory:');
      const store = new LlmCallStore(database);
      store.replaceSession(log(), '/x/main.jsonl', 5);
      expect(store.getToolDefs('fx-auto-1')).toBeNull();
      expect(store.getPromptFiles('fx-auto-1')).toEqual({ systemPromptChars: null, toolDefsChars: null });
    });

    it('is removed with the session', () => {
      const database = new Database(':memory:');
      const store = new LlmCallStore(database);
      store.replaceSession(withSizes(), '/x/main.jsonl', 5);
      store.deleteSessions(['fx-auto-1']);
      expect(count(database, 'llm_tool_defs')).toBe(0);
      expect(count(database, 'llm_prompt_files')).toBe(0);
    });
  });
});
