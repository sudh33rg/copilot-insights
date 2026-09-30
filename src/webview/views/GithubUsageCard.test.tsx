import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { exactNumber } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { GithubUsageCard } from './GithubUsageCard';

const usage = {
  days: [
    { day: '2026-09-29', credits: exactNumber(3.5, 'github') },
    { day: '2026-09-30', credits: exactNumber(1, 'github') },
  ],
  lastSyncedAt: 1790000000000,
  account: 'octo',
};

describe('GithubUsageCard', () => {
  it('lists billed credits per day, labelled account-wide and never per session', async () => {
    renderWithHost(<GithubUsageCard />, { getGithubUsage: usage });
    const card = await screen.findByRole('region', { name: 'GitHub billed credits' });
    expect(await within(card).findByText('3.5')).toBeInTheDocument();
    expect(within(card).getAllByText('Exact').length).toBe(2);
    expect(within(card).getByText(/all devices and clients/)).toBeInTheDocument();
    expect(within(card).getByText(/octo/)).toBeInTheDocument();
  });

  it('invites the first sync when nothing is stored', async () => {
    renderWithHost(<GithubUsageCard />, { getGithubUsage: { days: [], lastSyncedAt: null, account: null } });
    expect(await screen.findByText(/Not synced yet/)).toBeInTheDocument();
  });

  it('syncs on demand and explains each outcome', async () => {
    const user = userEvent.setup();
    const { calls } = renderWithHost(<GithubUsageCard />, {
      getGithubUsage: usage,
      syncGithubUsage: { signedIn: true, synced: 0, unavailable: true, errors: [] },
    });
    await user.click(await screen.findByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText(/billed to an organization or enterprise/)).toBeInTheDocument();
    expect(calls.map((call) => call.method)).toContain('syncGithubUsage');
  });

  it('says so when the user is not signed in', async () => {
    renderWithHost(<GithubUsageCard />, {
      getGithubUsage: usage,
      syncGithubUsage: { signedIn: false, synced: 0, unavailable: false, errors: [] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText('Sign in to GitHub in VS Code to sync.')).toBeInTheDocument();
  });
});
