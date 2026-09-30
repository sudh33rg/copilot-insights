import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { renderWithHost } from './test/fakeHost';

const renderApp = (results: Record<string, unknown>) => renderWithHost(<App view="dashboard" />, results);

describe('App', () => {
  it('shows how much has been indexed', async () => {
    renderApp({
      listSessions: { rows: [], total: 0 },
      getIndexStatus: {
        sessions: 2,
        turns: 5,
        lastSyncAt: null,
        role: 'leader',
        lastError: null,
        captureLevel: 'summaries',
      },
    });
    const status = await screen.findByLabelText('Index status');
    expect(status).toHaveTextContent('2 sessions · 5 turns indexed');
    expect(status).toHaveTextContent('Capture level: summaries');
  });

  it('explains follower windows and scan errors', async () => {
    renderApp({
      listSessions: { rows: [], total: 0 },
      getIndexStatus: {
        sessions: 0,
        turns: 0,
        lastSyncAt: 1790000000000,
        role: 'follower',
        lastError: 'disk full',
        captureLevel: 'metrics',
      },
    });
    expect(await screen.findByText(/Another VS Code window is indexing/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Last scan failed: disk full');
  });

  it('shows an error when the extension fails', async () => {
    renderApp({});
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]).toHaveTextContent('boom');
  });
});
