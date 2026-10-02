import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState, type KeyboardEvent } from 'react';
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
  const chartTrends = useQuery({
    queryKey: ['trends', 90],
    queryFn: () => rpc.call('getTrends', { days: 90 }),
  });
  const days = trends.data?.days ?? [];
  const chartDays = chartTrends.data?.days ?? [];
  const first = days[0]?.day;
  const last = days[days.length - 1]?.day;
  const breakdown = useQuery({
    queryKey: ['rangeBreakdown', first, last],
    queryFn: () => rpc.call('getRangeBreakdown', { from: first ?? '', to: last ?? '' }),
    enabled: first !== undefined && last !== undefined,
  });
  const used = days.filter((entry) => entry.turns > 0);
  const chartUsed = chartDays.filter((entry) => entry.turns > 0);

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
      {chartTrends.isError && <p role="alert">Could not load activity chart: {chartTrends.error.message}</p>}
      {chartTrends.data && chartUsed.length > 0 && (
        <CreditsChart metric={metric} days={chartDays} range={90} onSelectDay={setSelectedDay} />
      )}
      {trends.data && used.length === 0 && <p className="muted">No usage in this range.</p>}
      {trends.data && used.length > 0 && (
        <>
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

/** Calendar-style activity chart; each day remains a direct, keyboard-accessible drilldown. */
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
  const [chartView, setChartView] = useState<'2d' | '3d'>('3d');
  const unit = metric === 'credits' ? 'credits' : 'tokens';
  const formatValue = metric === 'credits' ? formatCredits : formatInt;
  const known = days.flatMap((entry) =>
    entry[metric].value === null ? [] : [{ day: entry.day, value: entry[metric].value }],
  );
  const peak = known.reduce(
    (best, entry) => (entry.value > best.value ? entry : best),
    known[0] ?? { day: '', value: 0 },
  );
  const firstDay = days[0];
  if (known.length === 0 || firstDay === undefined) return null;
  const firstWeekday = (new Date(`${firstDay.day}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: { day?: TrendDay; key: string }[] = [
    ...Array.from({ length: firstWeekday }, (_, index) => ({ key: `padding-${String(index)}` })),
    ...days.map((day) => ({ day, key: day.day })),
  ];
  const weekCount = Math.ceil(cells.length / 7);
  while (cells.length < weekCount * 7) cells.push({ key: `padding-${String(cells.length)}` });
  const plottedCells = cells.flatMap((cell, index) =>
    cell.day === undefined
      ? []
      : [{ ...cell, day: cell.day, week: Math.floor(index / 7), weekday: index % 7 }],
  );
  plottedCells.sort((left, right) =>
    left.week - left.weekday - (right.week - right.weekday) || left.week - right.week,
  );
  const scaleMax = Math.max(...known.map((entry) => entry.value));
  const turnCount = days.reduce((total, day) => total + day.turns, 0);
  const activeDays = days.filter((day) => day.turns > 0).length;
  const dayName = (day: string) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(`${day}T00:00:00Z`),
    );
  const levelFor = (value: number) =>
    value <= 0 || scaleMax <= 0 ? 0 : Math.min(4, Math.ceil((value / scaleMax) * 4));
  const summary = `${METRIC_LABELS[metric]} per day over the last ${String(range)} days. Highest ${formatValue(peak.value)} ${unit} on ${peak.day}.`;
  const plotWidth = 1000;
  const tileWidth = 32;
  const tileDepth = 18;
  const weekX = 25;
  const weekY = tileDepth / 2;
  const rowX = tileWidth - weekX;
  const rowY = -tileDepth / 2;
  const planeWidth = weekCount * weekX + 7 * rowX;
  const planeHeight = (weekCount + 8) * weekY;
  const isoTop = 80;
  const isoViewHeight = planeHeight + isoTop + 12;
  const isoOffsetX = Math.max(0, (plotWidth - planeWidth) / 2);
  const flatCell = 9;
  const flatGap = 4;
  const flatWidth = weekCount * (flatCell + flatGap) - flatGap;
  const flatOffsetX = (plotWidth - flatWidth) / 2;
  const onCellKeyDown = (event: KeyboardEvent<SVGGElement>, day: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectDay(day);
    }
  };
  return (
    <section className="card chart-card" aria-label={`${METRIC_LABELS[metric]} activity`}>
      <div className="section-heading">
        <div className="chart-activity-count">
          <strong>{formatInt(turnCount)} turns · {formatInt(activeDays)} active days</strong>
          <span className="muted">Independent of the range filter.</span>
        </div>
        <div className="chart-heading-actions">
          <div className="chart-mode-toggle" role="group" aria-label="Chart view">
            {(['2d', '3d'] as const).map((view) => (
              <button
                key={view}
                className={chartView === view ? 'chart-mode is-active' : 'chart-mode'}
                type="button"
                aria-pressed={chartView === view}
                onClick={() => setChartView(view)}
              >
                {view.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
      <svg
        className={`activity-plot activity-plot--${chartView}`}
        viewBox={`0 0 ${String(plotWidth)} ${String(chartView === '3d' ? isoViewHeight : 200)}`}
        role="group"
        aria-label={`${summary} Select a day to see its sessions.`}
      >
        <defs>
          <pattern
            id="activity-unknown-pattern"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="5" height="5" fill="#151d25" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="#46515b" strokeWidth="2" />
          </pattern>
        </defs>
        {chartView === '3d' && (
          <polygon
            className="activity-plane"
            points={[
              `${isoOffsetX},${isoTop + 6 * weekY}`,
              `${isoOffsetX + weekCount * weekX},${isoTop + 6 * weekY + weekCount * weekY}`,
              `${isoOffsetX + weekCount * weekX + 7 * rowX},${isoTop + 6 * weekY + weekCount * weekY + 7 * rowY}`,
              `${isoOffsetX + 7 * rowX},${isoTop + 6 * weekY + 7 * rowY}`,
            ].join(' ')}
          />
        )}
        {plottedCells.map(({ day, key, week, weekday }) => {
          const value = day[metric].value;
          const unavailable = value === null && day.turns > 0;
          const amount = value ?? 0;
          const description = unavailable
            ? `${day.day}, ${dayName(day.day)}: ${METRIC_LABELS[metric].toLowerCase()} unavailable`
            : `${day.day}, ${dayName(day.day)}: ${formatValue(amount)} ${unit}`;
          if (chartView === '2d') {
            const x = flatOffsetX + week * (flatCell + flatGap);
            const y = 20 + weekday * (flatCell + flatGap);
            return (
              <g
                key={key}
                className="activity-day"
                role="button"
                tabIndex={0}
                aria-label={description}
                onClick={() => onSelectDay(day.day)}
                onKeyDown={(event) => onCellKeyDown(event, day.day)}
              >
                <rect
                  className={`activity-cell activity-cell--level-${String(levelFor(amount))}${unavailable ? ' activity-cell--unknown' : ''}`}
                  x={x}
                  y={y}
                  width={flatCell}
                  height={flatCell}
                  rx={2}
                />
                <title>{description}</title>
              </g>
            );
          }
          const x = isoOffsetX + week * weekX + weekday * rowX;
          const y = isoTop + 6 * weekY + week * weekY + weekday * rowY;
          const base = [
            `${x},${y}`,
            `${x + weekX},${y + weekY}`,
            `${x + tileWidth},${y}`,
            `${x + rowX},${y + rowY}`,
          ].join(' ');
          const height =
            value === null || value <= 0 || scaleMax <= 0 ? 0 : Math.max(4, (value / scaleMax) * 50);
          const top = [
            `${x},${y - height}`,
            `${x + weekX},${y + weekY - height}`,
            `${x + tileWidth},${y - height}`,
            `${x + rowX},${y + rowY - height}`,
          ].join(' ');
          const weekFace = [
            `${x},${y}`,
            `${x + weekX},${y + weekY}`,
            `${x + weekX},${y + weekY - height}`,
            `${x},${y - height}`,
          ].join(' ');
          const rowFace = [
            `${x + weekX},${y + weekY}`,
            `${x + tileWidth},${y}`,
            `${x + tileWidth},${y - height}`,
            `${x + weekX},${y + weekY - height}`,
          ].join(' ');
          return (
            <g
              key={key}
              className="activity-day"
              role="button"
              tabIndex={0}
              aria-label={description}
              onClick={() => onSelectDay(day.day)}
              onKeyDown={(event) => onCellKeyDown(event, day.day)}
            >
              <polygon className="activity-floor" points={base} />
              {unavailable && <polygon className="activity-floor activity-floor--unknown" points={base} />}
              {height > 0 && (
                <>
                  <polygon
                    className={`activity-face activity-face--week activity-level-${String(levelFor(amount))}`}
                    points={weekFace}
                  />
                  <polygon
                    className={`activity-face activity-face--row activity-level-${String(levelFor(amount))}`}
                    points={rowFace}
                  />
                  <polygon
                    className={`activity-top activity-level-${String(levelFor(amount))}`}
                    points={top}
                  />
                </>
              )}
              <title>{description}</title>
            </g>
          );
        })}
      </svg>
      <div className="activity-legend" aria-label="Activity amount: less to more">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            className={`activity-legend-swatch activity-legend-swatch--${String(level)}`}
            aria-hidden="true"
          />
        ))}
        <span>More</span>
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
