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

  describe('prompt file sizes', () => {
    const logDir = (userDir: string) =>
      join(userDir, 'workspaceStorage', 'ws1', 'GitHub.copilot-chat', 'debug-logs', 'fx-auto-1');
    const tool = (name: string) => ({
      type: 'function',
      name,
      description: 'SECRET-description',
      parameters: {},
    });

    function withFiles(
      files: Record<string, string>,
      names: { toolsFile?: string; systemPromptFile?: string },
    ) {
      const { input, userDir } = setup();
      const dir = logDir(userDir);
      appendFileSync(
        join(dir, 'main.jsonl'),
        `\n${JSON.stringify({ ts: 1790000099000, dur: 1, type: 'llm_request', spanId: 'l9', attrs: { model: 'm', ...names } })}\n`,
      );
      for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
      return scanDebugLogs(input).results[0]?.log;
    }

    it('reads tool definition and system prompt sizes next to main.jsonl, and never their text', () => {
      const log = withFiles(
        {
          'tools_0.json': JSON.stringify({
            content: JSON.stringify([tool('read_file'), tool('grep_search')]),
          }),
          'system_prompt_0.json': JSON.stringify({ content: 'SECRET-system-prompt' }),
        },
        { toolsFile: 'tools_0.json', systemPromptFile: 'system_prompt_0.json' },
      );
      expect(log?.toolDefs?.map((def) => def.name)).toEqual(['read_file', 'grep_search']);
      expect(log?.systemPromptChars).toBe('SECRET-system-prompt'.length);
      expect(JSON.stringify(log)).not.toContain('SECRET');
    });

    it('leaves sizes null when the named files are missing or unreadable', () => {
      const log = withFiles(
        { 'tools_0.json': 'not json' },
        { toolsFile: 'tools_0.json', systemPromptFile: 'system_prompt_9.json' },
      );
      expect(log?.toolDefs).toBeNull();
      expect(log?.systemPromptChars).toBeNull();
    });

    it('ignores files larger than 5 MB', () => {
      const log = withFiles(
        { 'system_prompt_0.json': JSON.stringify({ content: 'x'.repeat(5 * 1024 * 1024 + 1) }) },
        { systemPromptFile: 'system_prompt_0.json' },
      );
      expect(log?.systemPromptChars).toBeNull();
    });
  });
});
