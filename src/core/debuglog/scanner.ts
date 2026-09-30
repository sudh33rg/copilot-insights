import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileFingerprint, safeReaddir } from '../ingest/scanner';
import type { StorageRoot } from '../ingest/roots';
import type { TombstoneKind } from '../ingest/types';
import { parseDebugLog } from './parseDebugLog';
import type { DebugSessionLog } from './types';

export interface DebugFile {
  file: string;
  sessionId: string;
}

export interface DebugScanInput {
  roots: StorageRoot[];
  /** file path → fingerprint from the previous scan. */
  known: Record<string, string>;
  tombstones: Record<string, TombstoneKind>;
}

export interface DebugScanResult {
  file: string;
  fingerprint: string;
  /** null when the session was deleted (tombstone). */
  log: DebugSessionLog | null;
}

export interface DebugScanStats {
  files: number;
  parsed: number;
  unchanged: number;
  skippedDeleted: number;
  errors: { file: string; message: string }[];
}

export interface DebugScanOutput {
  results: DebugScanResult[];
  stats: DebugScanStats;
}

/** `<workspaceStorage>/<hash>/GitHub.copilot-chat/debug-logs/<sessionId>/main.jsonl`. */
export function listDebugLogFiles(roots: readonly StorageRoot[]): DebugFile[] {
  const files: DebugFile[] = [];
  for (const root of roots) {
    if (root.kind !== 'workspaceStorage') continue;
    for (const workspace of safeReaddir(root.dir)) {
      const logs = join(root.dir, workspace, 'GitHub.copilot-chat', 'debug-logs');
      for (const sessionId of safeReaddir(logs)) {
        const file = join(logs, sessionId, 'main.jsonl');
        if (existsSync(file)) files.push({ file, sessionId });
      }
    }
  }
  return files;
}

/** Synchronous and worker-safe. Never throws for one bad file. */
export function scanDebugLogs(input: DebugScanInput): DebugScanOutput {
  const stats: DebugScanStats = { files: 0, parsed: 0, unchanged: 0, skippedDeleted: 0, errors: [] };
  const results: DebugScanResult[] = [];
  for (const { file, sessionId } of listDebugLogFiles(input.roots)) {
    stats.files++;
    const fingerprint = fileFingerprint(file);
    if (fingerprint === null) continue;
    if (input.known[file] === fingerprint) {
      stats.unchanged++;
      continue;
    }
    if (input.tombstones[sessionId] === 'deleted') {
      stats.skippedDeleted++;
      results.push({ file, fingerprint, log: null });
      continue;
    }
    try {
      results.push({ file, fingerprint, log: parseDebugLog(sessionId, readFileSync(file, 'utf8')) });
      stats.parsed++;
    } catch (error) {
      stats.errors.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { results, stats };
}
