import { useQuery } from '@tanstack/react-query';
import type { BreakdownRow, Overview, PeriodTotals } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { DataTable, type Column } from '../ui/DataTable';
import { formatCredits, formatInt, formatPercent } from '../ui/format';
import { Measure } from '../ui/Measure';
import { FailureAnalyticsCard } from './FailureAnalyticsCard';
import { GithubUsageCard } from './GithubUsageCard';
import { CommitsCard, EditSurvivalCard } from './OutcomeOverview';

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
      <EditSurvivalCard />
      <CommitsCard />
      <FailureAnalyticsCard />
      <InternalCard internal={overview.internal} />
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
  { id: 'tier', header: 'Tier', cell: (row) => (row.tier === null ? '' : <Measure measure={row.tier} />) },
  ...usageColumns,
];
const workspaceColumns: Column<BreakdownRow>[] = [
  { id: 'workspace', header: 'Workspace', cell: (row) => row.label },
  ...usageColumns,
];

const ROLE_LABEL = {
  USER_FACING: 'Your requests',
  COPILOT_INTERNAL: 'Copilot internal',
  UNKNOWN: 'Not classified',
} as const;

function InternalCard({ internal }: { internal: Overview['internal'] }) {
  return (
    <section className="card" aria-label="Copilot internal calls">
      <h3>Copilot internal calls</h3>
      {internal.sessionsWithLogs === 0 ? (
        <p className="muted">
          No agent debug logs found. Enable “Copilot Insights: Enable Exact Telemetry…” to see the utility
          requests (titles, summaries, …) Copilot makes on its own.
        </p>
      ) : (
        <>
          <p className="muted">
            Utility requests Copilot made itself, this month. Totals cover only sessions with agent debug
            logging, so they are lower bounds.
          </p>
          <dl className="facts">
            <dt>Calls</dt>
            <dd>{formatInt(internal.calls)}</dd>
            <dt>Input tokens</dt>
            <dd>
              <Measure measure={internal.inputTokens} format={int} />
            </dd>
            <dt>Output tokens</dt>
            <dd>
              <Measure measure={internal.outputTokens} format={int} />
            </dd>
            <dt>Usage (nano-AIU)</dt>
            <dd>
              <Measure measure={internal.nanoAiu} format={int} />
            </dd>
          </dl>
          <DataTable
            caption="Requests by name"
            columns={[
              { id: 'name', header: 'debugName', cell: (row) => row.name },
              { id: 'role', header: 'Kind', cell: (row) => ROLE_LABEL[row.role] },
              { id: 'calls', header: 'Calls', align: 'end', cell: (row) => formatInt(row.calls) },
              {
                id: 'input',
                header: 'Input',
                align: 'end',
                cell: (row) => <Measure measure={row.inputTokens} format={int} />,
              },
            ]}
            rows={internal.byName}
            rowKey={(row) => `${row.name}|${row.role}`}
            empty="No calls this month."
          />
        </>
      )}
    </section>
  );
}
