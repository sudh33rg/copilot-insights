import type {
  BreakdownRow,
  MeasuredNumber,
  Overview,
  SessionDetail,
  SessionRow,
  TurnDetail,
} from '../../shared/dto';

export const exactNumber = (value: number, source = 'test'): MeasuredNumber => ({
  value,
  provenance: { kind: 'exact', source },
});

export const missing = (source = 'test'): MeasuredNumber => ({
  value: null,
  provenance: { kind: 'unavailable', source },
});

export function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'fx-auto-1',
    day: '2026-09-21',
    startedAt: 1790000001000,
    workspace: 'alpha',
    title: 'Fix run timeout race',
    outcome: 'Changed 2 files (1 edited, 1 created) — in execution, test.',
    routing: { kind: 'auto', label: 'Auto → gpt-5.6-luna' },
    state: 'complete',
    turns: 2,
    failedTurns: 0,
    inputTokens: exactNumber(54000, 'chatSessions.promptTokens'),
    outputTokens: exactNumber(2600, 'chatSessions.completionTokens'),
    credits: exactNumber(1.626141, 'chatSessions.copilotCredits'),
    ...overrides,
  };
}

export function turnDetail(overrides: Partial<TurnDetail> = {}): TurnDetail {
  return {
    index: 1,
    startedAt: 1790000001000,
    state: 'complete',
    systemInitiated: false,
    mode: 'agent',
    userText: 'Fix the timeout race in src/execution/manager.ts',
    assistantText: 'I moved the timer start after the lock is acquired.',
    routing: { kind: 'auto', label: 'Auto → gpt-5.6-luna' },
    model: 'gpt-5.6-luna',
    host: 'copilot',
    inputTokens: exactNumber(24000, 'chatSessions.promptTokens'),
    outputTokens: exactNumber(1700, 'chatSessions.completionTokens'),
    credits: exactNumber(1.126141, 'chatSessions.copilotCredits'),
    cachedTokens: exactNumber(18000, 'agent debug log'),
    ttftMs: exactNumber(2100, 'agent debug log'),
    nanoAiu: exactNumber(1126141000, 'agent debug log'),
    reasoningMs: exactNumber(4200),
    toolRounds: exactNumber(2),
    compactions: exactNumber(1),
    toolCalls: [
      { name: 'read_file', status: 'complete' },
      { name: 'replace_string_in_file', status: 'complete' },
    ],
    fileEvents: [{ path: '/repo/src/execution/manager.ts', action: 'edited' }],
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

export function sessionDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 'fx-auto-1',
    workspace: 'alpha',
    title: 'Fix run timeout race',
    day: '2026-09-21',
    startedAt: 1790000001000,
    endedAt: 1790000100000,
    activeMs: 65000,
    captureLevel: 'full',
    inputTokens: exactNumber(54000, 'chatSessions.promptTokens'),
    outputTokens: exactNumber(2600, 'chatSessions.completionTokens'),
    credits: exactNumber(1.626141, 'chatSessions.copilotCredits'),
    debug: { calls: 4, internalCalls: 1, unmatchedCalls: 1 },
    analysis: {
      intent: {
        value: 'bugfix',
        provenance: { kind: 'inferred', source: 'keyword rules on the first user prompt' },
      },
      outcome: {
        value: 'Changed 2 files (1 edited, 1 created) — in execution, test.',
        provenance: { kind: 'derived', source: 'file events, terminal tool calls and turn state' },
      },
      areas: {
        value: ['execution', 'test'],
        provenance: { kind: 'derived', source: 'parent directories of changed files' },
      },
      complexity: { value: 'moderate', provenance: { kind: 'inferred', source: 'heuristic' } },
      commandCount: exactNumber(0, 'tool calls whose name mentions a terminal'),
      findings: [
        {
          id: 'long-session',
          message: 'Long sessions carry a growing context.',
          evidence: '12 user turns, 2 context compactions',
          provenance: { kind: 'inferred', source: 'prompt rules' },
        },
      ],
    },
    turns: [
      turnDetail(),
      turnDetail({
        index: 2,
        userText: 'Also add a regression test',
        assistantText: 'Added test/manager.test.ts.',
        inputTokens: exactNumber(30000),
        outputTokens: exactNumber(900),
        credits: exactNumber(0.5),
        cachedTokens: missing('agent debug log'),
        ttftMs: missing('agent debug log'),
        nanoAiu: missing('agent debug log'),
        toolCalls: [{ name: 'create_file', status: 'complete' }],
        fileEvents: [{ path: '/repo/test/manager.test.ts', action: 'created' }],
        compactions: exactNumber(0),
        reasoningMs: missing('no reasoning'),
        toolRounds: exactNumber(1),
      }),
    ],
    ...overrides,
  };
}

