import { describe, expect, it } from 'vitest';
import { classifyIntent } from './intent';

describe('classifyIntent', () => {
  it.each([
    ['Fix the timeout race in src/execution/manager.ts', 'bugfix'],
    ['Explain the retry policy', 'explain'],
    ['Add a dark mode toggle to settings', 'feature'],
    ['Refactor the parser into smaller functions', 'refactor'],
    ['Write unit tests for the scanner', 'test'],
    ['Update the README with install steps', 'docs'],
    ['Configure eslint and install prettier', 'config'],
    ['Why is this crashing with a stack trace?', 'debug'],
    ['hello there', 'other'],
  ])('%s → %s', (prompt, expected) => {
    expect(classifyIntent(prompt).intent).toBe(expected);
  });

  it('reports the words that decided the intent', () => {
    expect(classifyIntent('Fix the timeout race').matched).toBe('fix');
    expect(classifyIntent('hello there').matched).toBe('');
  });
});
