import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { BreakdownRow, SessionRow, TrendDay } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { DataTable, type Column } from '../ui/DataTable';
import { formatCredits, formatInt } from '../ui/format';
import { Measure } from '../ui/Measure';
import { CompareView } from './CompareView';

const RANGES = [7, 30, 90] as const;
const int = (value: number | string) => formatInt(Number(value));
const credits = (value: number | string) => formatCredits(Number(value));

const dayColumns: readonly Column<TrendDay>[] = [
  { id: 'day', header: 'Day', cell: (row) => row.day },
  { id: 'sessions', header: 'Sessions', align: 'end', cell: (row) => formatInt(row.sessions) },
  { id: 'turns', header: 'Turns', align: 'end', cell: (row) => formatInt(row.turns) },
  {
    id: 'input',
    header: 'Input tokens',
    align: 'end',
    cell: (row) => <Measure measure={row.inputTokens} format={int} />,
  },
  {
    id: 'output',
    header: 'Output tokens',
    align: 'end',
    cell: (row) => <Measure measure={row.outputTokens} format={int} />,
  },
  {
    id: 'credits',
    header: 'Credits',
    align: 'end',
    cell: (row) => <Measure measure={row.credits} format={credits} />,
  },
];

const breakdownColumns = (label: string): readonly Column<BreakdownRow>[] => [
  { id: 'group', header: label, cell: (row) => row.label },
  { id: 'sessions', header: 'Sessions', align: 'end', cell: (row) => formatInt(row.sessions) },
  { id: 'turns', header: 'Turns', align: 'end', cell: (row) => formatInt(row.turns) },
  {
    id: 'input',
    header: 'Input tokens',
    align: 'end',
    cell: (row) => <Measure measure={row.inputTokens} format={int} />,
  },
  {
    id: 'output',
    header: 'Output tokens',
    align: 'end',
    cell: (row) => <Measure measure={row.outputTokens} format={int} />,
  },
  {
    id: 'credits',
    header: 'Credits',
    align: 'end',
    cell: (row) => <Measure measure={row.credits} format={credits} />,
  },
];

/** Usage over time: a chart and table per day, per-day session drill-down, range breakdowns and session compare. */
export function AnalyticsView({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const rpc = useRpc();
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const trends = useQuery({
    queryKey: ['trends', range],
    queryFn: () => rpc.call('getTrends', { days: range }),
  });
  const days = trends.data?.days ?? [];
  const first = days[0]?.day;
  const last = days[days.length - 1]?.day;
  const breakdown = useQuery({
    queryKey: ['rangeBreakdown', first, last],
    queryFn: () => rpc.call('getRangeBreakdown', { from: first ?? '', to: last ?? '' }),
    enabled: first !== undefined && last !== undefined,
  });
  const used = days.filter((entry) => entry.turns > 0);

  return (
    <section aria-label="Analytics">
      <div className="toolbar">
        <label>
          Range{' '}
          <select
            value={range}
            onChange={(event) => {
              setRange(Number(event.target.value) as (typeof RANGES)[number]);
              setSelectedDay(null);
            }}
          >
            {RANGES.map((value) => (
              <option key={value} value={value}>
                {`Last ${String(value)} days`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {trends.isPending && <p className="muted">Loading…</p>}
      {trends.isError && <p role="alert">Could not load trends: {trends.error.message}</p>}
      {trends.data && used.length === 0 && <p className="muted">No usage in this range.</p>}
      {trends.data && used.length > 0 && (
        <>
          <CreditsChart days={days} range={range} />
          <DataTable
            caption="Usage by day"
            columns={dayColumns}
            rows={[...days].reverse()}
            rowKey={(row) => row.day}
            onRowActivate={(row) => {
              setSelectedDay(row.day);
            }}
            empty=""
          />
          {selectedDay !== null && <DaySessions day={selectedDay} onOpenSession={onOpenSession} />}
          {breakdown.data && (
            <>
              <h3>By model</h3>
              <DataTable
                caption="Usage by model in this range"
                columns={breakdownColumns('Model')}
                rows={breakdown.data.byModel}
                rowKey={(row) => `${row.key}|${row.host ?? ''}`}
                empty="No model usage in this range."
              />
              <h3>By workspace</h3>
              <DataTable
                caption="Usage by workspace in this range"
                columns={breakdownColumns('Workspace')}
                rows={breakdown.data.byWorkspace}
                rowKey={(row) => row.key}
                empty="No workspace usage in this range."
              />
            </>
          )}
        </>
      )}
      <CompareView />
    </section>
  );
}

/** Dependency-free bar chart; the table below carries the same numbers for anyone who cannot see it. */
function CreditsChart({ days, range }: { days: readonly TrendDay[]; range: number }) {
  const known = days.flatMap((entry) =>
    entry.credits.value === null ? [] : [{ day: entry.day, value: entry.credits.value }],
  );
  const peak = known.reduce(
    (best, entry) => (entry.value > best.value ? entry : best),
    known[0] ?? { day: '', value: 0 },
  );
  if (known.length === 0) return null;
  const width = 600;
  const height = 120;
  const slot = width / days.length;
  const label = `Credits per day over the last ${String(range)} days; highest ${formatCredits(peak.value)} credits on ${peak.day}.`;
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${String(width)} ${String(height)}`} role="img" aria-label={label}>
        {days.map((entry, index) =>
          entry.credits.value === null ? null : (
            <rect
              key={entry.day}
              x={index * slot + slot * 0.1}
              width={slot * 0.8}
              y={height - (peak.value > 0 ? (entry.credits.value / peak.value) * (height - 4) : 0) - 2}
              height={peak.value > 0 ? (entry.credits.value / peak.value) * (height - 4) : 0}
            >
              <title>{`${entry.day}: ${formatCredits(entry.credits.value)} credits`}</title>
            </rect>
          ),
        )}
      </svg>
      <p className="muted">{label}</p>
    </>
  );
}

const sessionColumns: readonly Column<SessionRow>[] = [
  { id: 'session', header: 'Session', cell: (row) => row.title ?? row.outcome ?? 'Untitled session' },
  { id: 'model', header: 'Model', cell: (row) => row.routing.label },
  { id: 'turns', header: 'Turns', align: 'end', cell: (row) => formatInt(row.turns) },
  {
    id: 'credits',
    header: 'Credits',
    align: 'end',
    cell: (row) => <Measure measure={row.credits} format={credits} />,
  },
];

function DaySessions({ day, onOpenSession }: { day: string; onOpenSession: (id: string) => void }) {
  const rpc = useRpc();
  const query = useQuery({
    queryKey: ['daySessions', day],
    queryFn: () => rpc.call('listSessions', { fromDay: day, toDay: day, offset: 0, limit: 50 }),
  });
  return (
    <div>
      <h3>{`Sessions on ${day}`}</h3>
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && <p role="alert">Could not load sessions: {query.error.message}</p>}
      {query.data && (
        <DataTable
          caption={`Sessions on ${day}`}
          columns={sessionColumns}
          rows={query.data.rows}
          rowKey={(row) => row.id}
          onRowActivate={(row) => {
            onOpenSession(row.id);
          }}
          empty="No sessions on this day."
        />
      )}
    </div>
  );
}
