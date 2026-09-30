import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { getDiagnostics } from './diagnostics';

const scan = { role: 'leader' as const, lastSyncAt: 123, lastError: null, parseErrors: 2, badLines: 5 };

describe('getDiagnostics', () => {
  it('reports index size, scan status and debug-log / catalog facts', () => {
    const diagnostics = getDiagnostics(seededStore().database, scan);
    // The synthetic fixtures deliberately include one invalid request and an unknown request key (`futureField`).
    expect(diagnostics.index).toEqual({ sessions: 2, turns: 4, invalidRequests: 1 });
    expect(diagnostics.scan).toEqual(scan);
    expect(diagnostics.debugLog).toEqual({
      sessionsWithLogs: 1,
      llmCalls: 4,
      unknownDebugNames: [{ name: 'mystery-thing', count: 1 }],
      copilotVersionsSeen: ['0.99.0'],
    });
    expect(diagnostics.catalog.models).toBe(3);
  });

  it('surfaces schema drift recorded during ingestion, de-duplicated and sorted', () => {
    const { database } = seededStore();
    database.db.exec(`
      UPDATE sessions SET unknown_part_kinds = '["zebra","alpha"]', unknown_request_keys = '["newKey"]', invalid_requests = 2
       WHERE id = 'fx-auto-1';
      UPDATE sessions SET unknown_part_kinds = '["alpha"]', invalid_requests = 1 WHERE id = 'fx-byok-1';`);
    const { drift, index } = getDiagnostics(database, scan);
    expect(drift).toEqual({
      unknownPartKinds: ['alpha', 'zebra'],
      unknownRequestKeys: ['futureField', 'newKey'],
    });
    expect(index.invalidRequests).toBe(3);
  });

  it('is well-formed and empty on an empty index', () => {
    const { database } = seededStore();
    database.db.exec(
      'DELETE FROM sessions; DELETE FROM llm_calls; DELETE FROM debug_sessions; DELETE FROM models',
    );
    const diagnostics = getDiagnostics(database, { ...scan, role: 'idle', lastSyncAt: null });
    expect(diagnostics.index).toEqual({ sessions: 0, turns: 0, invalidRequests: 0 });
    expect(diagnostics.debugLog.unknownDebugNames).toEqual([]);
    expect(diagnostics.catalog).toEqual({ models: 0, lastSeenAt: null });
  });

  it('contains no conversation text, even with debug logs and prompts in the index', () => {
    const json = JSON.stringify(getDiagnostics(seededStore().database, scan));
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('Fix the timeout race');
  });
});
