import type { MeasuredNumber, SessionRow } from '../../shared/dto';

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
