import { describe, expect, it } from 'vitest';
import {
  MAX_FINGERPRINTS_PER_EDIT,
  commandHash,
  lineFingerprints,
  newSalt,
  normalizeCommand,
  saltedHash,
} from './fingerprint';

describe('fingerprint', () => {
  it('produces distinct salts', () => {
    expect(newSalt()).not.toEqual(newSalt());
    expect(newSalt()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('hashes deterministically per salt and never contains the input', () => {
    const hash = saltedHash('s1', 'const answer = computeTheAnswer();');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(saltedHash('s1', 'const answer = computeTheAnswer();')).toBe(hash);
    expect(saltedHash('s2', 'const answer = computeTheAnswer();')).not.toBe(hash);
  });

  it('fingerprints only substantial, unique, trimmed lines', () => {
    const text = [
      '  short  ',
      '    const value = computeSomethingLong();  ',
      'const value = computeSomethingLong();',
      '',
    ].join('\n');
    const prints = lineFingerprints('s', text);
    expect(prints).toEqual([saltedHash('s', 'const value = computeSomethingLong();')]);
  });

  it('caps the number of fingerprints per edit', () => {
    const text = Array.from(
      { length: 500 },
      (_, i) => `const generated_${String(i)} = something_long_enough;`,
    ).join('\n');
    expect(lineFingerprints('s', text)).toHaveLength(MAX_FINGERPRINTS_PER_EDIT);
  });

  it('normalizes commands (redacts secrets, collapses whitespace) before hashing', () => {
    const a = normalizeCommand('  curl   -H "token=ghp_' + 'a'.repeat(36) + '"  https://x  ');
    expect(a).not.toContain('ghp_');
    expect(commandHash('s', 'pnpm   test')).toBe(commandHash('s', ' pnpm test '));
    expect(commandHash('s', 'pnpm test')).not.toBe(commandHash('s', 'pnpm build'));
  });
});
