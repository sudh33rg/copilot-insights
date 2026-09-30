import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { makeOutcomes, makeTurn } from '../../../test/fixtures/turns';
import { exact } from '../../shared/provenance';
import { getSessionEfficiency } from './sessionEfficiency';
import { getSessionDetail } from './sessionDetail';

function addToolDefs(database: ReturnType<typeof seededStore>['database'], unused: number, chars = 4000) {
  const insert = database.db.prepare('INSERT INTO llm_tool_defs VALUES (:s, :name, :chars)');
  for (const name of ['read_file', 'replace_string_in_file'])
    insert.run({ s: 'fx-auto-1', name, chars: 100 });
  for (let i = 0; i < unused; i++) insert.run({ s: 'fx-auto-1', name: `never_used_${String(i)}`, chars });
  database.db
    .prepare('INSERT OR REPLACE INTO llm_prompt_files VALUES (:s, :system, :tools)')
    .run({ s: 'fx-auto-1', system: 46_352, tools: 200 + unused * chars });
}

describe('getSessionEfficiency via getSessionDetail', () => {
  it('has no context advice without debug-log file sizes', () => {
    const efficiency = getSessionDetail(seededStore().database, 'fx-auto-1')?.efficiency;
    expect(efficiency?.findings).toEqual([]);
  });

  it('adds context-bloat findings from stored tool definitions and the system prompt', () => {
    const { database } = seededStore();
    addToolDefs(database, 8);
    const findings = getSessionDetail(database, 'fx-auto-1')?.efficiency.findings ?? [];
    expect(findings.map((finding) => finding.id)).toEqual(['unused-tools', 'system-prompt']);
    // 3 user-facing requests in the fixture debug log (one more is Copilot's own utility call).
    expect(findings[0]?.evidence).toBe(
      '8 of 10 tool definitions were never called; about 8,000 tokens of definitions were sent with each of 3 requests (≈ 24,000 tokens)',
    );
    expect(findings.every((finding) => finding.provenance.kind === 'inferred')).toBe(true);
  });

  it('counts turns as requests when no debug-log calls exist', () => {
    const { database } = seededStore();
    addToolDefs(database, 8);
    database.db.exec("DELETE FROM llm_calls WHERE session_id = 'fx-auto-1'");
    const finding = getSessionDetail(database, 'fx-auto-1')?.efficiency.findings[0];
    expect(finding?.evidence).toContain('each of 2 requests');
  });

  describe('fresh-session estimate', () => {
    const growing = [10_000, 20_000, 30_000, 40_000, 50_000, 60_000].map((input, i) =>
      makeTurn({ index: i + 1, inputTokens: exact(input, 'test') }),
    );

    it('is attached as an inferred estimate that states its assumption', () => {
      const { database } = seededStore();
      const estimate = getSessionEfficiency(database, growing, 'fx-auto-1', makeOutcomes()).freshSession;
      expect(estimate?.restartAtTurn).toBe(4);
      expect(estimate?.tokensSaved).toEqual({
        value: 90_000,
        provenance: {
          kind: 'inferred',
          source:
            'estimate: a fresh session would resend the first request’s baseline instead of the accumulated context; ignores prompt-cache discounts',
        },
      });
      expect(estimate?.shareOfInput.value).toBeCloseTo(90_000 / 210_000);
      expect(estimate?.shareOfInput.provenance.kind).toBe('inferred');
    });

    it('is null for a short session', () => {
      const { database } = seededStore();
      expect(
        getSessionEfficiency(database, growing.slice(0, 3), 'fx-auto-1', makeOutcomes()).freshSession,
      ).toBeNull();
    });
  });

  describe('price alternatives', () => {
    const addModel = (
      database: ReturnType<typeof seededStore>['database'],
      id: string,
      input: number,
      output: number,
      cache: number | null = null,
    ) =>
      database.db
        .prepare(
          `INSERT INTO models (id, name, input_price, output_price, cache_read_price, price_batch_size, first_seen, last_seen)
           VALUES (:id, :name, :input, :output, :cache, 1000000, 1, 1)`,
        )
        .run({ id, name: id.toUpperCase(), input, output, cache });

    it('lists cheaper catalog models with the list-price ratio of this session’s exact tokens', () => {
      const { database } = seededStore();
      addModel(database, 'budget-model', 0.5, 3, 0.05);
      addModel(database, 'pricey-model', 50, 300, 5);
      const alternatives = getSessionDetail(database, 'fx-auto-1')?.efficiency.priceAlternatives ?? [];
      expect(alternatives.map((row) => row.model)).toEqual(['budget-model']);
      expect(alternatives[0]?.name).toBe('BUDGET-MODEL');
      expect(alternatives[0]?.relativeCost.value).toBeGreaterThan(0);
      expect(alternatives[0]?.relativeCost.value).toBeLessThan(1);
      expect(alternatives[0]?.relativeCost.provenance).toEqual({
        kind: 'derived',
        source:
          'catalog list prices applied to this session’s exact tokens; relative to the list cost of the models actually used, not a credit figure',
      });
    });

    it('has none when the session’s model has no price, or there is no catalog', () => {
      const { database } = seededStore();
      database.db.exec('DELETE FROM models');
      expect(getSessionDetail(database, 'fx-auto-1')?.efficiency.priceAlternatives).toEqual([]);
    });
  });

  describe('model-selection findings', () => {
    function withCatalog(database: ReturnType<typeof seededStore>['database'], cheaperModels: number) {
      const insert = database.db.prepare(
        `INSERT INTO models (id, name, input_price, output_price, cache_read_price, price_batch_size, first_seen, last_seen)
         VALUES (:id, :id, :price, :price, NULL, 1000000, 1, 1)`,
      );
      for (let i = 0; i < cheaperModels; i++) insert.run({ id: `cheap-${String(i)}`, price: 0.1 + i / 10 });
      database.db.exec("DELETE FROM file_events WHERE session_id = 'fx-auto-1'");
      database.db.exec(
        "INSERT INTO file_events (session_id, turn_idx, seq, path, action, source) VALUES ('fx-auto-1', 1, 0, '/r/a.ts', 'edited', 't')",
      );
    }

    it('flags a small task that Auto routed to a top-third-priced model, when the catalog can rank it', () => {
      const { database } = seededStore();
      withCatalog(database, 5);
      const findings = getSessionDetail(database, 'fx-auto-1')?.efficiency.findings ?? [];
      expect(findings.map((finding) => finding.id)).toContain('auto-over-routing');
      expect(findings.find((finding) => finding.id === 'auto-over-routing')?.provenance.kind).toBe(
        'inferred',
      );
    });

    it('says nothing about model choice when the catalog is too small to rank models', () => {
      const { database } = seededStore();
      withCatalog(database, 2);
      const ids = (getSessionDetail(database, 'fx-auto-1')?.efficiency.findings ?? []).map(
        (finding) => finding.id,
      );
      expect(ids).not.toContain('auto-over-routing');
      expect(ids).not.toContain('oversized-model');
    });
  });

  describe('efficiency score', () => {
    const steady = [1, 2, 3].map((index) =>
      makeTurn({
        index,
        userText: 'Add retry handling in src/upload.ts so that uploads retry',
        inputTokens: exact(10_000, 'test'),
        toolRounds: exact(3, 'test'),
      }),
    );

    it('is a band with its measured components, each carrying provenance and evidence', () => {
      const { database } = seededStore();
      const score = getSessionEfficiency(database, steady, 'fx-auto-1', makeOutcomes()).score;
      expect(score?.band).toEqual({
        value: 'good',
        provenance: { kind: 'derived', source: 'unweighted average of the components shown' },
      });
      expect(score?.components.map((component) => component.id)).toEqual([
        'first-pass',
        'tool-reliability',
        'context-discipline',
      ]);
      expect(score?.components[0]?.value).toEqual({
        value: 1,
        provenance: {
          kind: 'derived',
          source: 'corrections, undone edits and failed turns relative to user turns',
        },
      });
      expect(score?.components[0]?.evidence).toBe(
        '0 corrections, 0 edits undone, 0 failed turns over 3 user turns',
      );
    });

    it('is null with too little evidence', () => {
      const { database } = seededStore();
      expect(
        getSessionEfficiency(database, steady.slice(0, 1), 'fx-auto-1', makeOutcomes()).score,
      ).toBeNull();
    });
  });
});
