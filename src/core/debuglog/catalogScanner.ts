import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { StorageRoot } from '../ingest/roots';
import { fileFingerprint, safeReaddir } from '../ingest/scanner';
import { parseModelsJson, type CatalogModel } from './parseModels';

export interface CatalogScanInput {
  roots: StorageRoot[];
  known: Record<string, string>;
}
export interface CatalogScanResult {
  file: string;
  fingerprint: string;
  seenAt: number;
  models: CatalogModel[];
}
export interface CatalogScanOutput {
  results: CatalogScanResult[];
  stats: { files: number; parsed: number; unchanged: number; errors: { file: string; message: string }[] };
}

export function listCatalogFiles(roots: readonly StorageRoot[]): string[] {
  const files: string[] = [];
  for (const root of roots) {
    if (root.kind !== 'workspaceStorage') continue;
    for (const workspace of safeReaddir(root.dir)) {
      const logs = join(root.dir, workspace, 'GitHub.copilot-chat', 'debug-logs');
      for (const sessionId of safeReaddir(logs)) {
        const file = join(logs, sessionId, 'models.json');
        if (existsSync(file)) files.push(file);
      }
    }
  }
  return files;
}

export function scanCatalogs(input: CatalogScanInput): CatalogScanOutput {
  const stats: CatalogScanOutput['stats'] = { files: 0, parsed: 0, unchanged: 0, errors: [] };
  const results: CatalogScanResult[] = [];
  for (const file of listCatalogFiles(input.roots)) {
    stats.files++;
    const fingerprint = fileFingerprint(file);
    if (fingerprint === null) continue;
    if (input.known[file] === fingerprint) {
      stats.unchanged++;
      continue;
    }
    try {
      const seenAt = Math.floor(statSync(file).mtimeMs);
      results.push({ file, fingerprint, seenAt, models: parseModelsJson(readFileSync(file, 'utf8')) });
      stats.parsed++;
    } catch (error) {
      stats.errors.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { results, stats };
}
