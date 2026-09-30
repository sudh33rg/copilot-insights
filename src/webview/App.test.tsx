import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { diagnostics, overview, sessionDetail, sessionRow } from './test/dtoFixtures';
import { renderWithHost } from './test/fakeHost';

const status = (overrides: Record<string, unknown> = {}) => ({
  sessions: 2,
  turns: 5,
  lastSyncAt: null,
  role: 'leader',
  lastError: null,
  captureLevel: 'summaries',
  ...overrides,
});

const renderDashboard = (results: Record<string, unknown>) =>
  renderWithHost(<App view="dashboard" />, {
    getOverview: overview(),
    listSessions: { rows: [], total: 0 },
    ...results,
  });

describe('App', () => {
  it('shows how much has been indexed', async () => {
    renderDashboard({ getIndexStatus: status() });
    const indexStatus = await screen.findByLabelText('Index status');
    expect(indexStatus).toHaveTextContent('2 sessions · 5 turns indexed');
    expect(indexStatus).toHaveTextContent('Capture level: summaries');
  });

  it('explains follower windows and scan errors', async () => {
    renderDashboard({
      getIndexStatus: status({
        sessions: 0,
        turns: 0,
        lastSyncAt: 1790000000000,
        role: 'follower',
        lastError: 'disk full',
        captureLevel: 'metrics',
      }),
    });
    expect(await screen.findByText(/Another VS Code window is indexing/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Last scan failed: disk full');
  });

  it('shows an error when the extension fails', async () => {
    renderWithHost(<App view="dashboard" />, {});
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]).toHaveTextContent('boom');
  });

  it('opens on the overview and switches to sessions', async () => {
    renderDashboard({ getIndexStatus: status() });
    expect(await screen.findByRole('region', { name: 'Today' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(await screen.findByRole('region', { name: 'Sessions' })).toBeInTheDocument();
  });

  it('opens a session from the list and returns to it', async () => {
    renderDashboard({
      getIndexStatus: status(),
      listSessions: { rows: [sessionRow()], total: 1 },
      getSession: sessionDetail(),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Sessions' }));
    await userEvent.click(await screen.findByText('Fix run timeout race'));
    expect(await screen.findByRole('heading', { name: 'Fix run timeout race' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '← Sessions' }));
    expect(await screen.findByRole('table', { name: 'Sessions' })).toBeInTheDocument();
  });

  it('renders the compact summary in the sidebar', async () => {
    renderWithHost(<App view="sidebar" />, { getOverview: overview(), getIndexStatus: status() });
    expect(await screen.findByRole('button', { name: 'Open dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Copilot Insights' })).toBeInTheDocument();
  });

  it('opens the diagnostics tab', async () => {
    renderDashboard({ getIndexStatus: status(), getDiagnostics: diagnostics() });
    await userEvent.click(await screen.findByRole('button', { name: 'Diagnostics' }));
    expect(await screen.findByRole('region', { name: 'Environment' })).toBeInTheDocument();
  });

  it('has a Learning tab', async () => {
    renderDashboard({ getIndexStatus: status(), getBaselines: { rows: [], outliers: [] } });
    await userEvent.click(await screen.findByRole('button', { name: 'Learning' }));
    expect(await screen.findByRole('region', { name: 'Learning' })).toBeInTheDocument();
  });

  it('has an Analytics tab and can open a session from it', async () => {
    renderDashboard({
      getIndexStatus: status(),
      getTrends: { days: [] },
      getRangeBreakdown: { byModel: [], byWorkspace: [] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Analytics' }));
    expect(await screen.findByRole('region', { name: 'Analytics' })).toBeInTheDocument();
    expect(await screen.findByText('No usage in this range.')).toBeInTheDocument();
  });
});
