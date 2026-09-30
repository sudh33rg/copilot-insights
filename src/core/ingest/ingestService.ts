import type { CaptureLevel } from '../privacy/captureLevel';
import { LlmCallStore } from '../storage/llmCallStore';
import type { Database } from '../storage/database';
import type { IngestStateStore } from '../storage/ingestStateStore';
import type { SessionStore } from '../storage/sessionStore';
import { localDay, retentionCutoff } from '../time';
import type { StorageRoot } from './roots';
import type { FullScanOutput } from './scanAll';
import type { ScanInput, ScanStats } from './scanner';

/** Bump when parsing or normalization changes so every source file is re-parsed on the next sync. */
export const INGEST_VERSION = 1;

export const META = {
  ingestVersion: 'ingest.version',
  lastSyncAt: 'ingest.lastSyncAt',
  lastChangeAt: 'ingest.lastChangeAt',
} as const;

export interface IngestDeps {
  database: Database;
  sessions: SessionStore;
  state: IngestStateStore;
  lock: { tryAcquire(): boolean };
  resolveRoots(): StorageRoot[];
  runScan(input: ScanInput): Promise<FullScanOutput>;
  captureLevel(): CaptureLevel;
  retentionDays(): number;
  onChanged(): void;
  log: { info(message: string): void; warn(message: string): void };
  now?(): number;
}

export type SyncResult = ({ role: 'leader'; purged: number } & ScanStats) | { role: 'follower' };

export class IngestService {
  lastResult: SyncResult | null = null;
  lastError: string | null = null;
  private inFlight: Promise<SyncResult> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastSeenChange: string | null = null;

  private readonly llmCalls: LlmCallStore;

  constructor(private readonly deps: IngestDeps) {
    this.llmCalls = new LlmCallStore(deps.database);
  }

  /** Concurrent non-forced calls share one run; a forced call always runs after whatever is in flight. */
  sync(options: { force?: boolean } = {}): Promise<SyncResult> {
    const force = options.force ?? false;
    if (this.inFlight !== null && !force) return this.inFlight;
    const run = this.queue.then(() => this.run(force));
    const tracked = run.then(
      (result) => {
        this.lastResult = result;
        this.lastError = null;
        return result;
      },
      (error: unknown) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      },
    );
    this.inFlight = tracked;
    this.queue = tracked.catch(() => undefined);
    void tracked
      .finally(() => {
        if (this.inFlight === tracked) this.inFlight = null;
      })
      .catch(() => undefined);
    return tracked;
  }

  /** Scrubs already-stored content down to `level`, then re-parses sources at that level. */
  async changeCaptureLevel(level: CaptureLevel): Promise<SyncResult> {
    if (this.deps.lock.tryAcquire()) {
      this.deps.database.transaction(() => {
        this.deps.sessions.downgradeStoredContent(level);
      });
    }
    return this.sync({ force: true });
  }

  private async run(force: boolean): Promise<SyncResult> {
    const { sessions, state, log } = this.deps;
    if (!this.deps.lock.tryAcquire()) {
      const change = state.getMeta(META.lastChangeAt);
      if (change !== this.lastSeenChange) {
        this.lastSeenChange = change;
        this.deps.onChanged();
      }
      return { role: 'follower' };
    }
    const reparseAll = force || state.getMeta(META.ingestVersion) !== String(INGEST_VERSION);
    const output = await this.deps.runScan({
      roots: this.deps.resolveRoots(),
      known: reparseAll ? {} : state.getFingerprints(),
      captureLevel: this.deps.captureLevel(),
      tombstones: state.getTombstones(),
    });
    const now = this.deps.now?.() ?? Date.now();
    const cutoff = retentionCutoff(this.deps.retentionDays(), localDay(now));
    let written = 0;
    let purged = 0;
    this.deps.database.transaction(() => {
      for (const result of output.results) {
        if (result.session !== null) {
          sessions.replaceSession(result.session, result.captureLevel, now);
          written++;
        }
        state.setFingerprint(result.file, result.fingerprint, result.session?.id ?? null, now);
      }
      for (const debug of output.debug.results) {
        if (debug.log !== null) {
          this.llmCalls.replaceSession(debug.log, debug.file, now);
          written++;
        }
        state.setFingerprint(debug.file, debug.fingerprint, debug.log?.sessionId ?? null, now);
      }
      if (cutoff !== null) purged = sessions.purgeBefore(cutoff);
      state.setMeta(META.ingestVersion, String(INGEST_VERSION));
      state.setMeta(META.lastSyncAt, String(now));
      if (written > 0 || purged > 0) state.setMeta(META.lastChangeAt, String(now));
    });
    for (const error of [...output.stats.errors, ...output.debug.stats.errors].slice(0, 5))
      log.warn(`Could not parse ${error.file}: ${error.message}`);
    if (written > 0 || purged > 0) {
      this.lastSeenChange = String(now);
      log.info(`Indexed ${written} session(s); purged ${purged} past retention.`);
      this.deps.onChanged();
    }
    return { role: 'leader', purged, ...output.stats };
  }
}
