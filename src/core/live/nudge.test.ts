import { describe, expect, it } from 'vitest';
import { ACTIVE_WINDOW_MS, liveStatus, statusText } from './nudge';

const NOW = 1_000_000_000;
const turn = (index: number, inputTokens: number | null, credits: number | null = null, compactions = 0) => ({
  index,
  inputTokens,
  credits,
  compactions,
});
const status = (turns: ReturnType<typeof turn>[], endedAt = NOW - 1000) =>
  liveStatus({ now: NOW, endedAt, turns });

describe('liveStatus', () => {
  it('reports the latest context size, credits so far and compactions', () => {
    expect(status([turn(1, 10_000, 0.5), turn(2, 20_000, 0.7, 1), turn(3, 25_000, null)])).toEqual({
      contextTokens: 25_000,
      credits: 1.2,
      compactions: 1,
      nudge: null,
    });
  });

  it('has no credits when Copilot reported none', () => {
    expect(status([turn(1, 10_000), turn(2, 12_000)])?.credits).toBeNull();
  });

  it('nudges when the context is three times where the session started, and not just below that', () => {
    expect(status([turn(1, 10_000), turn(2, 32_000)])?.nudge).toBe(
      'Context is 3.2× where this session started. A fresh session may cost less.',
    );
    expect(status([turn(1, 10_000), turn(2, 29_000)])?.nudge).toBeNull();
    expect(status([turn(1, 10_000), turn(2, 30_000)])?.nudge).toBe(
      'Context is 3× where this session started. A fresh session may cost less.',
    );
  });

  it('nudges after two compactions, and growth wins when both apply', () => {
    expect(status([turn(1, 10_000, null, 1), turn(2, 12_000, null, 1)])?.nudge).toBe(
      'This session has been compacted 2 times. A fresh session may cost less.',
    );
    expect(status([turn(1, 10_000, null, 1)])?.nudge).toBeNull();
    expect(status([turn(1, 10_000, null, 2), turn(2, 50_000)])?.nudge).toMatch(/^Context is 5× /);
  });

  it('reads the start and the latest from turns that have input tokens', () => {
    expect(status([turn(1, null), turn(2, 10_000), turn(3, null), turn(4, 40_000)])).toMatchObject({
      contextTokens: 40_000,
      nudge: 'Context is 4× where this session started. A fresh session may cost less.',
    });
  });

  it('is null for a session that is no longer active, exactly at the limit still active', () => {
    expect(status([turn(1, 10_000)], NOW - ACTIVE_WINDOW_MS - 1)).toBeNull();
    expect(status([turn(1, 10_000)], NOW - ACTIVE_WINDOW_MS)).not.toBeNull();
  });

  it('is null without turns or without any input tokens', () => {
    expect(status([])).toBeNull();
    expect(status([turn(1, null), turn(2, null)])).toBeNull();
  });

  it('never divides by a zero starting context', () => {
    expect(status([turn(1, 0), turn(2, 50_000)])?.nudge).toBeNull();
  });
});

describe('statusText', () => {
  const text = (contextTokens: number, credits: number | null) =>
    statusText({ contextTokens, credits, compactions: 0, nudge: null });

  it('abbreviates context sizes', () => {
    expect(text(999, null)).toBe('Copilot 999 ctx');
    expect(text(48_000, null)).toBe('Copilot 48K ctx');
    expect(text(48_500, null)).toBe('Copilot 48.5K ctx');
    expect(text(1_200_000, null)).toBe('Copilot 1.2M ctx');
    expect(text(999_999, null)).toBe('Copilot 1M ctx');
  });

  it('adds credits with up to two decimals, and leaves them out when unknown', () => {
    expect(text(48_000, 1.234)).toBe('Copilot 48K ctx · 1.23 cr');
    expect(text(48_000, 2)).toBe('Copilot 48K ctx · 2 cr');
    expect(text(48_000, null)).not.toContain('cr');
  });
});
