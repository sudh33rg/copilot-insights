import { describe, expect, it } from 'vitest';
import { makeOutcomes, makeTurn } from '../../../test/fixtures/turns';
import { derived, exact } from '../../shared/provenance';
import { analyzeSession } from './analyzeSession';

describe('analyzeSession', () => {
  const turns = [
    makeTurn({
      index: 1,
      userText: 'Fix the timeout race in src/execution/manager.ts',
      fileEvents: [{ path: '/repo/src/execution/manager.ts', action: 'edited' }],
      toolCalls: [{ name: 'read_file', status: 'complete' }],
    }),
  ];
  const outcomes = makeOutcomes();

  it('tags every field derived or inferred, never exact', () => {
    const analysis = analyzeSession({ turns, outcomes });
    expect(analysis.intent).toMatchObject({ value: 'bugfix', provenance: { kind: 'inferred' } });
    expect(analysis.taskType).toEqual({
      value: 'bugfix',
      provenance: { kind: 'inferred', source: 'prompt keyword: bugfix' },
    });
    // The sentence contains the keyword-classified label, so it cannot be stronger than the classification.
    expect(analysis.outcome).toMatchObject({
      value: 'Bug fix: changed 1 file (1 edited) — in execution.',
      provenance: {
        kind: 'inferred',
        source: 'file events, git snapshots, terminal runs, diagnostics and turn state',
      },
    });
    expect(analysis.areas).toMatchObject({ value: ['execution'], provenance: { kind: 'derived' } });
    expect(analysis.complexity.provenance.kind).toBe('inferred');
    expect(analysis.commandCount.provenance.kind).toBe('derived');
    expect(analysis.findings.every((finding) => finding.provenance.kind === 'inferred')).toBe(true);
  });

  it('does not invent an intent when no prompt text was stored', () => {
    const analysis = analyzeSession({ turns: [makeTurn({ index: 1 })], outcomes });
    expect(analysis.intent.value).toBeNull();
    expect(analysis.intent.provenance.kind).toBe('unavailable');
    expect(analysis.taskType).toMatchObject({ value: 'explain', provenance: { kind: 'derived' } });
    expect(analysis.outcome).toMatchObject({
      value: 'Explanation: no files changed.',
      provenance: { kind: 'derived' },
    });
  });

  it('stays derived when the task type comes from the files changed, not from keywords', () => {
    const docsOnly = [makeTurn({ index: 1, fileEvents: [{ path: '/repo/README.md', action: 'edited' }] })];
    const analysis = analyzeSession({ turns: docsOnly, outcomes });
    expect(analysis.taskType).toMatchObject({ value: 'docs', provenance: { kind: 'derived' } });
    expect(analysis.outcome.provenance.kind).toBe('derived');
  });

  it('puts observed outcomes into the sentence and counts created test files', () => {
    const work = [
      makeTurn({
        index: 1,
        userText: 'Add retry handling',
        fileEvents: [
          { path: '/repo/src/run/retry.ts', action: 'created' },
          { path: '/repo/src/run/retry.test.ts', action: 'created' },
        ],
      }),
    ];
    const analysis = analyzeSession({
      turns: work,
      outcomes: makeOutcomes({
        linesAdded: derived(40, 'test'),
        linesRemoved: derived(2, 'test'),
        lastTestPassed: derived(true, 'test'),
        testFailures: derived(0, 'test'),
        errorsDelta: derived(-1, 'test'),
        terminalRuns: exact(3, 'test'),
      }),
    });
    expect(analysis.outcome.value).toBe(
      'Feature: changed 2 files (2 created; +40 −2 lines), added 1 test file, tests passed on the last run, 1 fewer diagnostics error — in run.',
    );
  });

  it('states failed turns and undone edits', () => {
    const rough = [
      makeTurn({ index: 1, userText: 'Refactor the parser', state: 'failed' }),
      makeTurn({
        index: 2,
        fileEvents: [
          { path: '/repo/src/p.ts', action: 'edited' },
          { path: '/repo/src/p.ts', action: 'undone' },
        ],
      }),
    ];
    expect(analyzeSession({ turns: rough, outcomes }).outcome.value).toBe(
      'Refactor: changed 1 file (1 edited), 1 edit undone, 1 of 2 turns failed — in src.',
    );
  });

  it('counts only user-initiated turns as failed', () => {
    const mixed = [
      makeTurn({ index: 1, userText: 'Explain the retry logic', state: 'failed' }),
      makeTurn({ index: 2, state: 'cancelled', systemInitiated: true }),
    ];
    expect(analyzeSession({ turns: mixed, outcomes }).outcome.value).toBe(
      'Explanation: no files changed, 1 of 1 turn failed.',
    );
  });
});
