import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

describe('commands', () => {
  it('registers every Copilot Insights command', async () => {
    await vscode.extensions.getExtension('local.copilot-insights')?.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'copilotInsights.openDashboard',
      'copilotInsights.refreshSessions',
      'copilotInsights.rebuildIndex',
      'copilotInsights.clearData',
      'copilotInsights.exportData',
      'copilotInsights.deleteLegacyData',
      'copilotInsights.enableDebugLogging',
    ]) {
      assert.ok(commands.includes(id), `${id} is not registered`);
    }
  });
});
