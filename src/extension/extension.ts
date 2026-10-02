import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getToolAnalytics } from '../core/query/toolAnalytics';
import { SessionLibrary } from '../core/storage/sessionLibrary';
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
import { getActiveSession } from '../core/query/activeSession';
import { assertRange } from '../core/query/trends';
import { CONFIG_SECTION, readConfig } from './config';
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
import { BudgetAlerts } from './budgetAlerts';
import { LiveNudge } from './liveNudge';
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
const NUDGE_DEBOUNCE_MS = 1000;
const LEGACY_EXTENSION_STORAGE_ID = 'local.copilot-insights';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('TraceOn', { log: true });
  context.subscriptions.push(log);
  const version = extensionVersion(context);
  const storageDir = context.globalStorageUri.fsPath;
  mkdirSync(storageDir, { recursive: true });
  migrateLegacyDatabase(storageDir);

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

  const budgetAlerts = new BudgetAlerts({
    budget: () => queries.getBudget(localDay(), readConfig().budgets),
    state: context.globalState,
    notify: (message) => {
      void vscode.window.showWarningMessage(message);
    },
    month: () => localDay().slice(0, 7),
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
    retentionDays: () => readConfig().retentionDays,
    onChanged: () => {
      dataChanged.fire();
      void liveObserver.tick();
      scheduleNudge();
      void budgetAlerts.check().catch((error: unknown) => {
        log.warn(`Budget check failed: ${error instanceof Error ? error.message : String(error)}`);
      });
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
  const nudgeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  nudgeItem.command = 'copilotInsights.openDashboard';
  const liveNudge = new LiveNudge({
    enabled: () => readConfig().liveNudge,
    active: () => getActiveSession(database),
    statusBar: {
      show: (text, tooltip) => {
        nudgeItem.text = text;
        nudgeItem.tooltip = tooltip;
        nudgeItem.show();
      },
      hide: () => {
        nudgeItem.hide();
      },
    },
    now: Date.now,
  });
  let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleNudge = () => {
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => {
      liveNudge.update();
    }, NUDGE_DEBOUNCE_MS);
  };
  const liveTimer = setInterval(() => {
    void liveObserver.tick();
    liveNudge.update();
  }, LIVE_TICK_MS);

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
    getIndexStatus: () => indexStatus(service, sessions, state),
    listSessions: (params) => queries.listSessions(params),
    getSession: ({ id }) => queries.getSession(id),
    saveAnnotation: ({ id, annotation }) => new SessionLibrary(database).save(id, annotation),
    getSavedViews: () => new SessionLibrary(database).views(),
    saveView: (view) => {
      new SessionLibrary(database).saveView(view);
      return { saved: true };
    },
    deleteView: ({ id }) => {
      new SessionLibrary(database).deleteView(id);
      return { deleted: true };
    },
    getOverview: () => queries.getOverview(localDay()),
    getSurvivalByModel: () => ({ rows: queries.getSurvivalByModel() }),
    getCommitCosts: () => ({ rows: queries.getCommitCosts() }),
    getToolAnalytics: (params) => getToolAnalytics(database, params),
    getFailureAnalytics: () => queries.getFailureAnalytics(),
    getBaselines: () => queries.getBaselines(),
    getLeaderboard: () => queries.getLeaderboard(),
    getPromptStyle: () => queries.getPromptStyle(),
    getAutoAudit: () => queries.getAutoAudit(),
    getBudget: () => queries.getBudget(localDay(), readConfig().budgets),
    getTrends: ({ days }) => ({ days: queries.getTrends(localDay(), days) }),
    getRangeBreakdown: ({ from, to }) => {
      assertRange(from, to);
      return queries.getRangeBreakdown(from, to);
    },
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
    registerTerminalObserver(observations, () => getOrCreateSalt(state)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${CONFIG_SECTION}.liveNudge`)) liveNudge.update();
    }),
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
        clearTimeout(nudgeTimer);
        nudgeItem.dispose();
        controller.dispose();
        lock.release();
        database.close();
      },
    },
  );
  controller.start();
  void liveObserver.tick();
  offerLegacyCleanup(dataDeps);
  log.info(`TraceOn ${version} activated (storage: ${storageDir})`);
}

/** Preserve the existing local index after the package identity changes. */
function migrateLegacyDatabase(storageDir: string): void {
  const databasePath = join(storageDir, 'insights.db');
  if (existsSync(databasePath)) return;

  const legacyStorageDir = join(dirname(storageDir), LEGACY_EXTENSION_STORAGE_ID);
  const legacyWal = join(legacyStorageDir, 'insights.db-wal');
  if (existsSync(legacyWal)) copyFileSync(legacyWal, join(storageDir, 'insights.db-wal'));

  const legacyDatabase = join(legacyStorageDir, 'insights.db');
  if (existsSync(legacyDatabase)) copyFileSync(legacyDatabase, databasePath);
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}

function extensionVersion(context: vscode.ExtensionContext): string {
  const manifest = context.extension.packageJSON as { version?: unknown };
  return typeof manifest.version === 'string' ? manifest.version : 'dev';
}
