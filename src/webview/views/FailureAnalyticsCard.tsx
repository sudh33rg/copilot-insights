import { useQuery } from '@tanstack/react-query';
import type { FailureRow } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { DataTable, type Column } from '../ui/DataTable';
import { formatInt, formatPercent } from '../ui/format';
import { Measure } from '../ui/Measure';

const columns: readonly Column<FailureRow>[] = [
  { id: 'group', header: 'Group', cell: (row) => row.label },
  { id: 'turns', header: 'Turns', align: 'end', cell: (row) => formatInt(row.turns) },
  { id: 'failed', header: 'Failed', align: 'end', cell: (row) => formatInt(row.failed) },
  {
    id: 'rate',
    header: 'Failure rate',
    align: 'end',
    cell: (row) => <Measure measure={row.failureRate} format={(value) => formatPercent(Number(value))} />,
  },
  {
    id: 'retries',
    header: 'Tool-input retries',
    align: 'end',
    cell: (row) => <Measure measure={row.toolInputRetries} />,
  },
  {
    id: 'exceeded',
    header: 'Hit tool-call limit',
    align: 'end',
    cell: (row) => <Measure measure={row.maxToolCallsExceeded} />,
  },
];

/** Where turns fail: by model, provider and mode, over everything indexed. */
export function FailureAnalyticsCard() {
  const rpc = useRpc();
  const query = useQuery({
    queryKey: ['failureAnalytics'],
    queryFn: () => rpc.call('getFailureAnalytics', {}),
  });
  const data = query.data;
  const empty = data?.byModel.length === 0;
  return (
    <section className="card" aria-label="Failures">
      <h3>Failures</h3>
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && <p role="alert">Could not load failure analytics: {query.error.message}</p>}
      {empty && <p className="muted">No finished turns yet.</p>}
      {data && !empty && (
        <>
          <DataTable
            caption="Failures by model"
            columns={columns}
            rows={data.byModel}
            rowKey={(row) => row.key}
            empty=""
          />
          <DataTable
            caption="Failures by provider"
            columns={columns}
            rows={data.byProvider}
            rowKey={(row) => row.key}
            empty=""
          />
          <DataTable
            caption="Failures by mode"
            columns={columns}
            rows={data.byMode}
            rowKey={(row) => row.key}
            empty=""
          />
          <p className="muted">
            Finished, user-initiated turns across everything indexed; cancelled and system-initiated turns are
            left out.
          </p>
        </>
      )}
    </section>
  );
}
