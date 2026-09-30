import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Files written by the v0.2 prototype into this extension's own global storage. Nothing else is ever listed. */
export const LEGACY_FILES = [
  'usage.sqlite3',
  'usage.sqlite3-wal',
  'usage.sqlite3-shm',
  'usage.json',
] as const;

export function findLegacyFiles(dir: string): string[] {
  return LEGACY_FILES.map((name) => join(dir, name)).filter((file) => existsSync(file));
}

export function deleteLegacyFiles(dir: string): number {
  const files = findLegacyFiles(dir);
  for (const file of files) rmSync(file, { force: true });
  return files.length;
}
