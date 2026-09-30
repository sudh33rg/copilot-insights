export type Complexity = 'simple' | 'moderate' | 'complex';

export interface ComplexityInput {
  userTurns: number;
  toolCalls: number;
  changedFiles: number;
  compactions: number;
}

/** Heuristic size of the work. Always shown as `inferred`. */
export function estimateComplexity(input: ComplexityInput): Complexity {
  const score = input.userTurns + input.toolCalls / 5 + input.changedFiles + 3 * input.compactions;
  if (score < 4) return 'simple';
  if (score < 15) return 'moderate';
  return 'complex';
}
