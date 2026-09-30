import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { Database } from '../storage/database';
import { getFailureAnalytics } from './failureAnalytics';

describe('getFailureAnalytics', () => {
  it('groups finished user-initiated turns by model, provider and mode', () => {
    const analytics = getFailureAnalytics(seededStore().database);
    expect(analytics.byModel.map((row) => [row.key, row.turns, row.failed])).toEqual([
      ['qwen3.5:35b', 1, 1],
      ['gpt-5.6-luna', 2, 0],
    ]);
    expect(analytics.byProvider.map((row) => [row.label, row.turns, row.failed])).toEqual([
      ['ollama', 1, 1],
      ['Copilot', 2, 0],
    ]);
    expect(analytics.byMode.map((row) => [row.label, row.turns, row.failed])).toEqual([
      ['ask', 1, 1],
      ['agent', 2, 0],
    ]);
  });

  it('derives the failure rate and sums retries and tool-call limit hits exactly', () => {
    const { database } = seededStore();
    database.db
      .prepare("UPDATE turns SET max_tool_calls_exceeded = 1 WHERE session_id = 'fx-auto-1' AND idx = 2")
      .run();
    const luna = getFailureAnalytics(database).byModel.find((row) => row.key === 'gpt-5.6-luna');
    expect(luna?.failureRate).toEqual({
      value: 0,
      provenance: { kind: 'derived', source: 'turn state over finished user-initiated turns' },
    });
    expect(luna?.toolInputRetries).toEqual({
      value: 1,
      provenance: { kind: 'exact', source: 'chatSessions toolCallRounds' },
    });
    expect(luna?.maxToolCallsExceeded.value).toBe(1);
    expect(luna?.maxToolCallsExceeded.provenance.kind).toBe('exact');
    const qwen = getFailureAnalytics(database).byModel.find((row) => row.key === 'qwen3.5:35b');
    expect(qwen?.failureRate.value).toBe(1);
  });

  it('leaves out system-initiated, cancelled and unfinished turns (the same population as the Overview rate)', () => {
    const { database } = seededStore();
    database.db.exec("UPDATE turns SET state = 'pending' WHERE session_id = 'fx-auto-1' AND idx = 2");
    const total = getFailureAnalytics(database).byModel.reduce((sum, row) => sum + row.turns, 0);
    expect(total).toBe(2); // luna turn 1 and the failed qwen turn; the cancelled system turn is excluded
  });

  it('labels turns without a model or mode, and groups BYOK models under their provider prefix', () => {
    const { database } = seededStore();
    database.db.exec(
      "UPDATE turns SET resolved_model = NULL, requested_model = NULL, mode = NULL, model_host = 'unknown' WHERE session_id = 'fx-auto-1' AND idx = 2",
    );
    const analytics = getFailureAnalytics(database);
    expect(analytics.byModel.map((row) => row.label)).toContain('Unknown model');
    expect(analytics.byMode.map((row) => row.label)).toContain('unknown');
    expect(analytics.byProvider.map((row) => row.label)).toContain('Unknown');
  });

  it('is empty for an empty index', () => {
    expect(getFailureAnalytics(new Database(':memory:'))).toEqual({
      byModel: [],
      byProvider: [],
      byMode: [],
    });
  });
});
