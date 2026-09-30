import { describe, expect, it } from 'vitest';
import { diagnosticsDelta } from './diagnosticsDelta';

const d = (path: string, errors: number, warnings = 0) => ({ path, errors, warnings });

describe('diagnosticsDelta', () => {
  it('sums the change over edited files only; absent entries mean zero', () => {
    const before = [d('/r/a.ts', 3, 1), d('/r/other.ts', 9)];
    const after = [d('/r/a.ts', 1, 1), d('/r/b.ts', 2, 4), d('/r/other.ts', 50)];
    expect(diagnosticsDelta(before, after, ['/r/a.ts', '/r/b.ts'])).toEqual({
      errors: 0,
      warnings: 4,
      errorsBefore: 3,
      errorsAfter: 3,
    });
  });
  it('is null when either snapshot is missing', () => {
    expect(diagnosticsDelta(null, [], ['/r/a.ts'])).toBeNull();
    expect(diagnosticsDelta([], null, ['/r/a.ts'])).toBeNull();
  });
  it('is null when nothing was edited (a delta over no files would read as "no change")', () => {
    expect(diagnosticsDelta([], [], [])).toBeNull();
  });
  it('counts a file edited twice once', () => {
    expect(diagnosticsDelta([d('/r/a.ts', 1)], [d('/r/a.ts', 4)], ['/r/a.ts', '/r/a.ts'])).toMatchObject({
      errors: 3,
    });
  });
  it('can be negative when edits fixed problems', () => {
    expect(diagnosticsDelta([d('/r/a.ts', 5, 2)], [], ['/r/a.ts'])).toEqual({
      errors: -5,
      warnings: -2,
      errorsBefore: 5,
      errorsAfter: 0,
    });
  });
});
