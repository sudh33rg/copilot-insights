import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { VscodeGit } from '../../src/extension/observers/gitAdapter';

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
      (files) => files.length > 0,
      'working tree changes',
    );
    assert.deepEqual(numstat, [{ path: join(dir, 'a.txt'), added: 2, removed: 0 }]);
    git('commit', '-qam', 'second');
    const commits = await repo.commitsSince(Date.now() - 60_000);
    assert.equal(commits.length >= 1, true);
    assert.deepEqual(commits[0]?.files, [join(dir, 'a.txt')]);
  });
});
