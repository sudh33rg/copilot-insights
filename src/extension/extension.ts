import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { ClearService } from '../core/clear/clearService';
import { GithubClient } from '../core/github/client';
import { syncGithubUsage } from '../core/github/usage';
import { GithubUsageStore } from '../core/github/usageStore';
import { indexStatus } from '../core/ingest/indexStatus';
import { IngestService, META, getOrCreateSalt } from '../core/ingest/ingestService';
import { resolveStorageRoots, userDirsFromGlobalStorage } from '../core/ingest/roots';
import { runScan } from '../core/ingest/runScan';
import { WriterLock } from '../core/ingest/writerLock';
import { getCoverage } from '../core/query/coverage';
import { InsightsQueries } from '../core/query/insightsQueries';
import { Database } from '../core/storage/database';
import { IngestStateStore } from '../core/storage/ingestStateStore';
import { ObservationStore } from '../core/storage/observationStore';
import { SessionStore } from '../core/storage/sessionStore';
import { daysAgo, localDay } from '../core/time';
import { getDiagnostics } from '../core/query/diagnostics';
import { readConfig } from './config';
import { readDebugLoggingEnabled, runEnableDebugLogging } from './telemetry';
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
import { snapshotDiagnostics } from './observers/diagnosticsAdapter';
import { VscodeGit } from './observers/gitAdapter';
import { LiveObserver } from './observers/liveObserver';
import { readWorkspaceFile } from './observers/readFile';
import { registerTerminalObserver } from './observers/terminalObserver';
import { DashboardPanel } from './webviewHost/dashboardPanel';
import type { RpcHandlers } from './webviewHost/rpcHost';
import { SidebarProvider } from './webviewHost/sidebarProvider';

const LIVE_TICK_MS = 60_000;

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
  const observations = new ObservationStore(database);
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

  const liveObserver = new LiveObserver({
    database,
    observations,
    git: new VscodeGit(),
    readFile: readWorkspaceFile,
    diagnostics: snapshotDiagnostics,
    salt: () => getOrCreateSalt(state),
    log: {
      warn: (message) => {
        log.warn(message);
      },
    },
  });

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
      void liveObserver.tick();
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
  const liveTimer = setInterval(() => void liveObserver.tick(), LIVE_TICK_MS);

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
    getSurvivalByModel: () => ({ rows: queries.getSurvivalByModel() }),
    getCommitCosts: () => ({ rows: queries.getCommitCosts() }),
    getFailureAnalytics: () => queries.getFailureAnalytics(),
    clearData: ({ scope }) => confirmAndClear(dataDeps, scope),
    exportData: () => exportToFile(dataDeps),
    getGithubUsage: ({ days }) => {
      const today = localDay();
      return {
        days: getCoverage(database, github.list(daysAgo(today, days - 1), today)),
        lastSyncedAt: github.lastSyncedAt(),
        account: github.account(),
      };
    },
    syncGithubUsage: syncGithub,
    enableDebugLogging: async () => ({ outcome: await runEnableDebugLogging() }),
    getDiagnostics: () => {
      const last = service.lastResult;
      const stats = last?.role === 'leader' ? last : null;
      return {
        versions: {
          vscode: vscode.version,
          copilotChat:
            ((
              vscode.extensions.getExtension('GitHub.copilot-chat')?.packageJSON as
                { version?: unknown } | undefined
            )?.version as string | undefined) ?? null,
          extension: version,
        },
        debugLogging: readDebugLoggingEnabled(),
        ...getDiagnostics(database, {
          role: last?.role ?? 'idle',
          lastSyncAt: Number(state.getMeta(META.lastSyncAt)) || null,
          lastError: service.lastError,
          parseErrors: stats?.errors.length ?? 0,
          badLines: stats?.badLines ?? 0,
        }),
      };
    },
    openDashboard: () => {
      dashboard.show();
      return { opened: true };
    },
  };
  const dashboard = new DashboardPanel(context.extensionUri, handlers, log);
  const sidebar = new SidebarProvider(context.extensionUri, handlers, log);

  context.subscriptions.push(
    dataChanged,
    registerTerminalObserver(
      observations,
      () => getOrCreateSalt(state),
      () => readConfig().captureLevel,
    ),
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
        clearInterval(liveTimer);
        controller.dispose();
        lock.release();
        database.close();
      },
    },
  );
  controller.start();
  void liveObserver.tick();
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
