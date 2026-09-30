import { describe, expect, it } from 'vitest';
import { classifyCommand } from './commandKind';

describe('classifyCommand', () => {
  it.each([
    'pnpm test',
    'npm run test',
    'npx vitest run src/foo.test.ts',
    'pytest -q',
    'go test ./...',
    'cargo test',
  ])('classifies %s as a test run', (command) => {
    expect(classifyCommand(command)).toBe('test');
  });

  it.each(['pnpm build', 'tsc -p .', 'vite build'])('classifies %s as a build', (command) => {
    expect(classifyCommand(command)).toBe('build');
  });

  it.each(['eslint .', 'pnpm lint', 'ruff check'])('classifies %s as lint', (command) => {
    expect(classifyCommand(command)).toBe('lint');
  });

  it.each(['ls -la', 'git status'])('classifies %s as other', (command) => {
    expect(classifyCommand(command)).toBe('other');
  });

  it('still recognises a test command that carries a secret', () => {
    expect(classifyCommand(`GITHUB_TOKEN=ghp_${'a'.repeat(36)} pnpm test`)).toBe('test');
  });
});
