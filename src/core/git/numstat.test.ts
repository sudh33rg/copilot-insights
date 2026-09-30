import { describe, expect, it } from 'vitest';
import { countPatchLines } from './numstat';

const PATCH = [
  'diff --git a/x.ts b/x.ts',
  'index 1..2 100644',
  '--- a/x.ts',
  '+++ b/x.ts',
  '@@ -1,2 +1,3 @@',
  ' keep',
  '-old line',
  '+new line',
  '+another',
  '',
].join('\n');

describe('countPatchLines', () => {
  it('counts +/- lines and ignores file headers', () => {
    expect(countPatchLines(PATCH)).toEqual({ added: 2, removed: 1 });
  });
  it('counts a line that starts with ++ or -- inside a hunk', () => {
    expect(countPatchLines('@@ -1 +1 @@\n-- old\n+++ new\n')).toEqual({ added: 1, removed: 1 });
  });
  it('returns zeros for empty or binary patches', () => {
    expect(countPatchLines('')).toEqual({ added: 0, removed: 0 });
    expect(countPatchLines('Binary files a/x and b/x differ\n')).toEqual({ added: 0, removed: 0 });
  });
});
