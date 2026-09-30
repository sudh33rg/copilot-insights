import { defineConfig } from '@vscode/test-cli';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A throwaway git repository opened as the workspace, so the built-in git extension discovers it on its own. */
function createGitWorkspace() {
  // realpath: on macOS tmpdir() is /var/..., which git reports as /private/var/...
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ci-git-')));
  const git = (...args) => execFileSync('git', args, { cwd: dir });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return dir;
}

const base = {
  files: 'out/integration/**/*.test.js',
  launchArgs: ['--disable-extensions'],
  // test-cli defaults to mocha's tdd UI; our tests use describe/it.
  mocha: { ui: 'bdd', timeout: 30_000 },
};

// Run against the newest VS Code and the oldest version we support (engines.vscode).
export default defineConfig([
  { ...base, label: 'stable', version: 'stable', workspaceFolder: createGitWorkspace() },
  { ...base, label: 'floor', version: '1.105.0', workspaceFolder: createGitWorkspace() },
]);
