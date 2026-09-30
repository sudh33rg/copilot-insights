import type { SessionFacts } from '../../src/core/learning/sessionFacts';

let counter = 0;

/** A `SessionFacts` for statistics tests; override only what a test cares about. */
export function fact(overrides: Partial<SessionFacts> = {}): SessionFacts {
  counter += 1;
  return {
    id: `s${String(counter)}`,
    workspace: 'alpha',
    day: '2026-09-01',
    startedAt: 1_790_000_000_000 + counter,
    taskType: 'bugfix',
    model: 'model-a',
    selection: 'manual',
    host: 'copilot',
    inputTokens: 50_000,
    credits: 1,
    userTurns: 3,
    corrections: 0,
    failedTurns: 0,
    undone: 0,
    lastTestPassed: null,
    editKeepRate: null,
    laterSurvival: null,
    ttftMs: null,
    opening: null,
    successful: true,
    ...overrides,
  };
}

/** `count` facts sharing `overrides`, with `inputTokens` taken from `inputs` (cycled). */
export function many(count: number, overrides: Partial<SessionFacts> = {}, inputs: number[] = [50_000]): SessionFacts[] {
  return Array.from({ length: count }, (_, i) => fact({ ...overrides, inputTokens: inputs[i % inputs.length] ?? null }));
}
