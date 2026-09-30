import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { getSessionDetail } from './sessionDetail';

describe('getSessionDetail', () => {
  it('returns null for an unknown id', () => {
    expect(getSessionDetail(seededStore().database, 'nope')).toBeNull();
  });

  it('returns session totals and per-turn measurements with provenance', () => {
    const detail = getSessionDetail(seededStore().database, 'fx-auto-1');
    expect(detail).toMatchObject({
      id: 'fx-auto-1',
      workspace: 'alpha',
      title: 'Fix run timeout race',
      captureLevel: 'full',
      analysis: null,
    });
    expect(detail?.inputTokens.value).toBe(54000);
    expect(detail?.inputTokens.provenance.kind).toBe('exact');
    expect(detail?.turns.map((turn) => turn.index)).toEqual([1, 2]);
    const first = detail?.turns[0];
    expect(first).toMatchObject({
      state: 'complete',
      systemInitiated: false,
      host: 'copilot',
      model: 'gpt-5.6-luna',
      compactions: 1,
    });
    expect(first?.userText).toContain('Fix the timeout race');
    expect(first?.inputTokens).toEqual({
      value: 24000,
      provenance: { kind: 'exact', source: 'chatSessions.promptTokens' },
    });
    expect(first?.credits.value).toBeCloseTo(1.126141);
    expect(first?.routing).toEqual({ kind: 'auto', label: 'Auto → gpt-5.6-luna' });
  });

  it('lists tool names and file events but never tool arguments', () => {
    const turn = getSessionDetail(seededStore().database, 'fx-auto-1')?.turns[0];
    expect(turn?.toolCalls.map((call) => call.name)).toEqual(['read_file', 'replace_string_in_file']);
    expect(turn?.toolCalls[0]).toEqual({ name: 'read_file', status: expect.any(String) as string });
    expect(turn?.fileEvents).toContainEqual({ path: '/repo/src/execution/manager.ts', action: 'edited' });
    expect(JSON.stringify(turn)).not.toContain('"args"');
  });

  it('marks missing measurements unavailable and keeps system-initiated turns', () => {
    const detail = getSessionDetail(seededStore().database, 'fx-byok-1');
    expect(detail?.turns[0]?.inputTokens.provenance.kind).toBe('unavailable');
    expect(detail?.turns[0]).toMatchObject({ state: 'failed', host: 'byok' });
    expect(detail?.turns[1]).toMatchObject({ state: 'cancelled', systemInitiated: true });
    expect(detail?.inputTokens.provenance.kind).toBe('derived');
    expect(detail?.credits.provenance.kind).toBe('unavailable');
  });

  it('has no conversation text at the metrics capture level', () => {
    const detail = getSessionDetail(seededStore('metrics').database, 'fx-auto-1');
    expect(detail?.title).toBeNull();
    expect(detail?.turns.every((turn) => turn.userText === null && turn.assistantText === null)).toBe(true);
    expect(detail?.turns[0]?.inputTokens.value).toBe(24000);
  });

  it('joins debug-log telemetry to turns by responseId, exact and only when matched', () => {
    const detail = getSessionDetail(seededStore().database, 'fx-auto-1');
    const [first, second] = detail?.turns ?? [];
    expect(first?.cachedTokens).toEqual({
      value: 18000,
      provenance: { kind: 'exact', source: 'agent debug log: llm_request.cachedTokens' },
    });
    expect(first?.ttftMs.value).toBe(2100);
    expect(first?.nanoAiu.value).toBe(1126141000);
    expect(second?.cachedTokens.value).toBe(25000);
    expect(detail?.debug).toEqual({ calls: 4, internalCalls: 1, unmatchedCalls: 1 });
  });

  it('marks telemetry unavailable, with the reason, when there is no matching log', () => {
    const detail = getSessionDetail(seededStore().database, 'fx-byok-1');
    expect(detail?.debug).toBeNull();
    expect(detail?.turns[0]?.cachedTokens).toEqual({
      value: null,
      provenance: { kind: 'unavailable', source: 'agent debug log has no request for this turn' },
    });
  });
});
