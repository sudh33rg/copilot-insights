import { describe, expect, it } from 'vitest';
import { buildOutcomeSentence } from './outcomeSentence';

const base = {
  taskType: 'bugfix' as const,
  changed: [],
  areas: [],
  linesAdded: null,
  linesRemoved: null,
  testFilesCreated: 0,
  testsPassed: null,
  testFailures: null,
  errorsDelta: null,
  undone: 0,
  failedTurns: 0,
  userTurns: 1,
};

describe('buildOutcomeSentence', () => {
  it('full evidence', () => {
    expect(
      buildOutcomeSentence({
        ...base,
        taskType: 'bugfix',
        changed: [
          { path: '/r/src/execution/a.ts', action: 'edited' },
          { path: '/r/src/persistence/b.ts', action: 'edited' },
          { path: '/r/src/execution/a.test.ts', action: 'created' },
          { path: '/r/src/persistence/b.test.ts', action: 'created' },
        ],
        areas: ['execution', 'persistence'],
        linesAdded: 120,
        linesRemoved: 30,
        testFilesCreated: 2,
        testsPassed: true,
        errorsDelta: -2,
      }),
    ).toBe(
      'Bug fix: changed 4 files (2 edited, 2 created; +120 −30 lines), added 2 test files, tests passed on the last run, 2 fewer diagnostics errors — in execution, persistence.',
    );
  });

  it('no changes', () => {
    expect(buildOutcomeSentence({ ...base, taskType: 'explain' })).toBe('Explanation: no files changed.');
  });

  it('failures and undo are stated plainly', () => {
    expect(
      buildOutcomeSentence({
        ...base,
        taskType: 'feature',
        changed: [{ path: '/r/x.ts', action: 'created' }],
        areas: ['r'],
        testsPassed: false,
        testFailures: 3,
        undone: 1,
        failedTurns: 1,
        userTurns: 4,
      }),
    ).toBe(
      'Feature: changed 1 file (1 created), tests failed on the last run (3 failing runs), 1 edit undone, 1 of 4 turns failed — in r.',
    );
  });

  it('omits every clause it has no evidence for', () => {
    expect(
      buildOutcomeSentence({ ...base, taskType: 'other', changed: [{ path: '/r/x.ts', action: 'edited' }] }),
    ).toBe('Session: changed 1 file (1 edited).');
  });

  it('states more diagnostics errors, deleted files and a single failing run', () => {
    expect(
      buildOutcomeSentence({
        ...base,
        taskType: 'refactor',
        changed: [
          { path: '/r/a.ts', action: 'deleted' },
          { path: '/r/b.ts', action: 'edited' },
        ],
        testsPassed: false,
        testFailures: 1,
        errorsDelta: 1,
        undone: 2,
      }),
    ).toBe(
      'Refactor: changed 2 files (1 edited, 1 deleted), tests failed on the last run (1 failing run), 1 more diagnostics error, 2 edits undone.',
    );
  });

  it('omits the failing-run count when it is unknown and ignores a zero diagnostics delta', () => {
    expect(
      buildOutcomeSentence({
        ...base,
        taskType: 'test',
        changed: [{ path: '/r/a.test.ts', action: 'edited' }],
        testsPassed: false,
        errorsDelta: 0,
      }),
    ).toBe('Tests: changed 1 file (1 edited), tests failed on the last run.');
  });

  it('still reports failures when no files changed', () => {
    expect(buildOutcomeSentence({ ...base, taskType: 'debug', failedTurns: 2, userTurns: 2 })).toBe(
      'Debugging: no files changed, 2 of 2 turns failed.',
    );
  });

  it('labels every task type', () => {
    const labels = (
      ['bugfix', 'feature', 'refactor', 'test', 'docs', 'explain', 'debug', 'config', 'other'] as const
    ).map((taskType) => buildOutcomeSentence({ ...base, taskType }).split(':')[0]);
    expect(labels).toEqual([
      'Bug fix',
      'Feature',
      'Refactor',
      'Tests',
      'Docs',
      'Explanation',
      'Debugging',
      'Config change',
      'Session',
    ]);
  });
});
