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
    });
    expect(first?.userText).toContain('Fix the timeout race');
    expect(first?.inputTokens).toEqual({
      value: 24000,
      provenance: { kind: 'exact', source: 'chatSessions.promptTokens' },
    });
    expect(first?.credits.value).toBeCloseTo(1.126141);
    expect(first?.routing).toEqual({ kind: 'auto', label: 'Auto → gpt-5.6-luna' });
    expect(first?.compactions).toEqual({
      value: 1,
      provenance: { kind: 'exact', source: 'chatSessions compaction events' },
    });
  });

  it('exposes redacted tool arguments at full capture and file evidence', () => {
    const turn = getSessionDetail(seededStore().database, 'fx-auto-1')?.turns[0];
    expect(turn?.toolCalls.map((call) => call.name)).toEqual(['read_file', 'replace_string_in_file']);
    expect(turn?.toolCalls[0]).toMatchObject({
      name: 'read_file',
      args: expect.stringContaining('filePath') as string,
      origin: 'toolCallRound',
    });
    expect(turn?.fileEvents).toContainEqual({
      path: '/repo/src/execution/manager.ts',
      action: 'edited',
      source: 'textEditGroup',
    });
    expect(turn?.elapsedMs.value).toBe(8000);
  });

  it('never exposes arguments at lower capture levels, even if a stale row contains them', () => {
    for (const level of ['metrics', 'summaries'] as const) {
      const { database } = seededStore(level);
      database.db.prepare("UPDATE tool_calls SET args = '{}'").run();
      const detail = getSessionDetail(database, 'fx-auto-1');
      expect(detail?.turns.flatMap((turn) => turn.toolCalls).every((call) => call.args === null)).toBe(true);
    }
  });

  it('redacts secret keys before returning arguments and rejects malformed stored JSON', () => {
    const { database } = seededStore();
    database.db
      .prepare('UPDATE tool_calls SET args = :args')
      .run({ args: JSON.stringify({ authorization: 'short', nested: { password: 'hidden' } }) });
    const args = getSessionDetail(database, 'fx-auto-1')?.turns[0]?.toolCalls[0]?.args;
    expect(args).toContain('[REDACTED:secret]');
    expect(args).not.toContain('short');
    expect(args).not.toContain('hidden');
    database.db.prepare("UPDATE tool_calls SET args = 'broken'").run();
    expect(getSessionDetail(database, 'fx-auto-1')?.turns[0]?.toolCalls[0]?.args).toBeNull();
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

  describe('efficiency evidence per turn', () => {
    it('exposes the model id, prompt composition, tool retries and the largest pre-compaction context', () => {
      const { database } = seededStore();
      database.db
        .prepare(
          `UPDATE turns SET prompt_composition = :composition, tool_input_retries = 2, compactions = :compactions
            WHERE session_id = 'fx-auto-1' AND idx = 1`,
        )
        .run({
          composition: JSON.stringify([
            { category: 'tools', label: 'Tool definitions', percent: 34 },
            { category: 'odd', label: 'No percent', percent: null },
          ]),
          compactions: JSON.stringify([
            { contextLengthBefore: 60000, model: null, durationMs: 1, outcome: null },
            { contextLengthBefore: 91000, model: null, durationMs: 1, outcome: null },
          ]),
        });
      const first = getSessionDetail(database, 'fx-auto-1')?.turns[0];
      expect(first?.modelId).toBe('gpt-5.6-luna');
      expect(first?.promptComposition).toEqual([
        {
          category: 'tools',
          label: 'Tool definitions',
          share: { value: 0.34, provenance: { kind: 'exact', source: 'chatSessions promptTokenDetails' } },
        },
      ]);
      expect(first?.toolInputRetries).toEqual({
        value: 2,
        provenance: { kind: 'exact', source: 'chatSessions toolCallRounds' },
      });
      expect(first?.contextTokensBefore.value).toBe(91000);
      expect(first?.contextTokensBefore.provenance.kind).toBe('exact');
    });

    it('marks context before compaction unavailable when the turn never compacted', () => {
      const second = getSessionDetail(seededStore().database, 'fx-auto-1')?.turns[1];
      expect(second?.contextTokensBefore.value).toBeNull();
      expect(second?.contextTokensBefore.provenance.kind).toBe('unavailable');
      expect(second?.promptComposition).toEqual([]);
    });

    it('attaches cost drivers to the session', () => {
      const detail = getSessionDetail(seededStore().database, 'fx-auto-1');
      expect(Array.isArray(detail?.efficiency.drivers)).toBe(true);
      expect(detail?.efficiency.drivers.every((driver) => driver.evidence.trim() !== '')).toBe(true);
    });
  });
});
