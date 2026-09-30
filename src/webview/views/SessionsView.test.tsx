import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SessionListParams } from '../../shared/dto';
import { missing, sessionRow } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { SessionsView } from './SessionsView';

describe('SessionsView', () => {
  it('shows each session with title, outcome, routing, tokens, credits and state', async () => {
    renderWithHost(<SessionsView onOpen={vi.fn()} debounceMs={0} />, {
      listSessions: { rows: [sessionRow()], total: 1 },
    });
    expect(await screen.findByText('Fix run timeout race')).toBeInTheDocument();
    expect(screen.getByText(/alpha · Changed 2 files/)).toBeInTheDocument();
    expect(screen.getByText('Auto → gpt-5.6-luna')).toBeInTheDocument();
    expect(screen.getByText('54,000')).toBeInTheDocument();
    expect(screen.getByText('2,600')).toBeInTheDocument();
    expect(screen.getByText('1.626')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 1 sessions')).toBeInTheDocument();
  });

  it('shows unavailable credits as a dash with its badge, not zero', async () => {
    renderWithHost(<SessionsView onOpen={vi.fn()} debounceMs={0} />, {
      listSessions: {
        rows: [
          sessionRow({ id: 'b', title: null, outcome: null, credits: missing('BYOK: no Copilot credits') }),
        ],
        total: 1,
      },
    });
    expect(await screen.findByText('Untitled session')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toHaveAttribute(
      'title',
      'Unavailable — BYOK: no Copilot credits',
    );
  });

  it('opens a session from a click or the keyboard', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderWithHost(<SessionsView onOpen={onOpen} debounceMs={0} />, {
      listSessions: { rows: [sessionRow()], total: 1 },
    });
    await user.click(await screen.findByText('Fix run timeout race'));
    expect(onOpen).toHaveBeenCalledWith('fx-auto-1');
    screen.getByText('Fix run timeout race').closest('tr')?.focus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('searches with the typed text and filters failures', async () => {
    const user = userEvent.setup();
    const { calls } = renderWithHost(<SessionsView onOpen={vi.fn()} debounceMs={0} />, {
      listSessions: { rows: [], total: 0 },
    });
    await screen.findByText(/No sessions indexed yet/);
    await user.type(screen.getByRole('searchbox', { name: 'Search sessions' }), 'timeout');
    await waitFor(() => {
      expect(calls.some((call) => (call.params as SessionListParams).q === 'timeout')).toBe(true);
    });
    expect(await screen.findByText('No sessions match your search.')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /failures/ }));
    await waitFor(() => {
      expect(calls.some((call) => (call.params as SessionListParams).failedOnly === true)).toBe(true);
    });
  });

  it('loads the next page on demand', async () => {
    const user = userEvent.setup();
    const { calls } = renderWithHost(<SessionsView onOpen={vi.fn()} debounceMs={0} />, {
      listSessions: (params: SessionListParams) =>
        params.offset === 0
          ? { rows: [sessionRow({ id: 'one', title: 'First' })], total: 2 }
          : { rows: [sessionRow({ id: 'two', title: 'Second' })], total: 2 },
    });
    expect(await screen.findByText('First')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2 sessions')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Second')).toBeInTheDocument();
    expect(calls.map((call) => (call.params as SessionListParams).offset)).toEqual([0, 1]);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows an error when the extension fails', async () => {
    renderWithHost(<SessionsView onOpen={vi.fn()} debounceMs={0} />, {});
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load sessions: boom');
  });

  it('exports through the extension', async () => {
    const { calls } = renderWithHost(<SessionsView onOpen={vi.fn()} debounceMs={0} />, {
      listSessions: { rows: [], total: 0 },
      exportData: { saved: true },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Export…' }));
    expect(calls.map((call) => call.method)).toContain('exportData');
  });
});
