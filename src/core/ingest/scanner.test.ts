import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixtureUserDir } from '../../../test/fixtures/fixtures';
import { resolveStorageRoots } from './roots';
import { listChatSessionFiles, scanChatSessions, type ScanInput } from './scanner';

function setup(overrides: Partial<ScanInput> = {}) {
  const { userDir } = createFixtureUserDir();
  const input: ScanInput = {
    roots: resolveStorageRoots({ userDirs: [userDir] }),
    known: {},
    captureLevel: 'full',
    tombstones: {},
    ...overrides,
  };
  return { userDir, input };
}

describe('scanner', () => {
  it('lists chat session files with workspace labels', () => {
    const { input } = setup();
    const files = listChatSessionFiles(input.roots);
    expect(files).toHaveLength(3);
    expect(new Set(files.map((file) => file.workspace))).toEqual(new Set(['alpha', 'No workspace']));
  });

  it('parses sessions and skips empty ones', () => {
    const { input } = setup();
    const { results, stats } = scanChatSessions(input);
    expect(stats).toMatchObject({ files: 3, parsed: 2, empty: 1, unchanged: 0, deleted: 0, errors: [] });
    expect(results.flatMap((result) => (result.session ? [result.session.id] : [])).sort()).toEqual([
      'fx-auto-1',
      'fx-byok-1',
    ]);
    expect(results.find((result) => result.skipped === 'empty')?.session).toBeNull();
  });

  it('skips files whose fingerprint is unchanged', () => {
    const { input } = setup();
    const first = scanChatSessions(input);
    const known = Object.fromEntries(first.results.map((result) => [result.file, result.fingerprint]));
    const second = scanChatSessions({ ...input, known });
    expect(second.stats).toMatchObject({ unchanged: 3, parsed: 0 });
    expect(second.results).toEqual([]);
  });

  it('honours tombstones', () => {
    const { input } = setup({ tombstones: { 'fx-auto-1': 'deleted', 'fx-byok-1': 'content-cleared' } });
    const { results, stats } = scanChatSessions(input);
    expect(stats.deleted).toBe(1);
    const byok = results.find((result) => result.session?.id === 'fx-byok-1');
    expect(byok?.captureLevel).toBe('metrics');
    expect(byok?.session?.turns.every((turn) => turn.userText === null)).toBe(true);
  });

  it('redacts secrets and applies the capture level', () => {
    const { input } = setup();
    expect(JSON.stringify(scanChatSessions(input).results)).not.toContain('ghp_');
    const summaries = scanChatSessions({ ...input, captureLevel: 'summaries' });
    expect(
      summaries.results
        .flatMap((r) => r.session?.turns ?? [])
        .flatMap((t) => t.toolCalls)
        .every((c) => c.args === null),
    ).toBe(true);
  });

  it('parses a file that Copilot is still writing (truncated last line)', () => {
    const { userDir, input } = setup();
    appendFileSync(
      join(userDir, 'workspaceStorage', 'ws1', 'chatSessions', 'fx-auto-1.jsonl'),
      '\n{"kind":1,"k":[',
    );
    const { results, stats } = scanChatSessions(input);
    expect(stats.badLines).toBe(1);
    expect(results.find((result) => result.session?.id === 'fx-auto-1')?.session?.turns).toHaveLength(2);
  });

  it('labels workspaces with a missing or corrupt workspace.json', () => {
    const { userDir, input } = setup();
    writeFileSync(join(userDir, 'workspaceStorage', 'ws1', 'workspace.json'), 'not json');
    expect(listChatSessionFiles(input.roots).find((file) => file.file.includes('ws1'))?.workspace).toBe(
      'workspace:ws1',
    );
  });

  it('records unreadable files as errors and keeps going', () => {
    const { userDir, input } = setup();
    mkdirSync(join(userDir, 'workspaceStorage', 'ws1', 'chatSessions', 'broken.jsonl'));
    const { stats } = scanChatSessions(input);
    expect(stats.errors).toHaveLength(1);
    expect(stats.parsed).toBe(2);
  });
});
