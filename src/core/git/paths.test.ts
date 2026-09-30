import { describe, expect, it } from 'vitest';
import { isWithin, pathsRelated } from './paths';

describe('isWithin', () => {
  it('matches the root itself and anything below it, on either separator', () => {
    expect(isWithin('/repo', '/repo')).toBe(true);
    expect(isWithin('/repo/a/b.ts', '/repo')).toBe(true);
    expect(isWithin('C:\\repo\\a.ts', 'C:\\repo')).toBe(true);
  });
  it('does not match a sibling that merely shares a prefix', () => {
    expect(isWithin('/repository-two/a.ts', '/repo')).toBe(false);
  });
  it('treats a root with a trailing separator, and the filesystem root, correctly', () => {
    expect(isWithin('/repo/a.ts', '/repo/')).toBe(true);
    expect(isWithin('/repo/a.ts', '/')).toBe(true);
  });
});

describe('pathsRelated', () => {
  it('is true when one path contains the other, in either direction', () => {
    expect(pathsRelated('/repo', '/repo/packages/app')).toBe(true);
    expect(pathsRelated('/repo/packages/app', '/repo')).toBe(true);
  });
  it('is false for unrelated paths', () => {
    expect(pathsRelated('/repo', '/elsewhere')).toBe(false);
  });
});
