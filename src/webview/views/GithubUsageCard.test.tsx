import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { exactNumber, missing } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { GithubUsageCard } from './GithubUsageCard';

const usage = {
  days: [
    {
      day: '2026-09-29',
      billed: exactNumber(3.5, 'github'),
      local: exactNumber(2.8, 'local'),
      coverage: { value: 0.8, provenance: { kind: 'derived', source: 'local ÷ billed' } },
      unexplained: { value: 0.7, provenance: { kind: 'derived', source: 'billed − local' } },
    },
    {
      day: '2026-09-30',
      billed: exactNumber(1, 'github'),
      local: missing('no local turns'),
      coverage: { value: 0, provenance: { kind: 'derived', source: 'local ÷ billed' } },
      unexplained: { value: 1, provenance: { kind: 'derived', source: 'billed − local' } },
    },
  ],
  lastSyncedAt: 1790000000000,
  account: 'octo',
};

describe('GithubUsageCard', () => {
  it('lists billed credits per day, labelled account-wide and never per session', async () => {
    renderWithHost(<GithubUsageCard />, { getGithubUsage: usage });
    const card = await screen.findByRole('region', { name: 'GitHub billed credits' });
    const table = await within(card).findByRole('table', { name: 'GitHub billed credits by day' });
    expect(within(table).getByText('3.5')).toBeInTheDocument();
    expect(within(table).getByText('80%')).toBeInTheDocument();
    expect(within(table).getByText('0.7')).toBeInTheDocument();
    expect(within(card).getByText(/other machines, Copilot CLI, github\.com/i)).toBeInTheDocument();
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