export function breakdownRow(overrides: Partial<BreakdownRow> = {}): BreakdownRow {
  return {
    key: 'gpt-5.6-luna',
    label: 'gpt-5.6-luna',
    host: 'copilot',
    tier: {
      value: 'powerful',
      provenance: { kind: 'exact' as const, source: 'models.json: model_picker_category' },
    },
    sessions: 1,
    turns: 2,
    inputTokens: exactNumber(54000),
    outputTokens: exactNumber(2600),
    credits: exactNumber(1.626141),
    ...overrides,
  };
}

export function overview(overrides: Partial<Overview> = {}): Overview {
  const period = {
    from: '2026-09-01',
    to: '2026-09-30',
    sessions: 2,
    turns: 4,
    inputTokens: {
      value: 59000,
      provenance: {
        kind: 'derived' as const,
        source: 'chatSessions.promptTokens (lower bound: 3 of 4 turns reported it)',
      },
    },
    outputTokens: exactNumber(2650),
    credits: exactNumber(1.626141),
  };
  return {
    today: { ...period, from: '2026-09-30', sessions: 1, turns: 2, inputTokens: exactNumber(54000) },
    month: period,
    failureRate: { value: 1 / 3, provenance: { kind: 'derived', source: 'turns.state' } },
    byModel: [
      breakdownRow(),
      breakdownRow({
        key: 'qwen3.5:35b',
        label: 'qwen3.5:35b',
        host: 'byok',
        tier: { value: null, provenance: { kind: 'unavailable' as const, source: 'model not in catalog' } },
        credits: missing('BYOK'),
      }),
    ],
    byWorkspace: [
      breakdownRow({ key: 'alpha', label: 'alpha', host: null, tier: null }),
      breakdownRow({ key: 'beta', label: 'beta', host: null, tier: null }),
    ],
    hostSplit: [
      { host: 'byok', turns: 2, sessions: 1 },
      { host: 'copilot', turns: 2, sessions: 1 },
    ],
    internal: {
      sessionsWithLogs: 1,
      calls: 2,
      inputTokens: {
        value: 300,
        provenance: {
          kind: 'derived' as const,
          source: 'agent debug log (lower bound: only sessions with agent debug logging are observable)',
        },
      },
      outputTokens: {
        value: 12,
        provenance: {
          kind: 'derived' as const,
          source: 'agent debug log (lower bound: only sessions with agent debug logging are observable)',
        },
      },
      nanoAiu: {
        value: 2000000,
        provenance: {
          kind: 'derived' as const,
          source: 'agent debug log (lower bound: only sessions with agent debug logging are observable)',
        },
      },
      byName: [
        {
          name: 'title',
          role: 'COPILOT_INTERNAL' as const,
          calls: 1,
          inputTokens: {
            value: 300,
            provenance: {
              kind: 'derived' as const,
              source: 'agent debug log (lower bound: only sessions with agent debug logging are observable)',
            },
          },
        },
        {
          name: 'mystery-thing',
          role: 'UNKNOWN' as const,
          calls: 1,
          inputTokens: {
            value: 10,
            provenance: {
              kind: 'derived' as const,
              source: 'agent debug log (lower bound: only sessions with agent debug logging are observable)',
            },
          },
        },
      ],
    },
    ...overrides,
  };
}
