import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixturePath } from '../../../test/fixtures/fixtures';
import { modelHost, modelNameFromId, normalizeChatSession, toolFileAction } from './chatSession';
import { replayMutationLog } from './mutationLog';

function load(name: string) {
  const file = fixturePath(name);
  return normalizeChatSession(replayMutationLog(readFileSync(file, 'utf8')).state, {
    file,
    workspace: 'alpha',
  });
}

describe('normalizeChatSession', () => {
  it('returns null for a session without requests', () => {
    expect(load('empty-session.jsonl')).toBeNull();
  });

  it('rebuilds an Auto agent session with exact usage, credits and routing', () => {
    const session = load('auto-agent-session.jsonl');
    expect(session).toMatchObject({
      id: 'fx-auto-1',
      workspace: 'alpha',
      title: 'Fix run timeout race',
      location: 'panel',
      startedAt: 1790000001000,
      endedAt: 1790000070000,
      activeMs: 18000,
      diagnostics: { unknownPartKinds: [], unknownRequestKeys: [], invalidRequests: 0 },
    });
    expect(session?.turns).toHaveLength(2);
    expect(session?.turns[0]).toMatchObject({
      index: 1,
      requestId: 'req-1',
      responseId: 'llm-resp-1',
      state: 'complete',
      startedAt: 1790000001000,
      endedAt: 1790000009000,
      elapsedMs: 8000,
      mode: 'agent',
      userText: 'Fix the timeout race in src/execution/manager.ts',
      assistantText: 'Fixed the initialization race by awaiting the lock before start.',
      requestedModel: 'copilot/auto',
      resolvedModel: 'gpt-5.6-luna',
      resolvedModelSource: 'exact:autoModeResolution',
      selectionMode: 'AUTO',
      selectionSource: 'COPILOT_AUTO',
      modelHost: 'copilot',
      promptTokens: 24000,
      completionTokens: 1700,
      credits: 1.126141,
      reasoningBlocks: 1,
      reasoningMs: 1200,
      toolRounds: 2,
      toolInputRetries: 1,
      maxToolCallsExceeded: false,
      errorCode: null,
      compactions: [
        { contextLengthBefore: 98000, model: 'gpt-5.6-mini', durationMs: 900, outcome: 'success' },
      ],
    });
    expect(session?.turns[0]?.promptComposition).toContainEqual({
      category: 'System',
      label: 'Tool Definitions',
      percent: 40,
    });
    expect(session?.turns[0]?.toolCalls.map((call) => [call.name, call.origin])).toEqual([
      ['read_file', 'toolCallRound'],
      ['replace_string_in_file', 'toolCallRound'],
    ]);
    expect(session?.turns[0]?.toolCalls[0]?.args).toMatchObject({
      filePath: '/repo/src/execution/manager.ts',
    });
    expect(session?.turns[0]?.fileEvents).toEqual([
      { path: '/repo/src/execution/manager.ts', action: 'read', source: 'tool:copilot_readFile' },
      { path: '/repo/src/execution/manager.ts', action: 'edited', source: 'textEditGroup' },
    ]);
  });

  it('applies truncate-then-append updates and records later edit outcomes', () => {
    const second = load('auto-agent-session.jsonl')?.turns[1];
    expect(second).toMatchObject({
      assistantText: 'Added a regression test in test/manager.test.ts and ran it.',
      credits: 0.5,
      promptTokens: 30000,
      completionTokens: 900,
    });
    expect(second?.fileEvents).toEqual([
      { path: '/repo/test/manager.test.ts', action: 'created', source: 'toolArgs:create_file' },
      { path: '/repo/src/execution/manager.ts', action: 'kept', source: 'editedFileEvents' },
    ]);
  });

  it('handles BYOK models, failures, system-initiated turns and schema drift', () => {
    const session = load('byok-failed-session.jsonl');
    expect(session?.diagnostics).toEqual({
      unknownPartKinds: ['brandNewPartKind'],
      unknownRequestKeys: ['futureField'],
      invalidRequests: 1,
    });
    expect(session?.activeMs).toBe(4000);
    expect(session?.turns[0]).toMatchObject({
      state: 'failed',
      errorCode: 'failed',
      errorMessage: 'Sorry, your request failed. Please try again.',
      modelHost: 'byok',
      requestedModel: 'ollama/Ollama/qwen3.5:35b',
      resolvedModel: 'qwen3.5:35b',
      resolvedModelSource: 'derived:modelId',
      selectionMode: 'MANUAL',
      selectionSource: 'USER',
      promptTokens: null,
      credits: null,
      mode: 'ask',
      assistantText: null,
    });
    expect(session?.turns[1]).toMatchObject({
      state: 'cancelled',
      systemInitiated: true,
      assistantText: 'Tests finished.',
      promptTokens: 5000,
    });
  });

  it('falls back to the file name when the state has no sessionId', () => {
    const session = normalizeChatSession(
      { requests: [{ requestId: 'r', message: { text: 'hi' } }] },
      { file: '/x/chatSessions/abc-123.jsonl', workspace: 'w' },
    );
    expect(session?.id).toBe('abc-123');
    expect(session?.turns[0]?.state).toBe('unknown');
  });
});

describe('model and tool helpers', () => {
  it('classifies providers', () => {
    expect(modelHost('copilot/auto')).toBe('copilot');
    expect(modelHost('m365-copilot/x')).toBe('byok');
    expect(modelHost('gpt-4o')).toBe('unknown');
    expect(modelHost(null)).toBe('unknown');
  });

  it('extracts model names', () => {
    expect(modelNameFromId('copilot/gpt-5.6')).toBe('gpt-5.6');
    expect(modelNameFromId('nvidia-nim/NVIDIA NIM/nvidia/nemotron-3')).toBe('nvidia/nemotron-3');
    expect(modelNameFromId('plain')).toBe('plain');
  });

  it('maps tool names to file actions', () => {
    expect(toolFileAction('copilot_readFile')).toBe('read');
    expect(toolFileAction('create_file')).toBe('created');
    expect(toolFileAction('replace_string_in_file')).toBe('edited');
    expect(toolFileAction('delete_file')).toBe('deleted');
  });
});
