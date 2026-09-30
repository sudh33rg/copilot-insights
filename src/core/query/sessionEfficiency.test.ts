import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { makeTurn } from '../../../test/fixtures/turns';
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
      const estimate = getSessionEfficiency(database, growing, 'fx-auto-1').freshSession;
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
      expect(getSessionEfficiency(database, growing.slice(0, 3), 'fx-auto-1').freshSession).toBeNull();
    });
  });
});
