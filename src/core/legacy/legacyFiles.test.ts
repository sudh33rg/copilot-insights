import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deleteLegacyFiles, findLegacyFiles } from './legacyFiles';

describe('legacy v0.2 data', () => {
  it('finds only the known legacy files and deletes exactly those', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-legacy-'));
    for (const name of ['usage.sqlite3', 'usage.sqlite3-wal', 'usage.json', 'insights.db', 'scanner.lock']) {
      writeFileSync(join(dir, name), 'x');
    }
    expect(
      findLegacyFiles(dir)
        .map((file) => file.split(/[\\/]/).pop())
        .sort(),
    ).toEqual(['usage.json', 'usage.sqlite3', 'usage.sqlite3-wal']);
    expect(deleteLegacyFiles(dir)).toBe(3);
    expect(findLegacyFiles(dir)).toEqual([]);
    expect(existsSync(join(dir, 'insights.db'))).toBe(true);
    expect(existsSync(join(dir, 'scanner.lock'))).toBe(true);
  });

  it('is a no-op for a missing directory', () => {
    expect(findLegacyFiles(join(tmpdir(), 'ci-does-not-exist-xyz'))).toEqual([]);
  });
});
