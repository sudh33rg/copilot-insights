import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { ClearService } from '../core/clear/clearService';
import { GithubClient } from '../core/github/client';
import { syncGithubUsage } from '../core/github/usage';
import { GithubUsageStore } from '../core/github/usageStore';
import { indexStatus } from '../core/ingest/indexStatus';
import { IngestService } from '../core/ingest/ingestService';
import { resolveStorageRoots, userDirsFromGlobalStorage } from '../core/ingest/roots';
import { runScan } from '../core/ingest/runScan';
import { WriterLock } from '../core/ingest/writerLock';
import { InsightsQueries } from '../core/query/insightsQueries';
import { Database } from '../core/storage/database';
import { IngestStateStore } from '../core/storage/ingestStateStore';
import { SessionStore } from '../core/storage/sessionStore';
import { daysAgo, localDay } from '../core/time';
import { exact } from '../shared/provenance';
import { readConfig } from './config';
import { runEnableDebugLogging } from './telemetry';
import { githubSession } from './githubAuth';
import {
  clearFromPalette,
  confirmAndClear,
  deleteLegacyData,
  exportToFile,
  offerLegacyCleanup,
  type DataCommandDeps,
} from './dataCommands';
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
  const queries = new InsightsQueries(database);
  const clear = new ClearService(database, sessions, state);
  const github = new GithubUsageStore(database);
  const lock = new WriterLock(storageDir);
  const dataChanged = new vscode.EventEmitter<void>();
  const dataDeps: DataCommandDeps = {
    database,
    clear,
    storageDir,
    globalState: context.globalState,
    notifyChanged: () => {
      dataChanged.fire();
    },
  };

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

  // `dashboard` is created after the handlers; the closure reads it lazily.
  const syncGithub = async () => {
    const session = await githubSession(true);
    if (session === undefined) return { signedIn: false, synced: 0, unavailable: false, errors: [] };
    const client = new GithubClient(fetch, session.accessToken);
    const outcome = await syncGithubUsage({
      client,
      user: session.account.label,
      store: github,
      today: localDay(),
      days: 31,
      now: Date.now,
    });
    dataChanged.fire();
    return { signedIn: true, ...outcome };
  };

  const handlers: RpcHandlers = {
    ping: () => ({ version, now: Date.now() }),
    getIndexStatus: () => indexStatus(service, sessions, state, readConfig().captureLevel),
    listSessions: (params) => queries.listSessions(params),
    getSession: ({ id }) => queries.getSession(id),
    getOverview: () => queries.getOverview(localDay()),
    clearData: ({ scope }) => confirmAndClear(dataDeps, scope),
    exportData: () => exportToFile(dataDeps),
    getGithubUsage: ({ days }) => {
      const today = localDay();
      return {
        days: github.list(daysAgo(today, days - 1), today).map((row) => ({
          day: row.day,
          credits: exact(row.credits, 'GitHub billing API: ai_credit/usage (account-wide, all devices)'),
        })),
        lastSyncedAt: github.lastSyncedAt(),
        account: github.account(),
      };
    },
    syncGithubUsage: syncGithub,
    enableDebugLogging: async () => ({ outcome: await runEnableDebugLogging() }),
    openDashboard: () => {
      dashboard.show();
      return { opened: true };
    },
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
    vscode.commands.registerCommand('copilotInsights.clearData', () => clearFromPalette(dataDeps)),
    vscode.commands.registerCommand('copilotInsights.exportData', () => exportToFile(dataDeps)),
    vscode.commands.registerCommand('copilotInsights.deleteLegacyData', () => deleteLegacyData(dataDeps)),
    vscode.commands.registerCommand('copilotInsights.syncGithubUsage', async () => {
      const outcome = await syncGithub();
      void vscode.window.showInformationMessage(
        !outcome.signedIn
          ? 'Sign in to GitHub in VS Code to sync usage.'
          : outcome.unavailable
            ? 'GitHub does not expose usage for this account here (usage billed to an organization is not available).'
            : `Synced GitHub usage for ${String(outcome.synced)} days.`,
      );
    }),
    vscode.commands.registerCommand('copilotInsights.enableDebugLogging', () => runEnableDebugLogging()),
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
  offerLegacyCleanup(dataDeps);
  log.info(`Copilot Insights ${version} activated (storage: ${storageDir})`);
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}

function extensionVersion(context: vscode.ExtensionContext): string {
  const manifest = context.extension.packageJSON as { version?: unknown };
  return typeof manifest.version === 'string' ? manifest.version : 'dev';
}
