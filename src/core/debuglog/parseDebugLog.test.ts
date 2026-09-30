import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEBUG_LOG_FIXTURES } from '../../../test/fixtures/fixtures';
import { parseDebugLog } from './parseDebugLog';

const fixture = readFileSync(join(DEBUG_LOG_FIXTURES, 'fx-auto-1', 'main.jsonl'), 'utf8');

describe('parseDebugLog', () => {
  it('extracts one call per llm_request with exact numeric telemetry', () => {
    const log = parseDebugLog('fx-auto-1', fixture);
    expect(log.calls.map((call) => call.spanId)).toEqual(['l1', 'l2', 'l3', 'l4']);
    expect(log.calls[0]).toEqual({
      sessionId: 'fx-auto-1',
      spanId: 'l1',
      responseId: 'llm-resp-1',
      startedAt: 1790000002000,
      durationMs: 8000,
      model: 'gpt-5.6-luna',
      debugName: 'panel/editAgent',
      role: 'USER_FACING',
      inputTokens: 24000,
      outputTokens: 1700,
      cachedTokens: 18000,
      ttftMs: 2100,
      nanoAiu: 1126141000,
    });
  });

  it('classifies utility and unknown calls from debugName and leaves missing numbers null', () => {
    const calls = parseDebugLog('fx-auto-1', fixture).calls;
    expect(calls[2]).toMatchObject({ role: 'COPILOT_INTERNAL', debugName: 'title' });
    expect(calls[3]).toMatchObject({ role: 'UNKNOWN', cachedTokens: null, ttftMs: null, nanoAiu: null });
  });

  it('takes the first Copilot and VS Code versions it sees', () => {
    const log = parseDebugLog('fx-auto-1', fixture);
    expect(log.copilotVersion).toBe('0.99.0');
    expect(log.vscodeVersion).toBe('1.99.0');
  });

  it('never keeps any conversation content', () => {
    expect(JSON.stringify(parseDebugLog('fx-auto-1', fixture))).not.toContain('SECRET');
  });

  it('counts a truncated last line and keeps everything before it', () => {
    const log = parseDebugLog('fx-auto-1', fixture);
    expect(log.badLines).toBe(1);
    expect(log.calls).toHaveLength(4);
  });

  it('ignores duplicate spans, unknown event types and malformed events', () => {
    const text = [
      '{"type":"llm_request","spanId":"a","ts":1,"attrs":{"model":"m"}}',
      '{"type":"llm_request","spanId":"a","ts":2,"attrs":{"model":"other"}}',
      '{"type":"llm_request","ts":3,"attrs":{}}',
      '{"type":"something_new","spanId":"z"}',
      '[1,2,3]',
      '"text"',
      '{"type":"llm_request","spanId":"b","ts":"not-a-number","attrs":{"inputTokens":"12","outputTokens":NaN}}',
    ].join('\n');
    const log = parseDebugLog('s', text);
    expect(log.calls.map((call) => call.spanId)).toEqual(['a']);
    expect(log.calls[0]?.model).toBe('m');
    expect(log.badLines).toBe(1);
  });

  it('is safe against prototype-polluting keys', () => {
    const log = parseDebugLog(
      's',
      '{"type":"llm_request","spanId":"a","ts":1,"attrs":{"__proto__":{"polluted":true},"model":"m"}}',
    );
    expect(log.calls[0]?.model).toBe('m');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
