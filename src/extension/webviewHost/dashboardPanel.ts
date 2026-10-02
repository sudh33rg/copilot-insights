import * as vscode from 'vscode';
import { attachWebview } from './attachWebview';
import type { RpcHandlers, RpcHost } from './rpcHost';

export class DashboardPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private rpc: RpcHost | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: RpcHandlers,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'copilotInsights.dashboard',
      'TraceOn',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
      },
    );
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg');
    this.rpc = attachWebview(panel.webview, this.extensionUri, 'dashboard', this.handlers, this.log);
    panel.onDidDispose(() => {
      this.rpc?.dispose();
      this.rpc = undefined;
      this.panel = undefined;
    });
    this.panel = panel;
  }

  notifyDataChanged(): void {
    this.rpc?.emit({ name: 'dataChanged' });
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
