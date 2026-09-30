import { describe, expect, it } from 'vitest';
import { makeTurn } from '../../../test/fixtures/turns';
import type { TurnDetail } from '../../shared/dto';
import { exact, unavailable } from '../../shared/provenance';
import { costDrivers } from './costDrivers';

const n = (value: number | null) => (value === null ? unavailable<number>('test') : exact(value, 'test'));
const turn = (index: number, overrides: Partial<TurnDetail> = {}): TurnDetail =>
  makeTurn({ index, ...overrides });
const withInput = (inputs: number[]): TurnDetail[] =>
  inputs.map((input, i) => turn(i + 1, { inputTokens: n(input) }));
const driver = (turns: TurnDetail[], id: string) => costDrivers(turns).find((entry) => entry.id === id);

describe('costDrivers', () => {
  describe('context-growth', () => {
    it('states how much the context grew between the first and last request', () => {
      const found = driver(withInput([24_000, 30_000, 38_000, 47_000, 57_000, 67_200]), 'context-growth');
      expect(found?.evidence).toBe('context grew 2.8× (24,000 input tokens on turn 1 → 67,200 on turn 6)');
      expect(found?.provenance).toEqual({
        kind: 'derived',
        source: 'ratio of exact input tokens, first to last turn',
      });
    });
    it('needs at least three turns and a real increase', () => {
      expect(driver(withInput([10_000, 40_000]), 'context-growth')).toBeUndefined();
      expect(driver(withInput([10_000, 11_000, 12_000]), 'context-growth')).toBeUndefined();
    });
    it('skips turns with unknown input tokens', () => {
      const turns = [...withInput([10_000, 20_000]), turn(3), turn(4, { inputTokens: n(40_000) })];
      expect(driver(turns, 'context-growth')?.evidence).toBe(
        'context grew 4× (10,000 input tokens on turn 1 → 40,000 on turn 4)',
      );
    });
  });

  describe('cache', () => {
    const cached = (input: number, cachedTokens: number | null) =>
      ({ inputTokens: n(input), cachedTokens: n(cachedTokens) }) satisfies Partial<TurnDetail>;
    it('reports cache hits as a fact, not a problem', () => {
      const found = driver(
        [turn(1, cached(50_000, 40_000)), turn(2, cached(60_000, 40_000)), turn(3, cached(74_212, 41_000))],
        'cache',
      );
      expect(found?.evidence).toBe(
        '121,000 of 184,212 input tokens were read from the prompt cache (cache hits are cheaper, not waste)',
      );
      expect(found?.provenance.kind).toBe('derived');
    });
    it('is a lower bound when only some turns reported cache data', () => {
      const found = driver(
        [turn(1, cached(10_000, 5_000)), turn(2, cached(10_000, null)), turn(3, cached(10_000, null))],
        'cache',
      );
      expect(found?.evidence).toContain('1 of 3 turns reported it');
      expect(found?.provenance.source).toContain('lower bound');
      expect(found?.evidence).toContain('5,000 of 10,000');
    });
    it('is absent without any debug-log data', () => {
      expect(driver(withInput([10_000, 20_000, 30_000]), 'cache')).toBeUndefined();
    });
  });

  describe('composition', () => {
    const share = (category: string, label: string, value: number) => ({ category, label, share: n(value) });
    it('weights prompt composition by input tokens and names the biggest parts', () => {
      const found = driver(
        [
          turn(1, {
            inputTokens: n(1_000),
            promptComposition: [
              share('tools', 'Tool definitions', 0.34),
              share('files', 'Files', 0.21),
              share('messages', 'Messages', 0.12),
              share('other', 'Other', 0.03),
            ],
          }),
        ],
        'composition',
      );
      expect(found?.evidence).toBe(
        'on average tool definitions were 34% of the prompt, files 21%, messages 12%',
      );
      expect(found?.provenance.kind).toBe('derived');
    });
    it('falls back to the category when a label is empty, and weights by tokens', () => {
      const found = driver(
        [
          turn(1, { inputTokens: n(1_000), promptComposition: [share('files', '', 0.5)] }),
          turn(2, { inputTokens: n(3_000), promptComposition: [share('files', '', 0.1)] }),
        ],
        'composition',
      );
      expect(found?.evidence).toBe('on average files were 20% of the prompt');
    });
    it('is absent without composition data', () => {
      expect(driver(withInput([1_000]), 'composition')).toBeUndefined();
    });
  });

  describe('rounds', () => {
    const rounds = (toolRounds: number, retries = 0) =>
      ({ toolRounds: n(toolRounds), toolInputRetries: n(retries) }) satisfies Partial<TurnDetail>;
    it('reports many tool rounds and retries', () => {
      const turns = [1, 2, 3, 4, 5, 6].map((i) => turn(i, rounds(i === 6 ? 4 : 3, i === 1 ? 3 : 0)));
      expect(driver(turns, 'rounds')?.evidence).toBe('19 tool rounds across 6 turns, 3 tool-input retries');
      expect(driver(turns, 'rounds')?.provenance.kind).toBe('exact');
    });
    it('appears for a single retry even with few rounds, using the singular', () => {
      expect(driver([turn(1, rounds(2, 1))], 'rounds')?.evidence).toBe(
        '2 tool rounds across 1 turn, 1 tool-input retry',
      );
    });
    it('stays quiet for a few rounds and no retries', () => {
      expect(driver([turn(1, rounds(3))], 'rounds')).toBeUndefined();
    });
  });

  describe('compactions', () => {
    it('reports compactions with the largest context before one', () => {
      const turns = [
        turn(1, { compactions: n(1), contextTokensBefore: n(60_000) }),
        turn(2, { compactions: n(1), contextTokensBefore: n(91_000) }),
      ];
      expect(driver(turns, 'compactions')?.evidence).toBe(
        'context was compacted 2 times (largest context before: 91,000 tokens)',
      );
    });
    it('omits the size when unknown and uses the singular', () => {
      expect(driver([turn(1, { compactions: n(1) })], 'compactions')?.evidence).toBe(
        'context was compacted 1 time',
      );
    });
  });

  describe('failed-work', () => {
    it('counts what failed user turns consumed', () => {
      const turns = [
        turn(1, { state: 'failed', inputTokens: n(20_000) }),
        turn(2, { state: 'failed', inputTokens: n(28_000) }),
        turn(3, { state: 'complete', inputTokens: n(5_000) }),
        turn(4, { state: 'failed', systemInitiated: true, inputTokens: n(99_000) }),
      ];
      expect(driver(turns, 'failed-work')?.evidence).toBe('2 failed turns consumed 48,000 input tokens');
    });
    it('needs known input tokens', () => {
      expect(driver([turn(1, { state: 'failed' })], 'failed-work')).toBeUndefined();
    });
  });

  it('returns nothing for an empty session and never writes a zero as evidence', () => {
    expect(costDrivers([])).toEqual([]);
    const quiet = costDrivers(withInput([10_000]));
    expect(quiet.every((entry) => entry.evidence.trim() !== '')).toBe(true);
  });
});
