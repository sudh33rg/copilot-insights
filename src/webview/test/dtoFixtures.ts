import type { MeasuredNumber, SessionDetail, SessionRow, TurnDetail } from '../../shared/dto';

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
    reasoningMs: 4200,
    toolRounds: 2,
    compactions: 1,
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
        toolCalls: [{ name: 'create_file', status: 'complete' }],
        fileEvents: [{ path: '/repo/test/manager.test.ts', action: 'created' }],
        compactions: 0,
        reasoningMs: 0,
        toolRounds: 1,
      }),
    ],
    ...overrides,
  };
}
