import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Baselines } from '../../shared/dto';
import { missing } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { LearningView } from './LearningView';

const derivedNumber = (value: number) => ({
  value,
  provenance: { kind: 'derived' as const, source: 'median of your sessions' },
});

const baselines: Baselines = {
  rows: [
    {
      taskType: 'bugfix',
      model: 'gpt-5.6-luna',
      sessions: 12,
      inputMedian: derivedNumber(48_000),
      creditsMedian: derivedNumber(1.2),
      creditSessions: 10,
    },
    {
      taskType: 'docs',
      model: 'gpt-5.6-luna',
      sessions: 3,
      inputMedian: missing('not enough data: 3 of 5 sessions'),
      creditsMedian: missing('not enough data: 0 of 5 sessions'),
      creditSessions: 0,
    },
  ],
  outliers: [
    {
      sessionId: 'clone-6',
      title: 'Fix run timeout race',
      taskType: 'bugfix',
      model: 'gpt-5.6-luna',
      verdict: { value: 'high', provenance: { kind: 'inferred', source: 'rule' } },
      thisSession: derivedNumber(210_000),
      median: derivedNumber(48_000),
    },
  ],
};

const view = (results: Record<string, unknown> = {}, onOpen = () => undefined) =>
  renderWithHost(<LearningView onOpenSession={onOpen} />, { getBaselines: baselines, ...results });

describe('LearningView — baselines', () => {
  it('shows typical usage per task type and model with sample sizes and provenance', async () => {
    view();
    const table = await screen.findByRole('table', { name: 'Typical usage by task type and model' });
    expect(within(table).getByText('bugfix')).toBeInTheDocument();
    expect(within(table).getByText('48,000')).toBeInTheDocument();
    expect(within(table).getByText('1.2')).toBeInTheDocument();
    expect(within(table).getByText('12')).toBeInTheDocument();
    expect(within(table).getAllByText('Derived').length).toBeGreaterThan(0);
  });

  it('shows a placeholder, not a number, for groups under five sessions', async () => {
    view();
    const table = await screen.findByRole('table', { name: 'Typical usage by task type and model' });
    const docs = within(table).getByText('docs').closest('tr');
    expect(docs).not.toBeNull();
    expect(within(docs as HTMLElement).getAllByText('—').length).toBe(2);
    expect(within(docs as HTMLElement).getAllByText('Unavailable').length).toBe(2);
  });

  it('lists unusual sessions against their median and opens one on click', async () => {
    const opened: string[] = [];
    view({}, ((id: string) => {
      opened.push(id);
    }) as unknown as () => undefined);
    const list = await screen.findByRole('list', { name: 'Unusual sessions' });
    expect(within(list).getByText('Fix run timeout race')).toBeInTheDocument();
    expect(within(list).getByText(/210,000 vs median 48,000/)).toBeInTheDocument();
    expect(within(list).getByText('Inferred')).toBeInTheDocument();
    within(list).getByRole('button', { name: 'Fix run timeout race' }).click();
    expect(opened).toEqual(['clone-6']);
  });

  it('explains an empty history', async () => {
    view({ getBaselines: { rows: [], outliers: [] } });
    expect(
      await screen.findByText(
        'Not enough history yet: baselines need at least 5 sessions of the same task type on the same model.',
      ),
    ).toBeInTheDocument();
  });

  it('reports a failed query', async () => {
    renderWithHost(<LearningView onOpenSession={() => undefined} />, {});
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('Could not load baselines: boom');
  });
});
