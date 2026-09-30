import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Copilot Insights', { log: true });
  context.subscriptions.push(log);
  log.info(`Copilot Insights ${extensionVersion(context)} activated`);
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}

function extensionVersion(context: vscode.ExtensionContext): string {
  const manifest = context.extension.packageJSON as { version?: unknown };
  return typeof manifest.version === 'string' ? manifest.version : 'dev';
}
