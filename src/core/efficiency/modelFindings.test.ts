import { describe, expect, it } from 'vitest';
import { makeTurn } from '../../../test/fixtures/turns';
import type { TurnDetail } from '../../shared/dto';
import { exact } from '../../shared/provenance';
import { modelFindings } from './modelFindings';
import type { ModelPrice } from './priceCounterfactual';

const prices: ModelPrice[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: `m${String(n)}`,
  name: `Model ${String(n)}`,
  inputPrice: n,
  outputPrice: n * 3,
  cacheReadPrice: null,
  batchSize: 1000,
}));
const EXPENSIVE = 'm6';
const LIGHT = 'm1';

const turn = (
  index: number,
  modelId: string,
  overrides: Partial<TurnDetail> & { selection?: 'auto' | 'manual' } = {},
): TurnDetail => {
  const { selection = 'manual', ...rest } = overrides;
  return makeTurn({
    index,
    model: `Model ${modelId.slice(1)}`,
    modelId,
    routing: { kind: selection, label: selection },
    userText: 'Rename the helper in src/util.ts',
    ...rest,
  });
};
const edited = (path: string) => ({ fileEvents: [{ path, action: 'edited' }] });
const ids = (turns: TurnDetail[], catalog: ModelPrice[] = prices) =>
  modelFindings({ turns, prices: catalog }).map((finding) => finding.id);

