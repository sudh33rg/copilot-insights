import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const tabLabels = (): string[] =>
  vscode.window.tabGroups.all.flatMap((group) => group.tabs.map((tab) => tab.label));

/** The tab model updates asynchronously after a webview panel is created, so poll instead of reading once. */
async function waitForTab(label: string, timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const labels = tabLabels();
    if (labels.includes(label)) return labels;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return tabLabels();
}

describe('dashboard', () => {
  it('opens a Copilot Insights editor tab', async () => {
    await vscode.commands.executeCommand('copilotInsights.openDashboard');
    const labels = await waitForTab('Copilot Insights', 5000);
    assert.ok(labels.includes('Copilot Insights'), `open tabs: ${labels.join(', ')}`);
  });
});
