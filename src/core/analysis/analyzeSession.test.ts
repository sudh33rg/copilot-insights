import { describe, expect, it } from 'vitest';
import { makeTurn } from '../../../test/fixtures/turns';
import { analyzeSession } from './analyzeSession';

describe('analyzeSession', () => {
  const turns = [
    makeTurn({
      index: 1,
      userText: 'Fix the timeout race in src/execution/manager.ts',
      fileEvents: [{ path: '/repo/src/execution/manager.ts', action: 'edited' }],
      toolCalls: [{ name: 'read_file', status: 'complete' }],
    }),
  ];

  it('tags every field derived or inferred, never exact', () => {
    const analysis = analyzeSession({ turns });
    expect(analysis.intent).toMatchObject({ value: 'bugfix', provenance: { kind: 'inferred' } });
    expect(analysis.outcome).toMatchObject({
      value: 'Changed 1 file (1 edited) — in execution.',
      provenance: { kind: 'derived' },
    });
    expect(analysis.areas).toMatchObject({ value: ['execution'], provenance: { kind: 'derived' } });
    expect(analysis.complexity.provenance.kind).toBe('inferred');
    expect(analysis.commandCount.provenance.kind).toBe('derived');
    expect(analysis.findings.every((finding) => finding.provenance.kind === 'inferred')).toBe(true);
  });

  it('does not invent an intent when no prompt text was stored', () => {
    const analysis = analyzeSession({ turns: [makeTurn({ index: 1 })] });
    expect(analysis.intent.value).toBeNull();
    expect(analysis.intent.provenance.kind).toBe('unavailable');
    expect(analysis.outcome.value).toBe('No files changed.');
  });
});
