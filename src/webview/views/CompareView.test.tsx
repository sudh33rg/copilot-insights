import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { exactNumber, sessionDetail, sessionRow } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { CompareView } from './CompareView';

const details = {
  a: sessionDetail({ id: 'a', title: 'Fix run timeout race', inputTokens: exactNumber(54_000) }),
  b: sessionDetail({
    id: 'b',
    title: 'Add retry handling',
    inputTokens: exactNumber(120_000),
    credits: exactNumber(4.25),
  }),
};
const results = {
  listSessions: {
    rows: [
      sessionRow({ id: 'a', title: 'Fix run timeout race' }),
      sessionRow({ id: 'b', title: 'Add retry handling' }),
    ],
    total: 2,
  },
  getSession: (params: unknown) => details[(params as { id: 'a' | 'b' }).id],
};

describe('CompareView', () => {
  it('asks for two sessions first', async () => {
    renderWithHost(<CompareView />, results);
    expect(await screen.findByText('Choose two sessions to compare.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the two sessions side by side with their measured totals and outcome', async () => {
    renderWithHost(<CompareView />, results);
    const first = await screen.findByLabelText('First session');
    await screen.findAllByRole('option', { name: 'Add retry handling' });
    await userEvent.selectOptions(first, 'a');
    await userEvent.selectOptions(screen.getByLabelText('Second session'), 'b');
    const table = await screen.findByRole('table', { name: 'Session comparison' });
    expect(within(table).getByText('54,000')).toBeInTheDocument();
    expect(within(table).getByText('120,000')).toBeInTheDocument();
    expect(within(table).getByText('4.25')).toBeInTheDocument();
    expect(within(table).getAllByText(/Bug fix: changed 2 files/).length).toBe(2);
    expect(within(table).getAllByText('Exact').length).toBeGreaterThan(0);
  });

  it('says when a session is no longer in the index', async () => {
    renderWithHost(<CompareView />, { ...results, getSession: () => null });
    const first = await screen.findByLabelText('First session');
    await screen.findAllByRole('option', { name: 'Add retry handling' });
    await userEvent.selectOptions(first, 'a');
    await userEvent.selectOptions(screen.getByLabelText('Second session'), 'b');
    expect(await screen.findByText('One of these sessions is no longer in the index.')).toBeInTheDocument();
  });
});
