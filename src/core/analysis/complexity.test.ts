import { describe, expect, it } from 'vitest';
import { estimateComplexity } from './complexity';

describe('estimateComplexity', () => {
  it('scores turns, tool calls, changed files and compactions', () => {
    expect(estimateComplexity({ userTurns: 1, toolCalls: 0, changedFiles: 0, compactions: 0 })).toBe(
      'simple',
    );
    expect(estimateComplexity({ userTurns: 2, toolCalls: 3, changedFiles: 2, compactions: 1 })).toBe(
      'moderate',
    );
    expect(estimateComplexity({ userTurns: 20, toolCalls: 40, changedFiles: 10, compactions: 3 })).toBe(
      'complex',
    );
  });
});
