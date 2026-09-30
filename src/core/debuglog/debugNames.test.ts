import { describe, expect, it } from 'vitest';
import { classifyDebugName } from './debugNames';

describe('classifyDebugName', () => {
  it.each(['panel/editAgent', 'panel/ask', 'inline/chat'])('%s is user-facing', (name) => {
    expect(classifyDebugName(name)).toBe('USER_FACING');
  });

  it.each([
    'title',
    'summarize',
    'summarizeConversationHistory',
    'progressMessages',
    'contextualProgressMessage',
    'promptCategorization',
    'git-branch',
    'healStringReplace',
    'healApplyPatch',
    'modelList',
    'contentExclusion',
    'backgroundTodoAgent',
  ])('%s is a Copilot-internal utility call', (name) => {
    expect(classifyDebugName(name)).toBe('COPILOT_INTERNAL');
  });

  it('does not guess for names it has not seen', () => {
    expect(classifyDebugName('mystery-thing')).toBe('UNKNOWN');
    expect(classifyDebugName('retry-')).toBe('UNKNOWN');
    expect(classifyDebugName('')).toBe('UNKNOWN');
    expect(classifyDebugName(null)).toBe('UNKNOWN');
  });

  it('classifies by name only, never by lookalike prefixes or case', () => {
    expect(classifyDebugName('titleX')).toBe('UNKNOWN');
    expect(classifyDebugName('Title')).toBe('UNKNOWN');
    expect(classifyDebugName('notpanel/x')).toBe('UNKNOWN');
  });
});
