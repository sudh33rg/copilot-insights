import { describe, expect, it } from 'vitest';
import { routingFor } from './routing';

describe('routingFor', () => {
  it('labels Auto routing with the resolved model', () => {
    expect(routingFor([{ mode: 'AUTO', model: 'gpt-5.6-luna' }])).toEqual({
      kind: 'auto',
      label: 'Auto → gpt-5.6-luna',
    });
  });

  it('labels manual choices and strips provider prefixes', () => {
    expect(routingFor([{ mode: 'MANUAL', model: 'ollama/Ollama/qwen3.5:35b' }])).toEqual({
      kind: 'manual',
      label: 'Manual · qwen3.5:35b',
    });
  });

  it('reports mixed routing and collapses long lists', () => {
    const mixed = routingFor([
      { mode: 'AUTO', model: 'a' },
      { mode: 'MANUAL', model: 'b' },
      { mode: 'MANUAL', model: 'c' },
    ]);
    expect(mixed.kind).toBe('mixed');
    expect(mixed.label).toBe('Auto → a, Manual · b +1 more');
  });

  it('handles unknown mode and missing model', () => {
    expect(routingFor([{ mode: 'UNKNOWN', model: null }])).toEqual({
      kind: 'unknown',
      label: 'Unknown model',
    });
    expect(routingFor([])).toEqual({ kind: 'unknown', label: 'Unknown' });
  });
});
