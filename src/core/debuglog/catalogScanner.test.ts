import { describe, expect, it } from 'vitest';
import { createFixtureUserDir } from '../../../test/fixtures/fixtures';
import { resolveStorageRoots } from '../ingest/roots';
import { scanCatalogs } from './catalogScanner';

describe('scanCatalogs', () => {
  it('parses each models.json once and skips unchanged files', () => {
    const { userDir } = createFixtureUserDir();
    const roots = resolveStorageRoots({ userDirs: [userDir] });
    const first = scanCatalogs({ roots, known: {} });
    expect(first.stats).toMatchObject({ files: 1, parsed: 1, unchanged: 0, errors: [] });
    expect(first.results[0]?.models.map((model) => model.id)).toEqual([
      'gpt-5.6-luna',
      'gpt-4o-mini',
      'weird',
    ]);
    expect(first.results[0]?.seenAt).toBeGreaterThan(0);
    const known = Object.fromEntries(first.results.map((result) => [result.file, result.fingerprint]));
    expect(scanCatalogs({ roots, known }).stats).toMatchObject({ unchanged: 1, parsed: 0 });
  });
});
