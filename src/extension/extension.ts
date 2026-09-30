import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { indexStatus } from '../core/ingest/indexStatus';
import { IngestService } from '../core/ingest/ingestService';
import { resolveStorageRoots, userDirsFromGlobalStorage } from '../core/ingest/roots';
import { runScan } from '../core/ingest/runScan';
import { WriterLock } from '../core/ingest/writerLock';
import { Database } from '../core/storage/database';
import { IngestStateStore } from '../core/storage/ingestStateStore';
import { SessionStore } from '../core/storage/sessionStore';
import { readConfig } from './config';
import { IngestController } from './ingestController';
import { DashboardPanel } from './webviewHost/dashboardPanel';
import type { RpcHandlers } from './webviewHost/rpcHost';
import { SidebarProvider } from './webviewHost/sidebarProvider';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Copilot Insights', { log: true });
  context.subscriptions.push(log);
  const version = extensionVersion(context);
  const storageDir = context.globalStorageUri.fsPath;
  mkdirSync(storageDir, { recursive: true });

  const database = new Database(join(storageDir, 'insights.db'));
  const sessions = new SessionStore(database);
  const state = new IngestStateStore(database);
  const lock = new WriterLock(storageDir);
  const dataChanged = new vscode.EventEmitter<void>();

  const service = new IngestService({
    database,
    sessions,
    state,
    lock,
    resolveRoots: () =>
      resolveStorageRoots({
        userDirs: userDirsFromGlobalStorage(storageDir),
        extraWorkspaceStorageRoots: readConfig().storageRoots,
      }),
    runScan: (input) =>
      runScan(input, { workerFile: join(context.extensionUri.fsPath, 'dist', 'scanWorker.js') }),
    captureLevel: () => readConfig().captureLevel,
    retentionDays: () => readConfig().retentionDays,
    onChanged: () => {
      dataChanged.fire();
    },
    log: {
      info: (message) => {
        log.info(message);
      },
      warn: (message) => {
        log.warn(message);
      },
    },
  });
  const controller = new IngestController(service, context.storageUri, log);

  const handlers: RpcHandlers = {
    ping: () => ({ version, now: Date.now() }),
    getIndexStatus: () => indexStatus(service, sessions, state, readConfig().captureLevel),
  };
  const dashboard = new DashboardPanel(context.extensionUri, handlers, log);
  const sidebar = new SidebarProvider(context.extensionUri, handlers, log);

  context.subscriptions.push(
    dataChanged,
    dashboard,
    sidebar,
    dataChanged.event(() => {
      dashboard.notifyDataChanged();
      sidebar.notifyDataChanged();
    }),
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar),
    vscode.commands.registerCommand('copilotInsights.openDashboard', () => {
      dashboard.show();
    }),
    vscode.commands.registerCommand('copilotInsights.refreshSessions', () => controller.sync(false)),
    vscode.commands.registerCommand('copilotInsights.rebuildIndex', () => controller.sync(true)),
    // Stop background work before the database closes.
    {
      dispose: () => {
        controller.dispose();
        lock.release();
        database.close();
      },
    },
  );
  controller.start();
  log.info(`Copilot Insights ${version} activated (storage: ${storageDir})`);
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}

function extensionVersion(context: vscode.ExtensionContext): string {
  const manifest = context.extension.packageJSON as { version?: unknown };
  return typeof manifest.version === 'string' ? manifest.version : 'dev';
}
