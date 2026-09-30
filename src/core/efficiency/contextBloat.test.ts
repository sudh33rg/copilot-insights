import { describe, expect, it } from 'vitest';
import { CHARS_PER_TOKEN, contextBloat } from './contextBloat';

const defs = (used: number, unused: number, usedChars = 800, unusedChars = 1200) => [
  ...Array.from({ length: used }, (_, i) => ({ name: `used_${String(i)}`, chars: usedChars })),
  ...Array.from({ length: unused }, (_, i) => ({ name: `unused_${String(i)}`, chars: unusedChars })),
];
const usedNames = (count: number) => new Set(Array.from({ length: count }, (_, i) => `used_${String(i)}`));

describe('contextBloat', () => {
  it('estimates tokens at four characters each', () => {
    expect(CHARS_PER_TOKEN).toBe(4);
  });

  it('flags tool definitions that were never called, with the cost over every request', () => {
    const [finding] = contextBloat({
      toolDefs: defs(16, 31),
      systemPromptChars: null,
      usedToolNames: usedNames(16),
      requests: 11,
    });
    expect(finding?.id).toBe('unused-tools');
    expect(finding?.evidence).toBe(
      '31 of 47 tool definitions were never called; about 9,300 tokens of definitions were sent with each of 11 requests (≈ 102,300 tokens)',
    );
    expect(finding?.message).toContain('Disabling unused tools or MCP servers may reduce cost');
    expect(finding?.provenance).toEqual({
      kind: 'inferred',
      source: 'characters ÷ 4 as a token estimate; sent on every request',
    });
  });

  it('flags a large system prompt', () => {
    const [finding] = contextBloat({
      toolDefs: null,
      systemPromptChars: 46_352,
      usedToolNames: new Set(),
      requests: 11,
    });
    expect(finding?.id).toBe('system-prompt');
    expect(finding?.evidence).toBe(
      'the system prompt is 46,352 characters (about 11,600 tokens) and was sent with each of 11 requests',
    );
  });

  it('stays quiet when most tools were used, for few tools, a small prompt, or a single request', () => {
    expect(
      contextBloat({
        toolDefs: defs(30, 10),
        systemPromptChars: 5_000,
        usedToolNames: usedNames(30),
        requests: 11,
      }),
    ).toEqual([]);
    expect(
      contextBloat({
        toolDefs: defs(1, 3),
        systemPromptChars: null,
        usedToolNames: usedNames(1),
        requests: 11,
      }),
    ).toEqual([]);
    expect(
      contextBloat({
        toolDefs: defs(1, 9),
        systemPromptChars: 46_352,
        usedToolNames: usedNames(1),
        requests: 1,
      }),
    ).toEqual([]);
  });

  it('has nothing to say without debug-log files', () => {
    expect(
      contextBloat({ toolDefs: null, systemPromptChars: null, usedToolNames: new Set(), requests: 5 }),
    ).toEqual([]);
  });
});
