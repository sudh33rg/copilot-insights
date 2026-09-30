import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixtureUserDir } from '../../../test/fixtures/fixtures';
import { resolveStorageRoots } from '../ingest/roots';
import { scanDebugLogs, type DebugScanInput } from './scanner';

function setup(overrides: Partial<DebugScanInput> = {}) {
  const { userDir } = createFixtureUserDir();
  const input: DebugScanInput = {
    roots: resolveStorageRoots({ userDirs: [userDir] }),
    known: {},
    tombstones: {},
    ...overrides,
  };
  return { userDir, input };
}

describe('scanDebugLogs', () => {
  it('finds and parses debug logs under each workspace', () => {
    const { input } = setup();
    const { results, stats } = scanDebugLogs(input);
    expect(stats).toMatchObject({ files: 1, parsed: 1, unchanged: 0, skippedDeleted: 0, errors: [] });
    expect(results[0]?.log?.sessionId).toBe('fx-auto-1');
    expect(results[0]?.log?.calls).toHaveLength(4);
  });

  it('skips files whose fingerprint is unchanged and re-parses a grown file', () => {
    const { input, userDir } = setup();
    const first = scanDebugLogs(input);
    const known = Object.fromEntries(first.results.map((result) => [result.file, result.fingerprint]));
    expect(scanDebugLogs({ ...input, known }).stats).toMatchObject({ unchanged: 1, parsed: 0 });
    appendFileSync(
      join(
        userDir,
        'workspaceStorage',
        'ws1',
        'GitHub.copilot-chat',
        'debug-logs',
        'fx-auto-1',
        'main.jsonl',
      ),
      '\n{"ts":1790000099000,"dur":1,"type":"llm_request","spanId":"l9","attrs":{"model":"m","inputTokens":5}}\n',
    );
    const again = scanDebugLogs({ ...input, known });
    expect(again.stats.parsed).toBe(1);
    expect(again.results[0]?.log?.calls.map((call) => call.spanId)).toContain('l9');
  });

  it('skips logs of tombstoned (deleted) sessions but still records their fingerprint', () => {
    const { input } = setup({ tombstones: { 'fx-auto-1': 'deleted' } });
    const { results, stats } = scanDebugLogs(input);
    expect(stats.skippedDeleted).toBe(1);
    expect(results[0]?.log).toBeNull();
    expect(results[0]?.fingerprint).not.toBe('');
  });

  it('ignores directories without a main.jsonl and survives unreadable entries', () => {
    const { input, userDir } = setup();
    const base = join(userDir, 'workspaceStorage', 'ws1', 'GitHub.copilot-chat', 'debug-logs');
    mkdirSync(join(base, 'empty-dir'), { recursive: true });
    writeFileSync(join(base, 'stray-file.txt'), 'x');
    mkdirSync(join(base, 'bad'), { recursive: true });
    writeFileSync(join(base, 'bad', 'main.jsonl'), '\u0000\u0001 not json at all');
    const { stats } = scanDebugLogs(input);
    expect(stats.files).toBe(2);
    expect(stats.errors).toEqual([]);
    rmSync(join(base, 'bad'), { recursive: true });
  });
});
