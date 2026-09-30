import type { CommandKind } from '../storage/observationStore';

export type { CommandKind };

const TEST =
  /\b(vitest|jest|pytest|mocha|rspec|phpunit)\b|\b(go|cargo|dotnet|mvn|gradle)\s+test\b|\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/i;
const LINT = /\b(eslint|ruff|flake8|pylint|prettier|stylelint)\b|\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?lint\b/i;
const BUILD =
  /\b(tsc|webpack|vite\s+build|esbuild|make|cargo\s+build|go\s+build)\b|\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b/i;

/** Coarse kind of a shell command. Only the kind is ever stored, never the command. */
export function classifyCommand(command: string): CommandKind {
  if (TEST.test(command)) return 'test';
  if (LINT.test(command)) return 'lint';
  if (BUILD.test(command)) return 'build';
  return 'other';
}
