import * as assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as vscode from 'vscode';

const EXTENSION_ID = 'local.traceon';

describe('extension host environment', () => {
  it('activates the extension', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test instance`);
    await extension.activate();
    assert.equal(extension.isActive, true);
  });

  it('provides node:sqlite with JSON functions (decision D3)', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (x INTEGER)');
    db.prepare('INSERT INTO t (x) VALUES (?)').run(41);
    const row = db.prepare("SELECT x + 1 AS y, json_array_length('[1,2]') AS n FROM t").get();
    assert.deepEqual({ ...row }, { y: 42, n: 2 });
    db.close();
  });

  it('reports whether FTS5 is compiled in (input to the Phase 2 search design)', () => {
    const db = new DatabaseSync(':memory:');
    let fts5 = true;
    try {
      db.exec('CREATE VIRTUAL TABLE f USING fts5(body)');
    } catch {
      fts5 = false;
    }
    db.close();
    console.log(`[capabilities] vscode=${vscode.version} fts5=${String(fts5)}`);
  });
});
