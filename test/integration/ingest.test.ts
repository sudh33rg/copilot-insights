import * as assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

// Bundled to out/integration/, so the repository root is two levels up.
const FIXTURES = join(__dirname, '..', '..', 'test', 'fixtures', 'chatSessions');

describe('native session ingestion', () => {
  it('indexes fixture sessions from a configured workspaceStorage root in the scan worker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ci-integration-'));
    const chatSessions = join(root, 'ws1', 'chatSessions');
    mkdirSync(chatSessions, { recursive: true });
    writeFileSync(join(root, 'ws1', 'workspace.json'), JSON.stringify({ folder: 'file:///repo/alpha' }));
    for (const name of ['auto-agent-session.jsonl', 'byok-failed-session.jsonl', 'empty-session.jsonl']) {
      copyFileSync(join(FIXTURES, name), join(chatSessions, name));
    }
    await vscode.workspace
      .getConfiguration('copilotInsights')
      .update('nativeStorageRoots', [root], vscode.ConfigurationTarget.Global);

    const result = await vscode.commands.executeCommand<{ role: string; parsed: number; empty: number }>(
      'copilotInsights.rebuildIndex',
    );

    assert.equal(result.role, 'leader');
    assert.equal(result.parsed, 2);
    // The test workspace (a git repo, see .vscode-test.mjs) makes VS Code create its own, empty, chat storage.
    assert.ok(result.empty >= 1, `expected at least the empty fixture, got ${String(result.empty)}`);
  });
});
