import { defineConfig } from '@vscode/test-cli';

const base = {
  files: 'out/integration/**/*.test.js',
  launchArgs: ['--disable-extensions'],
  // test-cli defaults to mocha's tdd UI; our tests use describe/it.
  mocha: { ui: 'bdd', timeout: 30_000 },
};

// Run against the newest VS Code and the oldest version we support (engines.vscode).
export default defineConfig([
  { ...base, label: 'stable', version: 'stable' },
  { ...base, label: 'floor', version: '1.105.0' },
]);
