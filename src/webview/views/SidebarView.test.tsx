import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { overview } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { SidebarView } from './SidebarView';

const status = {
  sessions: 2,
  turns: 4,
  lastSyncAt: null,
  role: 'leader',
  lastError: null,
  captureLevel: 'summaries',
};

describe('SidebarView', () => {
  it("summarizes today's usage and index status", async () => {
    renderWithHost(<SidebarView />, { getOverview: overview(), getIndexStatus: status });
    expect(await screen.findByText('54,000')).toBeInTheDocument();
    expect(screen.getByText('1.626')).toBeInTheDocument();
    expect(await screen.findByLabelText('Index status')).toHaveTextContent('2 sessions · 4 turns indexed');
  });

  it('opens the dashboard', async () => {
    const { calls } = renderWithHost(<SidebarView />, {
      getOverview: overview(),
      getIndexStatus: status,
      openDashboard: { opened: true },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Open dashboard' }));
    expect(calls.map((call) => call.method)).toContain('openDashboard');
  });
});
