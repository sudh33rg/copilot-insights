import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { TrendDay } from '../../shared/dto';
import { breakdownRow, exactNumber, missing, sessionRow } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { AnalyticsView } from './AnalyticsView';

const day = (date: string, sessions: number, credits: number | null): TrendDay => ({
  day: date,
  sessions,
  turns: sessions * 2,
  inputTokens:
    credits === null ? missing('no usage') : exactNumber(credits * 1000, 'chatSessions.promptTokens'),
  outputTokens:
    credits === null ? missing('no usage') : exactNumber(credits * 100, 'chatSessions.completionTokens'),
  credits: credits === null ? missing('no usage') : exactNumber(credits, 'chatSessions.copilotCredits'),
});
const days = [day('2026-09-20', 0, null), day('2026-09-21', 2, 2.5), day('2026-09-22', 1, 0.5)];

const view = (results: Record<string, unknown> = {}, onOpen: (id: string) => void = () => undefined) =>
  renderWithHost(<AnalyticsView onOpenSession={onOpen} />, {
    getTrends: { days },
    getRangeBreakdown: {
      byModel: [breakdownRow({ key: 'gpt-5.6-luna', label: 'gpt-5.6-luna' })],
      byWorkspace: [],
    },
    listSessions: { rows: [sessionRow({ id: 's-21', title: 'Fix run timeout race' })], total: 1 },
    ...results,
  });

describe('AnalyticsView', () => {
  it('loads additional sessions for a busy day instead of truncating the list', async () => {
    const { calls } = view({
      listSessions: (params: unknown) => {
        const { offset, fromDay } = params as { offset: number; fromDay?: string };
        if (fromDay === undefined) return { rows: [], total: 0 };
        return {
          rows:
            offset === 0
              ? Array.from({ length: 50 }, (_, i) =>
                  sessionRow({ id: `s-${String(i)}`, title: `Session ${String(i)}` }),
                )
              : [sessionRow({ id: 'last', title: 'Last session' })],
          total: 51,
        };
      },
    });
    const table = await screen.findByRole('table', { name: 'Usage by day' });
    await userEvent.click(within(table).getByText('2026-09-21'));
    await userEvent.click(await screen.findByRole('button', { name: 'Load more sessions' }));
    expect(await screen.findByText('Last session')).toBeInTheDocument();
    expect(
      calls.some(
        (call) => call.method === 'listSessions' && (call.params as { offset: number }).offset === 50,
      ),
    ).toBe(true);
  });

  it('draws credits per day as a chart that is described in words, with the peak day named', async () => {
    view();
    const chart = await screen.findByRole('img', {
      name: 'Credits per day over the last 30 days; highest 2.5 credits on 2026-09-21.',
    });
    expect(chart.querySelectorAll('rect')).toHaveLength(2);
    // The same sentence is visible for people who do not hover over the bars.
    expect(
      screen.getByText('Credits per day over the last 30 days; highest 2.5 credits on 2026-09-21.'),
    ).toBeVisible();
  });

  it('lists the days that had usage with exact totals, and leaves the empty days out of the table', async () => {
    view();
    const table = await screen.findByRole('table', { name: 'Usage by day' });
    const busy = within(table).getByText('2026-09-21').closest('tr') as HTMLElement;
    expect(within(busy).getByText('2.5')).toBeInTheDocument();
    expect(within(busy).getByText('2,500')).toBeInTheDocument();
    expect(within(table).queryByText('2026-09-20')).toBeNull();
    expect(
      screen.getByText('Days without usage are not listed. Select a day to see its sessions.'),
    ).toBeInTheDocument();
    expect(screen.getByText('From 2026-09-20 to 2026-09-22.')).toBeInTheDocument();
  });

  it('shows the selected day’s sessions above the day table, where the click happened', async () => {
    view();
    const table = await screen.findByRole('table', { name: 'Usage by day' });
    await userEvent.click(within(table).getByText('2026-09-21'));
    const sessions = await screen.findByRole('table', { name: 'Sessions on 2026-09-21' });
    expect(sessions.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('asks for another range when the selection changes', async () => {
    const { calls } = view();
    await screen.findByRole('table', { name: 'Usage by day' });
    await userEvent.selectOptions(screen.getByLabelText('Range'), '7');
    await screen.findByRole('img', { name: /over the last 7 days/ });
    expect(calls.filter((call) => call.method === 'getTrends').map((call) => call.params)).toEqual([
      { days: 30 },
      { days: 7 },
    ]);
  });

  it('drills into a day to list its sessions, and opens one', async () => {
    const opened: string[] = [];
    const { calls } = view({}, (id) => opened.push(id));
    const table = await screen.findByRole('table', { name: 'Usage by day' });
    await userEvent.click(within(table).getByText('2026-09-21'));
    const sessions = await screen.findByRole('table', { name: 'Sessions on 2026-09-21' });
    expect(
      calls.find((call) => call.method === 'listSessions' && 'fromDay' in (call.params as object))?.params,
    ).toEqual({
      fromDay: '2026-09-21',
      toDay: '2026-09-21',
      offset: 0,
      limit: 50,
    });
    await userEvent.click(within(sessions).getByText('Fix run timeout race'));
    expect(opened).toEqual(['s-21']);
  });

  it('breaks the same range down by model and workspace', async () => {
    const { calls } = view();
    const models = await screen.findByRole('table', { name: 'Usage by model in this range' });
    expect(within(models).getByText('gpt-5.6-luna')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'getRangeBreakdown')?.params).toEqual({
      from: '2026-09-20',
      to: '2026-09-22',
    });
  });

  it('says so when there was no usage, and draws no chart', async () => {
    view({ getTrends: { days: [day('2026-09-20', 0, null), day('2026-09-21', 0, null)] } });
    expect(await screen.findByText('No usage in this range.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('reports a failed query', async () => {
    renderWithHost(<AnalyticsView onOpenSession={() => undefined} />, {});
    expect(await screen.findByText('Could not load trends: boom')).toHaveAttribute('role', 'alert');
  });
});
