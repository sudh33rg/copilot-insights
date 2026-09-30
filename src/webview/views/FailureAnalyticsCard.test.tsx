import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FailureAnalytics, FailureRow } from '../../shared/dto';
import { exactNumber } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { FailureAnalyticsCard } from './FailureAnalyticsCard';

const row = (key: string, turns: number, failed: number, label = key): FailureRow => ({
  key,
  label,
  turns,
  failed,
  failureRate: { value: failed / turns, provenance: { kind: 'derived', source: 'turn state' } },
  toolInputRetries: exactNumber(2, 'chatSessions toolCallRounds'),
  maxToolCallsExceeded: exactNumber(1, 'chatSessions toolCallRounds'),
});
const analytics: FailureAnalytics = {
  byModel: [row('qwen3.5:35b', 4, 1, 'qwen3.5:35b'), row('gpt-5.6-luna', 2, 0)],
  byProvider: [row('ollama', 4, 1), row('Copilot', 2, 0)],
  byMode: [row('ask', 4, 1), row('agent', 2, 0)],
};

describe('FailureAnalyticsCard', () => {
  it('shows failure rates with provenance by model, provider and mode', async () => {
    renderWithHost(<FailureAnalyticsCard />, { getFailureAnalytics: analytics });
    const card = await screen.findByRole('region', { name: 'Failures' });
    const models = await within(card).findByRole('table', { name: 'Failures by model' });
    expect(within(models).getByText('qwen3.5:35b')).toBeInTheDocument();
    expect(within(models).getByText('25%')).toBeInTheDocument();
    expect(within(models).getAllByText('Derived').length).toBeGreaterThan(0);
    expect(within(models).getAllByText('Exact').length).toBeGreaterThan(0);
    expect(within(card).getByRole('heading', { name: 'By model' })).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'By provider' })).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'By mode' })).toBeInTheDocument();
    expect(within(models).getByRole('columnheader', { name: 'Model' })).toBeInTheDocument();
    expect(
      within(within(card).getByRole('table', { name: 'Failures by provider' })).getByRole('columnheader', {
        name: 'Provider',
      }),
    ).toBeInTheDocument();
    expect(within(card).getByRole('table', { name: 'Failures by provider' })).toBeInTheDocument();
    expect(within(card).getByRole('table', { name: 'Failures by mode' })).toBeInTheDocument();
  });

  it('explains an empty index', async () => {
    renderWithHost(<FailureAnalyticsCard />, {
      getFailureAnalytics: { byModel: [], byProvider: [], byMode: [] },
    });
    expect(await screen.findByText('No finished turns yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('reports a failed query without breaking the page', async () => {
    renderWithHost(<FailureAnalyticsCard />, {});
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load failure analytics: boom');
  });
});
