import { describe, expect, it } from 'vitest';
import { parsePromptFileChars, parseToolDefs } from './promptFiles';

const toolsFile = (tools: unknown[]) => JSON.stringify({ content: JSON.stringify(tools) });
const tool = (name: string, description = 'does a thing') => ({
  type: 'function',
  name,
  description,
  parameters: { type: 'object', properties: {} },
});

describe('parseToolDefs', () => {
  it('returns each tool name with the size of its definition, never its text', () => {
    const defs = parseToolDefs(
      toolsFile([tool('read_file'), tool('grep_search', 'SECRET-description'.repeat(10))]),
    );
    expect(defs?.map((def) => def.name)).toEqual(['read_file', 'grep_search']);
    expect(defs?.[0]?.chars).toBe(JSON.stringify(tool('read_file')).length);
    expect(defs?.[1]?.chars).toBeGreaterThan(defs?.[0]?.chars ?? 0);
    expect(JSON.stringify(defs)).not.toContain('SECRET');
  });

  it('accepts tools that nest the name under `function`', () => {
    const nested = { type: 'function', function: { name: 'nested_tool', description: 'x', parameters: {} } };
    expect(parseToolDefs(toolsFile([nested]))?.map((def) => def.name)).toEqual(['nested_tool']);
  });

  it('skips entries without a name and returns null for any other shape', () => {
    expect(parseToolDefs(toolsFile([{ type: 'function' }, tool('ok')]))?.map((def) => def.name)).toEqual([
      'ok',
    ]);
    expect(parseToolDefs(JSON.stringify({ content: 5 }))).toBeNull();
    expect(parseToolDefs(JSON.stringify({ content: 'not json' }))).toBeNull();
    expect(parseToolDefs('{broken')).toBeNull();
    expect(parseToolDefs(JSON.stringify([tool('bare-array')]))).toBeNull();
  });
});

describe('parsePromptFileChars', () => {
  it('is the length of the text, not the text', () => {
    expect(parsePromptFileChars(JSON.stringify({ content: 'abc' }))).toBe(3);
  });
  it('is null for any other shape', () => {
    expect(parsePromptFileChars(JSON.stringify({ content: ['a'] }))).toBeNull();
    expect(parsePromptFileChars('nope')).toBeNull();
  });
});
