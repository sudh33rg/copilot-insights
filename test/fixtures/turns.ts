import type { TurnDetail } from '../../src/shared/dto';
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
    host: 'copilot',
    inputTokens: unavailable('test'),
    outputTokens: unavailable('test'),
    credits: unavailable('test'),
    cachedTokens: unavailable('test'),
    ttftMs: unavailable('test'),
    nanoAiu: unavailable('test'),
    reasoningMs: unavailable('test'),
    toolRounds: exact(0, 'test'),
    compactions: exact(0, 'test'),
    toolCalls: [],
    fileEvents: [],
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}
