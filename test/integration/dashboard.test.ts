import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

describe('dashboard', () => {
  it('opens a Copilot Insights editor tab', async () => {
    await vscode.commands.executeCommand('copilotInsights.openDashboard');
    const labels = vscode.window.tabGroups.all.flatMap((group) => group.tabs.map((tab) => tab.label));
    assert.ok(labels.includes('Copilot Insights'), `open tabs: ${labels.join(', ')}`);
  });
});
