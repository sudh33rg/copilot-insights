import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { makeTurn } from '../../../test/fixtures/turns';
import type { SessionDetail } from '../../shared/dto';
import { derived, exact, unavailable } from '../../shared/provenance';
import { AnalysisStore } from '../analysis/analysisStore';
import { getSessionDetail } from '../query/sessionDetail';
import { sessionFactsFromDetail } from './sessionFacts';

function detail(id = 'fx-auto-1'): SessionDetail {
  const { database } = seededStore();
  const raw = getSessionDetail(database, id);
  if (raw === null) throw new Error('missing fixture');
  return { ...raw, analysis: new AnalysisStore(database).forDetail(raw) };
}
const n = (value: number) => exact(value, 'test');

describe('sessionFactsFromDetail', () => {
  it('reads the basics from a Copilot session', () => {
    const facts = sessionFactsFromDetail(detail());
    expect(facts).toMatchObject({
      id: 'fx-auto-1',
      workspace: 'alpha',
      taskType: 'bugfix',
      model: 'gpt-5.6-luna',
      selection: 'auto',
      host: 'copilot',
      inputTokens: 54_000,
      userTurns: 2,
      failedTurns: 0,
      undone: 0,
    });
    expect(facts.credits).toBeCloseTo(1.626141);
    expect(facts.ttftMs).not.toBeNull();
  });

  it('marks BYOK sessions and leaves their credits unknown', () => {
    const facts = sessionFactsFromDetail(detail('fx-byok-1'));
    expect(facts.host).toBe('byok');
    expect(facts.credits).toBeNull();
    expect(facts.failedTurns).toBe(1);
    expect(facts.successful).toBe(false);
  });

  it('treats a lower-bound credit total as unknown rather than as a number', () => {
    const base = detail();
    const facts = sessionFactsFromDetail({
      ...base,
      credits: derived(1.2, 'chatSessions.copilotCredits (lower bound: 1 of 2 turns reported it)'),
    });
    expect(facts.credits).toBeNull();
  });

  it('counts corrections only when prompt text was stored', () => {
    const base = detail();
    const withText = sessionFactsFromDetail({
      ...base,
      turns: [
        makeTurn({ index: 1, userText: 'Fix it in a.ts' }),
        makeTurn({ index: 2, userText: 'no that is wrong' }),
        makeTurn({ index: 3, userText: 'still failing' }),
        makeTurn({ index: 4, userText: 'still failing', systemInitiated: true }),
      ],
    });
    expect(withText.corrections).toBe(2);
    const withoutText = sessionFactsFromDetail({
      ...base,
      turns: [makeTurn({ index: 1 }), makeTurn({ index: 2 })],
    });
    expect(withoutText.corrections).toBeNull();
    expect(withoutText.opening).toBeNull();
  });

  it('describes the opening prompt with the same rules the prompt findings use', () => {
    const base = detail();
    const opening = (text: string) =>
      sessionFactsFromDetail({ ...base, turns: [makeTurn({ index: 1, userText: text })] }).opening;
    expect(opening('Fix the retry in src/upload.ts so that it retries, but only twice')).toEqual({
      namesFile: true,
      statesSuccess: true,
      statesConstraints: true,
    });
    expect(opening('Please improve things')).toEqual({
      namesFile: false,
      statesSuccess: false,
      statesConstraints: false,
    });
  });

  it('defines success as no failed turns, no undone edits and no failed last test', () => {
    const base = detail();
    const passing = { ...base.outcomes, lastTestPassed: derived(true, 'test') };
    expect(sessionFactsFromDetail({ ...base, outcomes: passing }).successful).toBe(true);
    expect(
      sessionFactsFromDetail({
        ...base,
        outcomes: { ...base.outcomes, lastTestPassed: derived(false, 'test') },
      }).successful,
    ).toBe(false);
    expect(
      sessionFactsFromDetail({
        ...base,
        turns: [makeTurn({ index: 1, userText: 'x', fileEvents: [{ path: '/a.ts', action: 'undone' }] })],
      }).successful,
    ).toBe(false);
    expect(
      sessionFactsFromDetail({ ...base, outcomes: { ...base.outcomes, lastTestPassed: unavailable('t') } })
        .successful,
    ).toBe(true);
  });

  it('classifies mixed and unknown selection', () => {
    const base = detail();
    const routing = (...kinds: ('auto' | 'manual' | 'unknown')[]) =>
      sessionFactsFromDetail({
        ...base,
        turns: kinds.map((kind, i) =>
          makeTurn({ index: i + 1, userText: 'x', routing: { kind, label: kind }, modelId: 'm', model: 'm' }),
        ),
      }).selection;
    expect(routing('auto', 'manual')).toBe('mixed');
    expect(routing('manual', 'manual')).toBe('manual');
    expect(routing('unknown')).toBe('unknown');
  });

  it('picks the model behind most user turns and averages first-token latency', () => {
    const base = detail();
    const facts = sessionFactsFromDetail({
      ...base,
      turns: [
        makeTurn({ index: 1, userText: 'x', model: 'A', modelId: 'a', ttftMs: n(1000) }),
        makeTurn({ index: 2, userText: 'x', model: 'B', modelId: 'b', ttftMs: n(3000) }),
        makeTurn({ index: 3, userText: 'x', model: 'B', modelId: 'b' }),
      ],
    });
    expect(facts.model).toBe('B');
    expect(facts.ttftMs).toBe(2000);
  });
});
