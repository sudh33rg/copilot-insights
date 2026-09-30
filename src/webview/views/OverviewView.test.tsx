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
    expect(within(month).getByText('≥ 59,000')).toBeInTheDocument();
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
    // qwen has neither a Copilot credit figure nor a catalog tier.
    expect(within(models).getAllByText('Unavailable')).toHaveLength(2);
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

  it('shows utility calls Copilot made on its own, as a lower bound, with names', async () => {
    renderWithHost(<OverviewView />, { getOverview: overview() });
    const card = await screen.findByRole('region', { name: 'Copilot internal calls' });
    expect(within(card).getByText(/only sessions with agent debug logging/i)).toBeInTheDocument();
    expect(within(card).getByRole('table', { name: 'Requests by name' })).toBeInTheDocument();
    expect(within(card).getByText('title')).toBeInTheDocument();
    expect(within(card).getByText('Not classified')).toBeInTheDocument();
  });

  it('says so when no debug logs exist', async () => {
    renderWithHost(<OverviewView />, {
      getOverview: overview({
        internal: {
          sessionsWithLogs: 0,
          calls: 0,
          inputTokens: missing('agent debug log'),
          outputTokens: missing('agent debug log'),
          nanoAiu: missing('agent debug log'),
          byName: [],
        },
      }),
    });
    expect(await screen.findByText(/No agent debug logs found/)).toBeInTheDocument();
  });

  it('shows the catalog tier of each model', async () => {
    renderWithHost(<OverviewView />, { getOverview: overview() });
    const models = await screen.findByRole('table', { name: 'Usage by model' });
    expect(within(models).getByText('powerful')).toBeInTheDocument();
    expect(within(models).getByText('Tier')).toBeInTheDocument();
  });

  describe('outcome evidence', () => {
    const derivedNumber = (value: number, source = 'test') => ({
      value,
      provenance: { kind: 'derived' as const, source },
    });
    const survival = {
      rows: [
        {
          model: 'gpt-5.6-luna',
          edits: 8,
          keepRate: derivedNumber(0.75),
          laterSurvival: derivedNumber(0.9),
          sampleSize: 5,
        },
        {
          model: 'qwen3.5:35b',
          edits: 2,
          keepRate: derivedNumber(0.5),
          laterSurvival: missing('no check yet'),
          sampleSize: 0,
        },
      ],
    };
    const commits = {
      rows: [
        {
          hash: 'abc1234def5678abc1234def5678abc1234def56',
          committedAt: 1790000000000,
          sessions: 2,
          credits: derivedNumber(3.5),
        },
      ],
    };

    it('shows keep rate and later survival per model, with provenance', async () => {
      renderWithHost(<OverviewView />, {
        getOverview: overview(),
        getSurvivalByModel: survival,
        getCommitCosts: commits,
      });
      const table = await screen.findByRole('table', { name: 'Edit survival by model' });
      expect(within(table).getByText('gpt-5.6-luna')).toBeInTheDocument();
      expect(within(table).getByText('75%')).toBeInTheDocument();
      expect(within(table).getByText('90%')).toBeInTheDocument();
      expect(within(table).getByText('8')).toBeInTheDocument();
      // A model with no survival check yet shows as unavailable, never as 0%.
      expect(within(table).getByText('Unavailable')).toBeInTheDocument();
      expect(within(table).queryByText('0%')).toBeNull();
    });

    it('lists commits by short hash with their credits and linked sessions', async () => {
      renderWithHost(<OverviewView />, {
        getOverview: overview(),
        getSurvivalByModel: survival,
        getCommitCosts: commits,
      });
      const table = await screen.findByRole('table', { name: 'Commits and their credits' });
      expect(within(table).getByText('abc1234')).toBeInTheDocument();
      expect(within(table).getByText('3.5')).toBeInTheDocument();
      expect(within(table).getByText('2')).toBeInTheDocument();
      expect(within(table).queryByText(/abc1234def/)).toBeNull();
    });

    it('explains empty states', async () => {
      renderWithHost(<OverviewView />, {
        getOverview: overview(),
        getSurvivalByModel: { rows: [] },
        getCommitCosts: { rows: [] },
      });
      expect(
        await screen.findByText(/No Copilot keep\/undo events or survival checks yet/),
      ).toBeInTheDocument();
      expect(screen.getByText(/No commits have been linked to a session yet/)).toBeInTheDocument();
    });

    it('still shows the overview when the outcome queries fail', async () => {
      renderWithHost(<OverviewView />, { getOverview: overview() });
      expect(await screen.findByRole('region', { name: 'Today' })).toBeInTheDocument();
      expect(await screen.findByText(/Could not load edit survival/)).toBeInTheDocument();
      expect(screen.getByText(/Could not load commit costs/)).toBeInTheDocument();
    });
  });
});
