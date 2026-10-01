import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixtureUserDir } from '../../../test/fixtures/fixtures';
import { resolveStorageRoots } from './roots';
import { listChatSessionFiles, readWorkspaceFolder, scanChatSessions, type ScanInput } from './scanner';

function setup(overrides: Partial<ScanInput> = {}) {
  const { userDir } = createFixtureUserDir();
  const input: ScanInput = {
    roots: resolveStorageRoots({ userDirs: [userDir] }),
    known: {},
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

  it('always captures complete redacted conversation text and tool arguments', () => {
    const { input } = setup();
    const legacyInput = { ...input, captureLevel: 'metrics' };
    const results = scanChatSessions(legacyInput).results;
    expect(JSON.stringify(results)).not.toContain('ghp_');
    const session = results.find((result) => result.session?.id === 'fx-auto-1');
    expect(session?.captureLevel).toBe('full');
    expect(session?.session?.turns[0]?.userText).toContain('Fix the timeout race');
    expect(session?.session?.turns[0]?.toolCalls[0]?.args).toMatchObject({
      filePath: '/repo/src/execution/manager.ts',
    });
  });

  it('never truncates long prompt or response text', () => {
    const { userDir, input } = setup();
    const prompt = 'Explain this code in detail. '.repeat(100).trim();
    const response = 'Here is the complete explanation. '.repeat(100).trim();
    appendFileSync(
      join(userDir, 'workspaceStorage', 'ws1', 'chatSessions', 'fx-auto-1.jsonl'),
      '\n' +
        JSON.stringify({ kind: 1, k: ['requests', 0, 'message', 'text'], v: prompt }) +
        '\n' +
        JSON.stringify({ kind: 1, k: ['requests', 0, 'response'], v: [{ value: response }] }),
    );
    const session = scanChatSessions(input).results.find((result) => result.session?.id === 'fx-auto-1');
    expect(session?.session?.turns[0]?.userText).toBe(prompt);
    expect(session?.session?.turns[0]?.assistantText).toBe(response);
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

describe('readWorkspaceFolder', () => {
  const storageWith = (json: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-ws-'));
    if (json !== undefined) writeFileSync(join(dir, 'workspace.json'), JSON.stringify(json));
    return dir;
  };

  it('returns the folder a single-folder workspace points at', () => {
    expect(readWorkspaceFolder(storageWith({ folder: 'file:///work/my%20app' }))).toBe('/work/my app');
  });

  it('uses the directory holding a multi-root .code-workspace file', () => {
    expect(readWorkspaceFolder(storageWith({ workspace: 'file:///work/team/team.code-workspace' }))).toBe(
      '/work/team',
    );
  });

  it('returns null when it cannot tell: no workspace.json, corrupt JSON, or a remote workspace', () => {
    expect(readWorkspaceFolder(storageWith(undefined))).toBeNull();
    const corrupt = mkdtempSync(join(tmpdir(), 'ci-ws-'));
    writeFileSync(join(corrupt, 'workspace.json'), '{not json');
    expect(readWorkspaceFolder(corrupt)).toBeNull();
    expect(
      readWorkspaceFolder(storageWith({ folder: 'vscode-remote://ssh-remote+box/home/me/app' })),
    ).toBeNull();
  });

  it('is attached to each listed session file', () => {
    const root = mkdtempSync(join(tmpdir(), 'ci-ws-root-'));
    const ws = join(root, 'ws1');
    mkdirSync(join(ws, 'chatSessions'), { recursive: true });
    writeFileSync(join(ws, 'workspace.json'), JSON.stringify({ folder: 'file:///work/app' }));
    writeFileSync(join(ws, 'chatSessions', 'a.jsonl'), '');
    const files = listChatSessionFiles(
      resolveStorageRoots({ userDirs: [], extraWorkspaceStorageRoots: [root] }),
    );
    expect(files.map((file) => file.workspacePath)).toEqual(['/work/app']);
  });
});
