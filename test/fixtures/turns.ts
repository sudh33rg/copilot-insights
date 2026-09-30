import type { Outcomes, TurnDetail } from '../../src/shared/dto';
import { exact, unavailable } from '../../src/shared/provenance';

/** A minimal `TurnDetail` for analysis tests; override only what a test cares about. */
export function makeTurn(overrides: Partial<TurnDetail> & { index: number }): TurnDetail {
  return {
    startedAt: null,
    state: 'complete',
    systemInitiated: false,
    mode: null,
    userText: null,
    assistantText: null,
    routing: { kind: 'unknown', label: 'Unknown' },
    model: null,
    modelId: null,
    host: 'copilot',
    inputTokens: unavailable('test'),
    outputTokens: unavailable('test'),
    credits: unavailable('test'),
    cachedTokens: unavailable('test'),
    ttftMs: unavailable('test'),
    nanoAiu: unavailable('test'),
    reasoningMs: unavailable('test'),
    toolRounds: exact(0, 'test'),
    toolInputRetries: exact(0, 'test'),
    compactions: exact(0, 'test'),
    contextTokensBefore: unavailable('test'),
    promptComposition: [],
    toolCalls: [],
    fileEvents: [],
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

/** `Outcomes` with nothing observed; override only what a test cares about. */
export function makeOutcomes(overrides: Partial<Outcomes> = {}): Outcomes {
  const none = unavailable<number>('test');
  return {
    linesAdded: none,
    linesRemoved: none,
    editsKept: none,
    editsUndone: none,
    editsUserModified: none,
    editKeepRate: none,
    laterSurvival: none,
    terminalRuns: none,
    terminalFailures: none,
    testRuns: none,
    testFailures: none,
    lastTestPassed: unavailable<boolean>('test'),
    errorsDelta: none,
    warningsDelta: none,
    commits: [],
    ...overrides,
  };
}
