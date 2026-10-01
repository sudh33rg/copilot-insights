import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { BreakdownRow, SessionRow, TrendDay } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { DataTable, type Column } from '../ui/DataTable';
import { formatCredits, formatInt } from '../ui/format';
import { Measure } from '../ui/Measure';
import { Button } from '../ui/Button';

type ChartMetric = 'credits' | 'inputTokens' | 'outputTokens';
const METRIC_LABELS = { credits: 'Credits', inputTokens: 'Input tokens', outputTokens: 'Output tokens' };
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
  const [metric, setMetric] = useState<ChartMetric>('credits');
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
        <label>
          Metric{' '}
          <select
            value={metric}
            onChange={(event) => {
              setMetric(event.target.value as ChartMetric);
            }}
          >
            <option value="credits">Credits</option>
            <option value="inputTokens">Input tokens</option>
            <option value="outputTokens">Output tokens</option>
          </select>
        </label>
      </div>
      {trends.isPending && <p className="muted">Loading…</p>}
      {trends.isError && <p role="alert">Could not load trends: {trends.error.message}</p>}
      {trends.data && used.length === 0 && <p className="muted">No usage in this range.</p>}
      {trends.data && used.length > 0 && (
        <>
          <CreditsChart metric={metric} days={days} range={range} onSelectDay={setSelectedDay} />
          <p className="muted">
            {first !== undefined && last !== undefined && <span>{`From ${first} to ${last}.`} </span>}
            <span>Days without usage are not listed. Select a day to see its sessions.</span>
          </p>
          {selectedDay !== null && <DaySessions day={selectedDay} onOpenSession={onOpenSession} />}
          <h3>By day</h3>
          <DataTable
            caption="Usage by day"
            columns={dayColumns}
            rows={[...used].reverse()}
            rowKey={(row) => row.day}
            onRowActivate={(row) => {
              setSelectedDay(row.day);
            }}
            empty=""
          />
          {breakdown.isError && <p role="alert">Could not load range breakdown: {breakdown.error.message}</p>}
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
    </section>
  );
}

/** Dependency-free bar chart; the table below carries the same numbers for anyone who cannot see it. */
function CreditsChart({
  metric,
  days,
  range,
  onSelectDay,
}: {
  metric: ChartMetric;
  days: readonly TrendDay[];
  range: number;
  onSelectDay: (day: string) => void;
}) {
  const unit = metric === 'credits' ? 'credits' : 'tokens';
  const formatValue = metric === 'credits' ? formatCredits : formatInt;
  const known = days.flatMap((entry) =>
    entry[metric].value === null ? [] : [{ day: entry.day, value: entry[metric].value }],
  );
  const peak = known.reduce(
    (best, entry) => (entry.value > best.value ? entry : best),
    known[0] ?? { day: '', value: 0 },
  );
  if (known.length === 0) return null;
  const width = 800;
  const height = 220;
  const plotHeight = 160;
  const left = 48;
  const slot = (width - left - 16) / days.length;
  const label = `${METRIC_LABELS[metric]} per day over the last ${String(range)} days; highest ${formatValue(peak.value)} ${unit} on ${peak.day}.`;
  return (
    <section className="card chart-card" aria-label={`${METRIC_LABELS[metric]} activity`}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Recorded Copilot ${unit}</p>
          <h3>Daily activity</h3>
        </div>
        <span className="muted">
          Peak {formatValue(peak.value)} {unit}
        </span>
      </div>
      <svg className="chart" viewBox={`0 0 ${String(width)} ${String(height)}`} role="img" aria-label={label}>
        {[0, 0.5, 1].map((share) => (
          <g key={share}>
            <line
              className="chart-grid"
              x1={left}
              x2={width - 16}
              y1={plotHeight + 12 - share * plotHeight}
              y2={plotHeight + 12 - share * plotHeight}
            />
            <text
              className="chart-label"
              x={left - 8}
              y={plotHeight + 16 - share * plotHeight}
              textAnchor="end"
            >
              {formatValue(peak.value * share)}
            </text>
          </g>
        ))}
        {days.map((entry, index) =>
          entry[metric].value === null ? null : (
            <rect
              key={entry.day}
              x={left + index * slot + slot * 0.18}
              width={slot * 0.64}
              y={plotHeight + 12 - (peak.value > 0 ? (entry[metric].value / peak.value) * plotHeight : 0)}
              height={peak.value > 0 ? (entry[metric].value / peak.value) * plotHeight : 0}
              rx={3}
              onClick={() => {
                onSelectDay(entry.day);
              }}
            >
              <title>{`${entry.day}: ${formatValue(entry[metric].value)} ${unit}`}</title>
            </rect>
          ),
        )}
        <text className="chart-label" x={left} y={204}>
          {days[0]?.day}
        </text>
        <text className="chart-label" x={width - 16} y={204} textAnchor="end">
          {days[days.length - 1]?.day}
        </text>
      </svg>
      <p className="muted">{label}</p>
      <p className="muted">Gaps can mean no recorded usage. Unavailable usage is not treated as zero.</p>
      <div className="chart-days" aria-label="Explore active days">
        {known
          .filter((entry) => entry.value > 0)
          .map((entry) => (
            <Button
              key={entry.day}
              onClick={() => {
                onSelectDay(entry.day);
              }}
            >
              {entry.day} · {formatValue(entry.value)}
            </Button>
          ))}
      </div>
    </section>
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
  const query = useInfiniteQuery({
    queryKey: ['daySessions', day],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      rpc.call('listSessions', { fromDay: day, toDay: day, offset: pageParam, limit: 50 }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.rows.length, 0);
      return last.rows.length > 0 && loaded < last.total ? loaded : undefined;
    },
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
          rows={query.data.pages.flatMap((page) => page.rows)}
          rowKey={(row) => row.id}
          onRowActivate={(row) => {
            onOpenSession(row.id);
          }}
          empty="No sessions on this day."
        />
      )}
      {query.hasNextPage && (
        <Button
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load more sessions'}
        </Button>
      )}
    </div>
  );
}
