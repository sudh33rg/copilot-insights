import * as vscode from 'vscode';
import { DashboardPanel } from './webviewHost/dashboardPanel';
import type { RpcHandlers } from './webviewHost/rpcHost';
import { SidebarProvider } from './webviewHost/sidebarProvider';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Copilot Insights', { log: true });
  const version = extensionVersion(context);
  const handlers: RpcHandlers = { ping: () => ({ version, now: Date.now() }) };
  const dashboard = new DashboardPanel(context.extensionUri, handlers, log);
  const sidebar = new SidebarProvider(context.extensionUri, handlers, log);
  context.subscriptions.push(
    log,
    dashboard,
    sidebar,
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar),
    vscode.commands.registerCommand('copilotInsights.openDashboard', () => {
      dashboard.show();
    }),
  );
  log.info(`Copilot Insights ${version} activated`);
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}

function extensionVersion(context: vscode.ExtensionContext): string {
  const manifest = context.extension.packageJSON as { version?: unknown };
  return typeof manifest.version === 'string' ? manifest.version : 'dev';
}
