import { describe, expect, it } from 'vitest';
import { redactDeep, redactSecrets } from './redact';

describe('redactSecrets', () => {
  it.each([
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789 end', 'token [REDACTED:github-token] end'],
    ['pat github_pat_11ABCDEFGHIJKLMNOPQRSTUV_xyz', 'pat [REDACTED:github-token]'],
    ['key AKIAABCDEFGHIJKLMNOP', 'key [REDACTED:aws-access-key]'],
    ['sk-abcdefghijklmnopqrstuvwx', '[REDACTED:api-key]'],
    ['xoxb-1234567890-abcdef', '[REDACTED:slack-token]'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk', '[REDACTED:jwt]'],
    ['password = "hunter2hunter2"', 'password = "[REDACTED:secret]"'],
    ['-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----', '[REDACTED:private-key]'],
  ])('redacts %s', (input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it('does not double-redact an already redacted assignment', () => {
    expect(redactSecrets("token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'")).toBe(
      "token = '[REDACTED:github-token]'",
    );
  });

  it('leaves ordinary text alone', () => {
    expect(redactSecrets('Fixed the race in src/execution/manager.ts')).toBe(
      'Fixed the race in src/execution/manager.ts',
    );
  });

  it('redacts nested values', () => {
    expect(redactDeep({ a: ['sk-abcdefghijklmnopqrstuvwx', 3], b: { c: 'ok' } })).toEqual({
      a: ['[REDACTED:api-key]', 3],
      b: { c: 'ok' },
    });
  });
});
