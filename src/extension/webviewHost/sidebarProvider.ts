import * as vscode from 'vscode';
import { attachWebview } from './attachWebview';
import type { RpcHandlers, RpcHost } from './rpcHost';

export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'copilotInsights.sidebar';
  private rpc: RpcHost | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: RpcHandlers,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.rpc?.dispose();
    this.rpc = attachWebview(view.webview, this.extensionUri, 'sidebar', this.handlers, this.log);
    view.onDidDispose(() => {
      this.rpc?.dispose();
      this.rpc = undefined;
    });
  }

  notifyDataChanged(): void {
    this.rpc?.emit({ name: 'dataChanged' });
  }

  dispose(): void {
    this.rpc?.dispose();
  }
}
