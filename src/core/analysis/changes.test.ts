import { describe, expect, it } from 'vitest';
import { makeTurn } from '../../../test/fixtures/turns';
import { buildOutcome, summarizeChanges } from './changes';

const turns = [
  makeTurn({
    index: 1,
    fileEvents: [
      { path: '/repo/src/execution/manager.ts', action: 'read' },
      { path: '/repo/src/execution/manager.ts', action: 'edited' },
    ],
    toolCalls: [
      { name: 'read_file', status: 'complete' },
      { name: 'run_in_terminal', status: 'complete' },
    ],
  }),
  makeTurn({
    index: 2,
    fileEvents: [
      { path: '/repo/test/manager.test.ts', action: 'created' },
      { path: '/repo/src/execution/manager.ts', action: 'kept' },
    ],
  }),
  makeTurn({
    index: 3,
    fileEvents: [
      { path: '/repo/src/execution/manager.ts', action: 'edited' },
      { path: '/repo/docs/x.md', action: 'deleted' },
      { path: '/repo/src/old.ts', action: 'undone' },
    ],
  }),
];

describe('summarizeChanges', () => {
  it('counts distinct changed files by strongest action and ignores reads and keeps', () => {
    const summary = summarizeChanges(turns);
    expect(summary).toMatchObject({ edited: 1, created: 1, deleted: 1, undone: 1, commandCount: 1 });
    expect(summary.changed.map((file) => file.path).sort()).toEqual([
      '/repo/docs/x.md',
      '/repo/src/execution/manager.ts',
      '/repo/test/manager.test.ts',
    ]);
  });

  it('names the directories touched, most-touched first, at most three', () => {
    expect(summarizeChanges(turns).areas).toEqual(['docs', 'execution', 'test']);
  });

  it('understands Windows separators', () => {
    const summary = summarizeChanges([
      makeTurn({ index: 1, fileEvents: [{ path: 'C:\\repo\\src\\a.ts', action: 'edited' }] }),
    ]);
    expect(summary.areas).toEqual(['src']);
  });
});

describe('buildOutcome', () => {
  it('summarizes changes, commands, undone edits and areas in one sentence', () => {
    expect(buildOutcome(summarizeChanges(turns), turns)).toBe(
      'Changed 3 files (1 edited, 1 created, 1 deleted), ran 1 terminal command, 1 edit undone — in docs, execution, test.',
    );
  });

  it('reports failures from turn state and excludes system-initiated turns', () => {
    const failed = [
      makeTurn({ index: 1, state: 'failed' }),
      makeTurn({ index: 2, state: 'cancelled', systemInitiated: true }),
    ];
    expect(buildOutcome(summarizeChanges(failed), failed)).toBe('No files changed, 1 of 1 turn failed.');
  });
});
