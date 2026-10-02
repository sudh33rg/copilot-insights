import * as vscode from 'vscode';
import { RpcHost, type RpcHandlers } from './rpcHost';
import { createNonce, renderWebviewHtml, type WebviewKind } from './webviewHtml';

export function attachWebview(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  view: WebviewKind,
  handlers: RpcHandlers,
  log: vscode.LogOutputChannel,
): RpcHost {
  const root = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  webview.options = { enableScripts: true, localResourceRoots: [root] };
  webview.html = renderWebviewHtml({
    cspSource: webview.cspSource,
    scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.js')).toString(),
    styleUri: webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.css')).toString(),
    nonce: createNonce(),
    view,
    title: 'TraceOn',
  });
  return new RpcHost(webview, handlers, (error) => {
    log.error(error instanceof Error ? error : String(error));
  });
}
