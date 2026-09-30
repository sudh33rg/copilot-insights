import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { isRecord } from '../json';
import { applyCaptureLevel, type CaptureLevel } from '../privacy/captureLevel';
import { normalizeChatSession } from './chatSession';
import { loadChatSessionState } from './mutationLog';
import type { StorageRoot } from './roots';
import type { NormalizedSession, TombstoneKind } from './types';

const SESSION_FILE = /\.jsonl?$/i;

export interface SessionFile {
  file: string;
  workspace: string;
  /** Folder the workspace points at; null when unknown (no workspace.json, remote workspace). */
  workspacePath: string | null;
}

export interface ScanInput {
  roots: StorageRoot[];
  /** file path → fingerprint from the previous scan; matching files are skipped. */
  known: Record<string, string>;
  captureLevel: CaptureLevel;
  tombstones: Record<string, TombstoneKind>;
  /** Per-install salt for content-derived fingerprints; omitted means none are produced. */
  salt?: string;
}

export interface ScanResult {
  file: string;
  fingerprint: string;
  session: NormalizedSession | null;
  captureLevel: CaptureLevel;
  skipped: 'empty' | 'deleted' | null;
}

export interface ScanStats {
  files: number;
  parsed: number;
  unchanged: number;
  empty: number;
  deleted: number;
  badLines: number;
  errors: { file: string; message: string }[];
}

export interface ScanOutput {
  results: ScanResult[];
  stats: ScanStats;
}

export function listChatSessionFiles(roots: readonly StorageRoot[]): SessionFile[] {
  const files: SessionFile[] = [];
  for (const root of roots) {
    if (root.kind === 'emptyWindow') {
      for (const name of sessionFileNames(root.dir)) {
        files.push({ file: join(root.dir, name), workspace: 'No workspace', workspacePath: null });
      }
      continue;
    }
    for (const entry of safeReaddir(root.dir)) {
      const workspaceDir = join(root.dir, entry);
      const names = sessionFileNames(join(workspaceDir, 'chatSessions'));
      if (names.length === 0) continue;
      const workspace = readWorkspaceLabel(workspaceDir);
      const workspacePath = readWorkspaceFolder(workspaceDir);
      for (const name of names) {
        files.push({ file: join(workspaceDir, 'chatSessions', name), workspace, workspacePath });
      }
    }
  }
  return files;
}

/** Pure and synchronous: runs inside the scan worker in production. Never throws for a single bad file. */
export function scanChatSessions(input: ScanInput): ScanOutput {
  const stats: ScanStats = {
    files: 0,
    parsed: 0,
    unchanged: 0,
    empty: 0,
    deleted: 0,
    badLines: 0,
    errors: [],
  };
  const results: ScanResult[] = [];
  for (const { file, workspace, workspacePath } of listChatSessionFiles(input.roots)) {
    stats.files++;
    const fingerprint = fileFingerprint(file);
    if (fingerprint === null) continue;
    if (input.known[file] === fingerprint) {
      stats.unchanged++;
      continue;
    }
    try {
      const { state, badLines } = loadChatSessionState(file);
      stats.badLines += badLines;
      const session = normalizeChatSession(state, { file, workspace, workspacePath, salt: input.salt });
      if (session === null) {
        stats.empty++;
        results.push({
          file,
          fingerprint,
          session: null,
          captureLevel: input.captureLevel,
          skipped: 'empty',
        });
        continue;
      }
      const tombstone = input.tombstones[session.id];
      if (tombstone === 'deleted') {
        stats.deleted++;
        results.push({
          file,
          fingerprint,
          session: null,
          captureLevel: input.captureLevel,
          skipped: 'deleted',
        });
        continue;
      }
      const captureLevel: CaptureLevel = tombstone === 'content-cleared' ? 'metrics' : input.captureLevel;
      results.push({
        file,
        fingerprint,
        session: applyCaptureLevel(session, captureLevel),
        captureLevel,
        skipped: null,
      });
      stats.parsed++;
    } catch (error) {
      stats.errors.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { results, stats };
}

/**
 * The folder a workspace storage directory belongs to: the folder of a single-folder workspace, or the directory
 * holding a multi-root `.code-workspace` file (its folders usually live there). Null when it cannot be told.
 */
export function readWorkspaceFolder(workspaceDir: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(workspaceDir, 'workspace.json'), 'utf8'));
    if (!isRecord(parsed)) return null;
    if (typeof parsed.folder === 'string') return fileUriToPath(parsed.folder);
    if (typeof parsed.workspace === 'string') {
      const file = fileUriToPath(parsed.workspace);
      return file === null ? null : dirname(file);
    }
  } catch {
    // Missing or corrupt workspace.json.
  }
  return null;
}

function fileUriToPath(uri: string): string | null {
  try {
    return uri.startsWith('file:') ? fileURLToPath(uri) : null;
  } catch {
    return null;
  }
}

export function readWorkspaceLabel(workspaceDir: string): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(workspaceDir, 'workspace.json'), 'utf8'));
    if (isRecord(parsed)) {
      const uri =
        typeof parsed.folder === 'string'
          ? parsed.folder
          : typeof parsed.workspace === 'string'
            ? parsed.workspace
            : null;
      if (uri !== null) {
        const name = basename(decodeURIComponent(new URL(uri).pathname)).replace(/\.code-workspace$/i, '');
        if (name !== '') return name;
      }
    }
  } catch {
    // Missing or corrupt workspace.json: fall back to the storage folder name.
  }
  return `workspace:${basename(workspaceDir).slice(0, 8)}`;
}

function sessionFileNames(dir: string): string[] {
  return safeReaddir(dir)
    .filter((name) => SESSION_FILE.test(name))
    .sort();
}

export function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function fileFingerprint(file: string): string | null {
  try {
    const stat = statSync(file);
    return `${stat.size}:${Math.floor(stat.mtimeMs)}`;
  } catch {
    return null;
  }
}
