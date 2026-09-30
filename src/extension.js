'use strict';

const vscode = require('vscode');
const { createStore } = require('./storage');
const { DashboardController } = require('./dashboard');
const { GitHubMetricsService } = require('./githubMetrics');
const { NativeCopilotCollector } = require('./nativeCopilot');
const { isoDay, daysAgo } = require('./utils');

let store; let output; let dashboard; let native;

async function activate(context) {
  output = vscode.window.createOutputChannel('Copilot Insights');
  context.subscriptions.push(output);
  store = createStore(context.globalStorageUri.fsPath);
  output.appendLine(`[startup] Copilot Insights ${context.extension.packageJSON.version}`);
  output.appendLine(`[startup] storage=${store.kind} path=${store.filename}`);
  if (store.fallbackReason) output.appendLine(`[startup] SQLite unavailable; JSON fallback active: ${store.fallbackReason}`);
  applyRetention();
  const github = new GitHubMetricsService(vscode, context, store, output);
  dashboard = new DashboardController(vscode, context, store, github, output);
  native = new NativeCopilotCollector(vscode, store, output, () => dashboard.refreshViews());
  dashboard.setNativeCollector(native);
  dashboard.register();
  native.register(context);
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (!event.affectsConfiguration('copilotInsights')) return;
    applyRetention(); dashboard.refreshViews();
  }));
  context.subscriptions.push({ dispose: () => store?.close() });
}
function applyRetention(){if(!store)return;const n=Number(vscode.workspace.getConfiguration('copilotInsights').get('retentionDays',30))||0;if(n<=0)return;const cutoff=daysAgo(isoDay(),n);try{store.purgeBefore(cutoff);output?.appendLine(`[retention] purged sessions before ${cutoff}`);}catch(e){output?.appendLine(`[retention] purge failed: ${e.stack||e}`);}}
function deactivate(){try{store?.close();}catch{}}
module.exports={activate,deactivate};
