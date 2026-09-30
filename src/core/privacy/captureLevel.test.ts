import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixturePath } from '../../../test/fixtures/fixtures';
import { normalizeChatSession } from '../ingest/chatSession';
import { replayMutationLog } from '../ingest/mutationLog';
import { applyCaptureLevel, isCaptureLevel, truncate } from './captureLevel';

const loaded = normalizeChatSession(
  replayMutationLog(readFileSync(fixturePath('auto-agent-session.jsonl'), 'utf8')).state,
  { file: 'f', workspace: 'w' },
);
if (loaded === null) throw new Error('fixture failed to load');
const session = loaded;

describe('applyCaptureLevel', () => {
  it('full keeps text and arguments but redacts secrets', () => {
    const full = applyCaptureLevel(session, 'full');
    expect(full.turns[0]?.userText).toBe(session.turns[0]?.userText);
    expect(JSON.stringify(full.turns[1]?.toolCalls[0]?.args)).toContain('[REDACTED:github-token]');
    expect(JSON.stringify(full)).not.toContain('ghp_');
  });

  it('summaries truncates text and drops tool arguments', () => {
    const long = {
      ...session,
      turns: session.turns.map((turn) => ({ ...turn, assistantText: 'x'.repeat(1000) })),
    };
    const summaries = applyCaptureLevel(long, 'summaries');
    expect(summaries.turns[0]?.assistantText).toHaveLength(420);
    expect(summaries.turns.flatMap((turn) => turn.toolCalls).every((call) => call.args === null)).toBe(true);
    expect(summaries.title).toBe('Fix run timeout race');
  });

  it('metrics keeps no conversation content but keeps telemetry', () => {
    const metrics = applyCaptureLevel(session, 'metrics');
    expect(metrics.title).toBeNull();
    for (const turn of metrics.turns) {
      expect(turn.userText).toBeNull();
      expect(turn.assistantText).toBeNull();
      expect(turn.errorMessage).toBeNull();
      expect(turn.toolCalls.every((call) => call.args === null)).toBe(true);
    }
    expect(metrics.turns[0]?.promptTokens).toBe(24000);
    expect(metrics.turns[0]?.credits).toBe(1.126141);
    expect(metrics.turns[0]?.fileEvents).toHaveLength(2);
  });

  it('does not mutate its input', () => {
    applyCaptureLevel(session, 'metrics');
    expect(session.turns[0]?.userText).toBe('Fix the timeout race in src/execution/manager.ts');
  });
});

describe('helpers', () => {
  it('validates capture levels', () => {
    expect(isCaptureLevel('full')).toBe(true);
    expect(isCaptureLevel('everything')).toBe(false);
  });

  it('truncates on one line with an ellipsis', () => {
    expect(truncate('a  b\n c', 10)).toBe('a b c');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
  });
});
