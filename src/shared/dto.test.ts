import { describe, expect, it } from 'vitest';
import { measured, sessionListParams, sessionRowSchema } from './dto';
import { z } from 'zod';

describe('dto', () => {
  it('validates a measured value and rejects an unknown provenance kind', () => {
    const schema = measured(z.number());
    expect(schema.safeParse({ value: 1, provenance: { kind: 'exact', source: 's' } }).success).toBe(true);
    expect(schema.safeParse({ value: null, provenance: { kind: 'unavailable', source: 's' } }).success).toBe(
      true,
    );
    expect(schema.safeParse({ value: 1, provenance: { kind: 'guess', source: 's' } }).success).toBe(false);
  });

  it('bounds list parameters', () => {
    const ok = { offset: 0, limit: 50 };
    expect(sessionListParams.safeParse(ok).success).toBe(true);
    expect(sessionListParams.safeParse({ ...ok, limit: 1000 }).success).toBe(false);
    expect(sessionListParams.safeParse({ ...ok, offset: -1 }).success).toBe(false);
    expect(sessionListParams.safeParse({ ...ok, q: 'x'.repeat(201) }).success).toBe(false);
    expect(sessionListParams.safeParse({ ...ok, fromDay: '2026-9-1' }).success).toBe(false);
  });

  it('has a session row schema with routing and measured totals', () => {
    expect(Object.keys(sessionRowSchema.shape)).toEqual(
      expect.arrayContaining(['id', 'routing', 'inputTokens', 'outputTokens', 'credits', 'state', 'outcome']),
    );
  });
});
