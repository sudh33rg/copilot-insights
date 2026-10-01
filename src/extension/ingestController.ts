import * as vscode from 'vscode';
import type { IngestService, SyncResult } from '../core/ingest/ingestService';
import { CONFIG_SECTION, readConfig } from './config';

/** Decides when to sync: on a timer, when this workspace's chat files change, and on relevant setting changes. */
export class IngestController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private interval: NodeJS.Timeout | undefined;
  private debounce: NodeJS.Timeout | undefined;

  constructor(
    private readonly service: IngestService,
    private readonly workspaceStorageUri: vscode.Uri | undefined,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  start(): void {
    this.scheduleInterval();
    this.watchCurrentWorkspaceSessions();
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        this.onConfigurationChanged(event);
      }),
    );
    this.syncSoon(1_500);
  }

  sync(force: boolean): Promise<SyncResult> {
    return this.service.sync({ force });
  }

  dispose(): void {
    clearInterval(this.interval);
    clearTimeout(this.debounce);
    for (const disposable of this.disposables) disposable.dispose();
  }

  private scheduleInterval(): void {
    clearInterval(this.interval);
    this.interval = setInterval(() => {
      this.syncSoon(0);
    }, readConfig().refreshSeconds * 1_000);
  }

  private syncSoon(delayMs = 2_000): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.service.sync().catch((error: unknown) => {
        this.log.error(`Session sync failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, delayMs);
  }

  private watchCurrentWorkspaceSessions(): void {
    if (this.workspaceStorageUri === undefined) return;
    // context.storageUri is <workspaceStorage>/<hash>/<extension id>; Copilot writes to <hash>/chatSessions.
    const chatSessions = vscode.Uri.joinPath(this.workspaceStorageUri, '..', 'chatSessions');
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(chatSessions, '*.jsonl'),
    );
    this.disposables.push(
      watcher,
      watcher.onDidChange(() => {
        this.syncSoon();
      }),
      watcher.onDidCreate(() => {
        this.syncSoon();
      }),
    );
  }

  private onConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
    if (!event.affectsConfiguration(CONFIG_SECTION)) return;
    if (event.affectsConfiguration(`${CONFIG_SECTION}.nativeRefreshSeconds`)) this.scheduleInterval();
    this.syncSoon();
  }
}
