import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { snapshotDiagnostics } from '../../src/extension/observers/diagnosticsAdapter';
import { Database } from '../../src/core/storage/database';
import { ObservationStore } from '../../src/core/storage/observationStore';
import { VscodeGit } from '../../src/extension/observers/gitAdapter';
import { registerTerminalObserver } from '../../src/extension/observers/terminalObserver';

/** The git extension fills repository state asynchronously; poll until `read` yields a value that `accept` likes. */
async function eventually<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  what: string,
): Promise<T> {
  const deadline = Date.now() + 20_000;
  let value = await read();
  while (!accept(value)) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    value = await read();
  }
  return value;
}

describe('vscode.git adapter', function () {
  this.timeout(60_000);
  it('reports head, numstat and commits for the workspace repository', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'the test workspace (a temp git repo, see .vscode-test.mjs) is open');
    const dir = folder.uri.fsPath;
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir });
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\nfour\n');
    // A new file git does not track yet still counts as added lines.
    writeFileSync(join(dir, 'b.txt'), 'x\ny\nz\n');
    const findRepo = async () => (await new VscodeGit().repos()).find((candidate) => candidate.root === dir);
    const repo = await eventually(findRepo, (found) => found !== undefined, 'the repository to open');
    assert.ok(repo);
    const head = await eventually(
      () => repo.head(),
      (value) => value !== null,
      'HEAD to load',
    );
    assert.match(head ?? '', /^[0-9a-f]{40}$/);
    const numstat = await eventually(
      () => repo.workingTreeNumstat(),
      (files) => files.length >= 2,
      'tracked and untracked working tree changes',
    );
    assert.deepEqual(
      [...numstat].sort((a, b) => a.path.localeCompare(b.path)),
      [
        { path: join(dir, 'a.txt'), added: 2, removed: 0 },
        { path: join(dir, 'b.txt'), added: 3, removed: 0 },
      ],
    );
    git('commit', '-qam', 'second');
    const commits = await repo.commitsSince(Date.now() - 60_000);
    assert.equal(commits.length >= 1, true);
    assert.deepEqual(commits[0]?.files, [join(dir, 'a.txt')]);
  });
});

describe('diagnostics adapter', () => {
  it('counts errors and warnings per file and never reads message text', () => {
    const collection = vscode.languages.createDiagnosticCollection('copilot-insights-test');
    const uri = vscode.Uri.file(join(tmpdir(), 'ci-diagnostics-target.ts'));
    const range = new vscode.Range(0, 0, 0, 1);
    collection.set(uri, [
      new vscode.Diagnostic(range, 'SECRET-message', vscode.DiagnosticSeverity.Error),
      new vscode.Diagnostic(range, 'SECRET-message', vscode.DiagnosticSeverity.Error),
      new vscode.Diagnostic(range, 'SECRET-message', vscode.DiagnosticSeverity.Warning),
      new vscode.Diagnostic(range, 'SECRET-message', vscode.DiagnosticSeverity.Information),
    ]);
    try {
      const { entries, truncated } = snapshotDiagnostics();
      assert.equal(truncated, false);
      const entry = entries.find((candidate) => candidate.path === uri.fsPath);
      assert.deepEqual(entry, { path: uri.fsPath, errors: 2, warnings: 1 });
      assert.ok(!JSON.stringify(entries).includes('SECRET'));
    } finally {
      collection.dispose();
    }
  });
});

describe('terminal observer', () => {
  it('registers and disposes cleanly', () => {
    const disposable = registerTerminalObserver(new ObservationStore(new Database(':memory:')), () => 'salt');
    disposable.dispose();
  });
});
