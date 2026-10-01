import { redactDeep, redactSecrets } from '../privacy/redact';
import { isRecord } from '../json';
import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileFingerprint, safeReaddir } from '../ingest/scanner';
import type { StorageRoot } from '../ingest/roots';
import type { TombstoneKind } from '../ingest/types';
import { parseDebugLog } from './parseDebugLog';
import { fileContent, parsePromptFileChars, parseToolDefs } from './promptFiles';
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
      const log = parseDebugLog(sessionId, readFileSync(file, 'utf8'));
      attachPromptFileSizes(log, dirname(file));
      if (input.tombstones[sessionId] === 'content-cleared') {
        log.systemPromptContent = null;
        log.toolDefinitions = [];
      }
      results.push({ file, fingerprint, log });
      stats.parsed++;
    } catch (error) {
      stats.errors.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { results, stats };
}

const MAX_PROMPT_FILE_BYTES = 5 * 1024 * 1024;

/** Measures the tool and system-prompt files next to `main.jsonl`; retains redacted supported payloads alongside sizes and tool names. */
function attachPromptFileSizes(log: DebugSessionLog, dir: string): void {
  const read = (name: string | null): string | null => {
    if (name === null) return null;
    try {
      const path = join(dir, name);
      const stat = lstatSync(path);
      return !stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROMPT_FILE_BYTES
        ? null
        : readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  };
  const tools = read(log.toolsFile);
  log.toolDefs = tools === null ? null : parseToolDefs(tools);
  const system = read(log.systemPromptFile);
  log.systemPromptChars = system === null ? null : parsePromptFileChars(system);
  const content = system === null ? null : fileContent(system);
  log.systemPromptContent = typeof content === 'string' ? redactSecrets(content) : null;
  log.toolDefinitions = [];
  if (tools !== null) {
    const raw = fileContent(tools);
    try {
      const definitions: unknown = typeof raw === 'string' ? JSON.parse(raw) : null;
      if (Array.isArray(definitions))
        log.toolDefinitions = definitions.flatMap((entry: unknown) => {
          if (!isRecord(entry)) return [];
          const nested = isRecord(entry.function) ? entry.function : entry;
          return typeof nested.name === 'string'
            ? [{ name: nested.name, content: JSON.stringify(redactDeep(entry), null, 2) }]
            : [];
        });
    } catch {
      /* Unsupported artifact remains unavailable. */
    }
  }
}