describe('modelFindings', () => {
  describe('oversized-model', () => {
    const small = [turn(1, EXPENSIVE, edited('/r/a.ts')), turn(2, EXPENSIVE)];

    it('fires for a small task on an expensive model the user picked', () => {
      const [finding] = modelFindings({ turns: small, prices });
      expect(finding).toMatchObject({
        id: 'oversized-model',
        message:
          'This looks like a small task run on an expensive model you selected. A lighter model may have been enough.',
        evidence:
          '1 file changed, 2 user turns, no failures, no corrections; model Model 6 is in the top third of catalog input prices',
        provenance: { kind: 'inferred', source: 'rule over turn state, file events and catalog list prices' },
      });
    });

    it('does not fire when the work was not small', () => {
      const many = [
        turn(1, EXPENSIVE, {
          fileEvents: [
            { path: '/r/a.ts', action: 'edited' },
            { path: '/r/b.ts', action: 'edited' },
          ],
        }),
        turn(2, EXPENSIVE),
      ];
      expect(ids(many)).toEqual([]);
      const corrected = [...small, turn(3, EXPENSIVE, { userText: 'no, that is wrong' })];
      expect(ids(corrected)).toEqual([]);
      expect(ids([turn(1, EXPENSIVE, { state: 'failed' }), turn(2, EXPENSIVE)])).toEqual([]);
      expect(ids([turn(1, EXPENSIVE), turn(2, EXPENSIVE), turn(3, EXPENSIVE)])).toEqual([]);
    });

    it('does not fire for a mid-priced model', () => {
      expect(ids([turn(1, 'm3', edited('/r/a.ts')), turn(2, 'm3')])).toEqual([]);
    });

    it('is skipped for models without a catalog price and for small catalogs', () => {
      expect(ids([turn(1, 'ollama/qwen', edited('/r/a.ts'))])).toEqual([]);
      expect(ids(small, prices.slice(0, 5))).toEqual([]);
    });
  });

  describe('auto-over-routing', () => {
    it('fires instead of oversized-model when Auto made the choice', () => {
      const turns = [
        turn(1, EXPENSIVE, { selection: 'auto', ...edited('/r/a.ts') }),
        turn(2, EXPENSIVE, { selection: 'auto' }),
      ];
      const [finding] = modelFindings({ turns, prices });
      expect(finding?.id).toBe('auto-over-routing');
      expect(finding?.message).toBe(
        'Auto routed this small task to an expensive model. Picking a lighter model manually may be cheaper for tasks like this.',
      );
      expect(finding?.evidence).toContain('Auto chose Model 6');
      expect(ids(turns)).toEqual(['auto-over-routing']);
    });

    it('says nothing when the selection was mixed', () => {
      const turns = [
        turn(1, EXPENSIVE, { selection: 'auto', ...edited('/r/a.ts') }),
        turn(2, EXPENSIVE, { selection: 'manual' }),
      ];
      expect(ids(turns)).toEqual([]);
    });
  });

  describe('undersized-model', () => {
    const manyCalls = Array.from({ length: 40 }, () => ({ name: 'read_file', status: 'complete' }));
    const complexTurns = (extra: Partial<TurnDetail>[]) => [
      turn(1, LIGHT, { userText: 'Fix the deadlock', toolCalls: manyCalls, ...edited('/r/a.ts') }),
      ...extra.map((overrides, i) => turn(i + 2, LIGHT, overrides)),
    ];
    const correction = { userText: 'no, still wrong' };

    it('fires for a complex task on a lightweight model that needed repeated fixes', () => {
      const turns = complexTurns([
        correction,
        correction,
        correction,
        { ...edited('/r/b.ts') },
        { ...edited('/r/c.ts') },
        { ...edited('/r/d.ts') },
      ]);
      const [finding] = modelFindings({ turns, prices });
      expect(finding?.id).toBe('undersized-model');
      expect(finding?.message).toBe(
        'A complex task on a lightweight model needed repeated fixes. A stronger reasoning model may have been more efficient.',
      );
      expect(finding?.evidence).toBe(
        '3 corrections; model Model 1 is in the bottom third of catalog input prices and the task looks complex',
      );
    });

    it('counts failed turns and undone edits too, singular and plural', () => {
      const turns = complexTurns([
        { state: 'failed' },
        { state: 'failed' },
        {
          fileEvents: [
            { path: '/r/a.ts', action: 'undone' },
            { path: '/r/b.ts', action: 'edited' },
            { path: '/r/c.ts', action: 'edited' },
            { path: '/r/d.ts', action: 'edited' },
          ],
        },
      ]);
      expect(modelFindings({ turns, prices })[0]?.evidence).toBe(
        '2 failed turns, 1 edit undone; model Model 1 is in the bottom third of catalog input prices and the task looks complex',
      );
    });

    it('does not fire when the task is not complex, or without any sign of trouble', () => {
      expect(
        ids([
          turn(1, LIGHT, edited('/r/a.ts')),
          turn(2, LIGHT, correction),
          turn(3, LIGHT, correction),
          turn(4, LIGHT, correction),
        ]),
      ).toEqual([]);
      expect(
        ids(complexTurns([{ ...edited('/r/b.ts') }, { ...edited('/r/c.ts') }, { ...edited('/r/d.ts') }])),
      ).toEqual([]);
    });

    it('still counts failures when no prompt text was stored', () => {
      const turns = complexTurns([
        { state: 'failed', userText: null },
        { state: 'failed', userText: null },
        { ...edited('/r/b.ts') },
        { ...edited('/r/c.ts') },
        { ...edited('/r/d.ts') },
      ]).map((t) => ({ ...t, userText: null }));
      expect(ids(turns)).toEqual(['undersized-model']);
    });
  });

  describe('high-reasoning', () => {
    const reasoning = (ms: number) => ({ reasoningMs: exact(ms, 't') });

    it('fires at two minutes of reasoning on a small task', () => {
      const turns = [
        turn(1, 'm3', { ...edited('/r/a.ts'), ...reasoning(70_000) }),
        turn(2, 'm3', reasoning(60_000)),
      ];
      expect(modelFindings({ turns, prices })).toEqual([
        expect.objectContaining({
          id: 'high-reasoning',
          message: 'Long reasoning on a small task. A lower reasoning effort may have been enough.',
          evidence: '2m 10s of reasoning across 2 turns for 1 changed file',
        }),
      ]);
    });

    it('uses the exact threshold', () => {
      const at = (ms: number) => [turn(1, 'm3', { ...edited('/r/a.ts'), ...reasoning(ms) })];
      expect(ids(at(119_999))).toEqual([]);
      expect(ids(at(120_000))).toEqual(['high-reasoning']);
    });

    it('needs no catalog and is skipped for large tasks', () => {
      expect(ids([turn(1, 'm3', { ...edited('/r/a.ts'), ...reasoning(200_000) })], [])).toEqual([
        'high-reasoning',
      ]);
      const big = [
        turn(1, 'm3', {
          fileEvents: [
            { path: '/r/a.ts', action: 'edited' },
            { path: '/r/b.ts', action: 'edited' },
          ],
          ...reasoning(200_000),
        }),
      ];
      expect(ids(big)).toEqual([]);
    });
  });

  it('never says a model was wrong, and is quiet for a healthy session', () => {
    const turns = [
      turn(1, EXPENSIVE, { ...edited('/r/a.ts'), reasoningMs: exact(300_000, 't') }),
      turn(2, EXPENSIVE),
    ];
    const findings = modelFindings({ turns, prices });
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings)
      expect(`${finding.message} ${finding.evidence}`.toLowerCase()).not.toContain('wrong model');
    expect(ids([turn(1, 'm3', edited('/r/a.ts')), turn(2, 'm3')])).toEqual([]);
    expect(ids([])).toEqual([]);
  });
});
