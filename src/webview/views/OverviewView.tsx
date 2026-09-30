import { useQuery } from '@tanstack/react-query';
import type { BreakdownRow, Overview, PeriodTotals } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { DataTable, type Column } from '../ui/DataTable';
import { formatCredits, formatInt, formatPercent } from '../ui/format';
import { Measure } from '../ui/Measure';
import { GithubUsageCard } from './GithubUsageCard';

const HOST_LABEL = { copilot: 'Copilot', byok: 'BYOK / local', unknown: 'Unknown' } as const;
const int = (value: number | string) => formatInt(Number(value));
const credits = (value: number | string) => formatCredits(Number(value));

export function OverviewView() {
  const rpc = useRpc();
  const query = useQuery({ queryKey: ['overview'], queryFn: () => rpc.call('getOverview', {}) });
  return (
    <section aria-label="Overview">
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && <p role="alert">Could not load the overview: {query.error.message}</p>}
      {query.data && <OverviewBody overview={query.data} />}
    </section>
  );
}

function OverviewBody({ overview }: { overview: Overview }) {
  return (
    <>
      <div className="cards">
        <PeriodCard title="Today" totals={overview.today} />
        <PeriodCard title="This month" totals={overview.month} />
      </div>
      <p>
        Failure rate this month:{' '}
        <Measure measure={overview.failureRate} format={(value) => formatPercent(Number(value))} />
      </p>
      {overview.byModel.length === 0 ? (
        <p className="muted">No usage recorded this month yet.</p>
      ) : (
        <>
          <h3>By model</h3>
          <DataTable
            caption="Usage by model"
            columns={modelColumns}
            rows={overview.byModel}
            rowKey={(row) => `${row.key}|${row.host ?? ''}`}
            empty=""
          />
          <h3>By workspace</h3>
          <DataTable
            caption="Usage by workspace"
            columns={workspaceColumns}
            rows={overview.byWorkspace}
            rowKey={(row) => row.key}
            empty=""
          />
          <h3>By host</h3>
          <DataTable
            caption="Usage by host"
            columns={[
              { id: 'host', header: 'Host', cell: (row) => HOST_LABEL[row.host] },
              { id: 'sessions', header: 'Sessions', align: 'end', cell: (row) => formatInt(row.sessions) },
              { id: 'turns', header: 'Turns', align: 'end', cell: (row) => formatInt(row.turns) },
            ]}
            rows={overview.hostSplit}
            rowKey={(row) => row.host}
            empty=""
          />
        </>
      )}
      <GithubUsageCard />
    </>
  );
}

function PeriodCard({ title, totals }: { title: string; totals: PeriodTotals }) {
  return (
    <section className="card" aria-label={title}>
      <h3>{title}</h3>
      <p className="muted">{totals.from === totals.to ? totals.from : `${totals.from} → ${totals.to}`}</p>
      <dl className="facts">
        <dt>Sessions</dt>
        <dd>{formatInt(totals.sessions)}</dd>
        <dt>Turns</dt>
        <dd>{formatInt(totals.turns)}</dd>
        <dt>Input tokens</dt>
        <dd>
          <Measure measure={totals.inputTokens} format={int} />
        </dd>
        <dt>Output tokens</dt>
        <dd>
          <Measure measure={totals.outputTokens} format={int} />
        </dd>
        <dt>Credits</dt>
        <dd>
          <Measure measure={totals.credits} format={credits} />
        </dd>
      </dl>
    </section>
  );
}

const usageColumns: Column<BreakdownRow>[] = [
  { id: 'sessions', header: 'Sessions', align: 'end', cell: (row) => formatInt(row.sessions) },
  { id: 'turns', header: 'Turns', align: 'end', cell: (row) => formatInt(row.turns) },
  {
    id: 'input',
    header: 'Input',
    align: 'end',
    cell: (row) => <Measure measure={row.inputTokens} format={int} />,
  },
  {
    id: 'output',
    header: 'Output',
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
const modelColumns: Column<BreakdownRow>[] = [
  { id: 'model', header: 'Model', cell: (row) => row.label },
  { id: 'host', header: 'Host', cell: (row) => (row.host === null ? '' : HOST_LABEL[row.host]) },
  ...usageColumns,
];
const workspaceColumns: Column<BreakdownRow>[] = [
  { id: 'workspace', header: 'Workspace', cell: (row) => row.label },
  ...usageColumns,
];
