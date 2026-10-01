import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createFixtureUserDir } from '../../../test/fixtures/fixtures';
import { resolveStorageRoots } from './roots';
import { runScan } from './runScan';
import type { ScanInput } from './scanner';

function input(): ScanInput {
  const { userDir } = createFixtureUserDir();
  return {
    roots: resolveStorageRoots({ userDirs: [userDir] }),
    known: {},
    tombstones: {},
  };
}

describe('runScan', () => {
  it('produces the same result in a worker thread as in-process', async () => {
    const outdir = mkdtempSync(join(tmpdir(), 'ci-worker-'));
    await build({
      entryPoints: [fileURLToPath(new URL('./scanWorker.ts', import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: join(outdir, 'scanWorker.js'),
      logLevel: 'silent',
    });
    const scanInput = input();
    const inWorker = await runScan(scanInput, { workerFile: join(outdir, 'scanWorker.js') });
    const inProcess = await runScan(scanInput);
    expect(inWorker.stats).toEqual(inProcess.stats);
    expect(inWorker.results.map((result) => result.session?.id)).toEqual(
      inProcess.results.map((result) => result.session?.id),
    );
  });

  it('rejects when the worker cannot start', async () => {
    await expect(runScan(input(), { workerFile: '/nonexistent/scanWorker.js' })).rejects.toThrow();
  });
});
