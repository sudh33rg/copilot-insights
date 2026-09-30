import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { missing, overview } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { OverviewView } from './OverviewView';

describe('OverviewView', () => {
  it('shows today and month totals with provenance', async () => {
    renderWithHost(<OverviewView />, { getOverview: overview() });
    const today = await screen.findByRole('region', { name: 'Today' });
    expect(within(today).getByText('54,000')).toBeInTheDocument();
    expect(within(today).getByText('1.626')).toBeInTheDocument();
    const month = screen.getByRole('region', { name: 'This month' });
    expect(within(month).getByText('59,000')).toBeInTheDocument();
    expect(within(month).getByText('Derived')).toBeInTheDocument();
    expect(within(month).getByText('2,650')).toBeInTheDocument();
  });

  it('shows the failure rate and the host split', async () => {
    renderWithHost(<OverviewView />, { getOverview: overview() });
    expect(await screen.findByText('33%')).toBeInTheDocument();
    const hosts = screen.getByRole('table', { name: 'Usage by host' });
    expect(within(hosts).getByText('Copilot')).toBeInTheDocument();
    expect(within(hosts).getByText('BYOK / local')).toBeInTheDocument();
  });

  it('lists usage by model and by workspace, with unavailable credits shown as unavailable', async () => {
    renderWithHost(<OverviewView />, { getOverview: overview() });
    const models = await screen.findByRole('table', { name: 'Usage by model' });
    expect(within(models).getByText('gpt-5.6-luna')).toBeInTheDocument();
    expect(within(models).getByText('qwen3.5:35b')).toBeInTheDocument();
    expect(within(models).getByText('Unavailable')).toBeInTheDocument();
    const workspaces = screen.getByRole('table', { name: 'Usage by workspace' });
    expect(within(workspaces).getByText('alpha')).toBeInTheDocument();
  });

  it('shows friendly empty states', async () => {
    renderWithHost(<OverviewView />, {
      getOverview: overview({
        byModel: [],
        byWorkspace: [],
        hostSplit: [],
        failureRate: missing('turns.state'),
      }),
    });
    expect(await screen.findByText('No usage recorded this month yet.')).toBeInTheDocument();
  });

  it('shows an error when the extension fails', async () => {
    renderWithHost(<OverviewView />, {});
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the overview: boom');
  });
});
