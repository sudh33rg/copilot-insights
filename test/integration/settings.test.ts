import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const config = () => vscode.workspace.getConfiguration('copilotInsights');

describe('new settings', () => {
  afterEach(async () => {
    for (const key of ['liveNudge', 'monthlyCreditBudget', 'workspaceCreditBudgets']) {
      await config().update(key, undefined, vscode.ConfigurationTarget.Global);
    }
  });

  it('are declared with safe defaults', () => {
    const extension = vscode.extensions.getExtension('local.traceon');
    assert.ok(extension);
    const manifest = extension.packageJSON as {
      contributes: { configuration: { properties: Record<string, unknown> } };
    };
    assert.equal(
      Object.hasOwn(manifest.contributes.configuration.properties, 'copilotInsights.captureLevel'),
      false,
    );
    assert.equal(config().get('liveNudge'), false);
    assert.equal(config().get('monthlyCreditBudget'), 0);
    assert.deepEqual(config().get('workspaceCreditBudgets'), {});
  });

  it('can be changed while the extension runs without breaking it', async () => {
    const extension = vscode.extensions.getExtension('local.traceon');
    assert.ok(extension);
    await extension.activate();
    await config().update('liveNudge', true, vscode.ConfigurationTarget.Global);
    await config().update('monthlyCreditBudget', 10, vscode.ConfigurationTarget.Global);
    await config().update('workspaceCreditBudgets', { app: 2 }, vscode.ConfigurationTarget.Global);
    await config().update('liveNudge', false, vscode.ConfigurationTarget.Global);
    assert.equal(extension.isActive, true);
  });
});
