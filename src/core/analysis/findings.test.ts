import { describe, expect, it } from 'vitest';
import { exact } from '../../shared/provenance';
import { makeTurn } from '../../../test/fixtures/turns';
import { promptFindings } from './findings';

const ids = (turns: Parameters<typeof promptFindings>[0]) =>
  promptFindings(turns).map((finding) => finding.id);

describe('promptFindings', () => {
  it('flags a very short opening prompt', () => {
    expect(ids([makeTurn({ index: 1, userText: 'fix it' })])).toContain('vague-first-prompt');
    expect(
      ids([makeTurn({ index: 1, userText: 'Fix the timeout race in src/execution/manager.ts' })]),
    ).not.toContain('vague-first-prompt');
  });

  it('flags repeated corrections from user turns only', () => {
    const turns = [
      makeTurn({ index: 1, userText: 'Refactor the scanner into smaller functions please' }),
      makeTurn({ index: 2, userText: 'No, that is wrong' }),
      makeTurn({ index: 3, userText: 'Still failing after your change' }),
      makeTurn({ index: 4, systemInitiated: true, userText: 'still running' }),
    ];
    const finding = promptFindings(turns).find((item) => item.id === 'repeated-corrections');
    expect(finding?.evidence).toBe('2 follow-up prompts read as corrections (turns 2, 3)');
  });

  it('flags long sessions by user turns or compactions', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      makeTurn({ index: index + 1, userText: 'a'.repeat(40) }),
    );
    expect(ids(many)).toContain('long-session');
    expect(ids([makeTurn({ index: 1, userText: 'a'.repeat(40), compactions: exact(2, 'test') })])).toContain(
      'long-session',
    );
  });

  it('flags repeated failures from state, even without any stored text', () => {
    const turns = [
      makeTurn({ index: 1, state: 'failed' }),
      makeTurn({ index: 2, state: 'failed' }),
      makeTurn({ index: 3 }),
    ];
    const finding = promptFindings(turns).find((item) => item.id === 'repeated-failures');
    expect(finding?.evidence).toBe('2 of 3 turns failed');
    expect(ids(turns)).not.toContain('vague-first-prompt');
  });

  it('returns nothing for a healthy session', () => {
    expect(
      ids([makeTurn({ index: 1, userText: 'Add retry logic to the fetch helper with a 3 attempt limit' })]),
    ).toEqual([]);
  });

  describe('underspecified-start', () => {
    const session = (first: string, followUps = 4) => [
      makeTurn({ index: 1, userText: first }),
      ...Array.from({ length: followUps }, (_, i) =>
        makeTurn({ index: i + 2, userText: 'ok continue with it' }),
      ),
    ];
    const vague = 'Please improve the way runs are handled here';

    it('flags an opening with no file and no success condition when the session needed several turns', () => {
      const finding = promptFindings(session(vague)).find((item) => item.id === 'underspecified-start');
      expect(finding?.evidence).toBe(
        'opening prompt names no file and states no success condition; the session took 5 user turns',
      );
    });

    it('does not double-report a very short opening', () => {
      expect(ids(session('fix it'))).toContain('underspecified-start');
      expect(ids(session('fix it'))).not.toContain('vague-first-prompt');
      expect(ids(session('fix it', 0))).toContain('vague-first-prompt');
    });

    it('stays quiet when the opening names a file, a code span or states what success looks like', () => {
      expect(ids(session('Improve run handling in src/execution/manager.ts'))).not.toContain(
        'underspecified-start',
      );
      expect(ids(session('Improve the `RunManager` handling of timeouts'))).not.toContain(
        'underspecified-start',
      );
      expect(ids(session('Improve run handling so that timeouts return an error'))).not.toContain(
        'underspecified-start',
      );
    });

    it('stays quiet for a short session and when no prompt text was stored', () => {
      expect(ids(session(vague, 1))).not.toContain('underspecified-start');
      expect(ids([makeTurn({ index: 1 }), makeTurn({ index: 2 }), makeTurn({ index: 3 })])).not.toContain(
        'underspecified-start',
      );
    });

    it('ignores system-initiated turns when counting the session length', () => {
      const turns = [
        makeTurn({ index: 1, userText: vague }),
        makeTurn({ index: 2, userText: 'more', systemInitiated: true }),
        makeTurn({ index: 3, userText: 'more', systemInitiated: true }),
        makeTurn({ index: 4, userText: 'more', systemInitiated: true }),
      ];
      expect(ids(turns)).not.toContain('underspecified-start');
    });
  });

  describe('late-constraints', () => {
    const turn = (index: number, userText: string) => makeTurn({ index, userText });
    const opening = 'Add retry handling to the upload code in src/upload.ts';

    it('flags constraints that only appear on a later turn', () => {
      const finding = promptFindings([
        turn(1, opening),
        turn(2, 'looks fine'),
        turn(3, 'also fine'),
        turn(4, 'Only change the retry count, and do it without touching the API'),
      ]).find((item) => item.id === 'late-constraints');
      expect(finding?.evidence).toBe('constraints first appeared on turn 4 ("only", "without")');
    });

    it('stays quiet when the opening already had constraints, or they came early, or are absent', () => {
      expect(
        ids([
          turn(1, `${opening}, but only in one file`),
          turn(2, 'a'),
          turn(3, 'a'),
          turn(4, 'Never do that'),
        ]),
      ).not.toContain('late-constraints');
      expect(
        ids([turn(1, opening), turn(2, 'Only do this'), turn(3, 'fine'), turn(4, 'fine')]),
      ).not.toContain('late-constraints');
      expect(ids([turn(1, opening), turn(2, 'fine'), turn(3, 'fine'), turn(4, 'thanks')])).not.toContain(
        'late-constraints',
      );
    });

    it('counts user turns, not system-initiated ones, and needs stored text', () => {
      const system = makeTurn({ index: 2, userText: 'keep going', systemInitiated: true });
      const sys2 = makeTurn({ index: 3, userText: 'keep going', systemInitiated: true });
      expect(ids([turn(1, opening), system, sys2, turn(4, 'Only this one')])).not.toContain(
        'late-constraints',
      );
      expect(
        ids([makeTurn({ index: 1 }), makeTurn({ index: 2 }), makeTurn({ index: 3 }), makeTurn({ index: 4 })]),
      ).not.toContain('late-constraints');
    });
  });

  describe('drift', () => {
    const touch = (index: number, ...paths: string[]) =>
      makeTurn({
        index,
        userText: 'a'.repeat(40),
        fileEvents: paths.map((path) => ({ path, action: 'edited' })),
      });

    it('flags a session whose later turns touched unrelated directories', () => {
      const finding = promptFindings([
        touch(1, '/r/src/execution/a.ts', '/r/src/execution/b.ts'),
        touch(2, '/r/src/execution/c.ts'),
        touch(3, '/r/docs/x.md', '/r/scripts/y.ts'),
        touch(4, '/r/docs/z.md'),
      ]).find((item) => item.id === 'drift');
      expect(finding?.message).toBe(
        'The session moved into unrelated areas. Starting a separate session for the new topic may keep context smaller.',
      );
      expect(finding?.evidence).toBe('early turns touched execution/; later turns touched docs/, scripts/');
    });

    it('stays quiet when halves share a directory, with few events, or little per half', () => {
      expect(
        ids([
          touch(1, '/r/src/a.ts', '/r/src/b.ts'),
          touch(2, '/r/src/c.ts'),
          touch(3, '/r/src/d.ts', '/r/src/e.ts'),
          touch(4, '/r/src/f.ts'),
        ]),
      ).not.toContain('drift');
      expect(ids([touch(1, '/r/a/x.ts', '/r/a/y.ts'), touch(2, '/r/b/x.ts', '/r/b/y.ts')])).not.toContain(
        'drift',
      );
      expect(
        ids([
          touch(1, '/r/a/x.ts'),
          touch(2, '/r/a/x.ts'),
          touch(3, '/r/a/x.ts'),
          touch(4, '/r/b/x.ts'),
          touch(5, '/r/b/y.ts'),
          touch(6, '/r/b/z.ts'),
        ]),
      ).not.toContain('drift');
    });

    it('works without any stored prompt text', () => {
      const turns = [
        touch(1, '/r/a/x.ts', '/r/a/y.ts', '/r/a/z.ts'),
        touch(2, '/r/b/x.ts', '/r/b/y.ts', '/r/b/z.ts'),
      ].map((turn) => ({ ...turn, userText: null }));
      expect(ids(turns)).toContain('drift');
    });
  });
});
