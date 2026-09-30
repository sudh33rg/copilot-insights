import { defineConfig } from '@vscode/test-cli';

const base = {
  files: 'out/integration/**/*.test.js',
  launchArgs: ['--disable-extensions'],
  mocha: { timeout: 30_000 },
};

// Run against the newest VS Code and the oldest version we support (engines.vscode).
export default defineConfig([
  { ...base, label: 'stable', version: 'stable' },
  { ...base, label: 'floor', version: '1.105.0' },
]);
