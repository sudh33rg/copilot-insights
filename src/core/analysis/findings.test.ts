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
});
