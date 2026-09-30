import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyMutation, loadChatSessionState, replayMutationLog } from './mutationLog';

const lines = (...entries: unknown[]): string => entries.map((entry) => JSON.stringify(entry)).join('\n');

describe('replayMutationLog', () => {
  it('replaces state with kind 0 and sets nested values with kind 1', () => {
    const { state } = replayMutationLog(
      lines(
        { kind: 0, v: { sessionId: 's1', requests: [] } },
        { kind: 1, k: ['customTitle'], v: 'Title' },
        { kind: 1, k: ['inputState', 'inputText'], v: 'draft' },
      ),
    );
    expect(state).toEqual({
      sessionId: 's1',
      requests: [],
      customTitle: 'Title',
      inputState: { inputText: 'draft' },
    });
  });

  it('appends with kind 2 and truncates to i before appending', () => {
    const { state } = replayMutationLog(
      lines(
        { kind: 0, v: { requests: [] } },
        { kind: 2, k: ['requests'], v: [{ id: 'a', response: [] }] },
        { kind: 2, k: ['requests', 0, 'response'], v: [{ value: 'one' }, { value: 'two' }] },
        { kind: 2, k: ['requests', 0, 'response'], i: 1, v: [{ value: 'TWO' }] },
      ),
    );
    expect(state).toEqual({ requests: [{ id: 'a', response: [{ value: 'one' }, { value: 'TWO' }] }] });
  });

  it('appends without truncating when i is beyond the array length', () => {
    const { state } = replayMutationLog(
      lines({ kind: 0, v: { list: [1] } }, { kind: 2, k: ['list'], i: 5, v: [2] }),
    );
    expect(state).toEqual({ list: [1, 2] });
  });

  it('deletes object keys and array items with kind 3', () => {
    const state = { a: { b: 1, c: 2 }, list: [1, 2, 3] };
    applyMutation(state, { kind: 3, k: ['a', 'b'] });
    applyMutation(state, { kind: 3, k: ['list', 1] });
    expect(state).toEqual({ a: { c: 2 }, list: [1, 3] });
  });

  it('creates missing containers with the right type', () => {
    const state: Record<string, unknown> = {};
    applyMutation(state, { kind: 1, k: ['requests', 0, 'result'], v: { ok: true } });
    expect(Array.isArray(state.requests)).toBe(true);
    expect(state).toEqual({ requests: [{ result: { ok: true } }] });
  });

  it('refuses prototype-polluting key paths', () => {
    const { state } = replayMutationLog(
      lines(
        { kind: 0, v: {} },
        { kind: 1, k: ['__proto__', 'polluted'], v: true },
        { kind: 1, k: ['constructor', 'prototype', 'polluted'], v: true },
      ),
    );
    expect(state).toEqual({});
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('counts and skips a truncated last line (file still being written)', () => {
    const result = replayMutationLog(`${lines({ kind: 0, v: { requests: [] } })}\n{"kind":1,"k":[`);
    expect(result).toEqual({ state: { requests: [] }, entries: 1, badLines: 1 });
  });

  it('ignores mutations that arrive before any snapshot', () => {
    expect(replayMutationLog(lines({ kind: 1, k: ['x'], v: 1 })).state).toBeNull();
  });

  it('handles very large appends without spreading arguments', () => {
    const big = Array.from({ length: 200_000 }, (_, index) => index);
    const { state } = replayMutationLog(
      lines({ kind: 0, v: { list: [] } }, { kind: 2, k: ['list'], v: big }),
    );
    expect((state as { list: number[] }).list).toHaveLength(200_000);
  });
});

describe('loadChatSessionState', () => {
  it('loads legacy single-snapshot .json files', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ci-mlog-')), 'legacy.json');
    writeFileSync(file, JSON.stringify({ sessionId: 'legacy', requests: [{ requestId: 'r' }] }));
    expect(loadChatSessionState(file)).toEqual({
      state: { sessionId: 'legacy', requests: [{ requestId: 'r' }] },
      entries: 1,
      badLines: 0,
    });
  });

  it('replays .jsonl files', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ci-mlog-')), 's.jsonl');
    writeFileSync(file, lines({ kind: 0, v: { requests: [] } }, { kind: 1, k: ['customTitle'], v: 'T' }));
    expect(loadChatSessionState(file).state).toEqual({ requests: [], customTitle: 'T' });
  });
});
