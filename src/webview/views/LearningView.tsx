import { useQuery } from '@tanstack/react-query';
import type { BaselineRowDto } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { DataTable, type Column } from '../ui/DataTable';
import { formatCredits, formatInt } from '../ui/format';
import { Measure } from '../ui/Measure';

const VERDICT_LABEL = { typical: 'Typical', high: 'Unusually high', low: 'Unusually low' } as const;

const baselineColumns: readonly Column<BaselineRowDto>[] = [
  { id: 'task', header: 'Task', cell: (row) => row.taskType },
  { id: 'model', header: 'Model', cell: (row) => row.model },
  { id: 'sessions', header: 'Sessions', align: 'end', cell: (row) => formatInt(row.sessions) },
  {
    id: 'input',
    header: 'Median input tokens',
    align: 'end',
    cell: (row) => <Measure measure={row.inputMedian} format={(value) => formatInt(Number(value))} />,
  },
  {
    id: 'credits',
    header: 'Median credits',
    align: 'end',
    cell: (row) => <Measure measure={row.creditsMedian} format={(value) => formatCredits(Number(value))} />,
  },
];

/** What is normal for you, from your own sessions. Small groups say so instead of showing a number. */
export function LearningView({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  return (
    <section aria-label="Learning">
      <Baselines onOpenSession={onOpenSession} />
    </section>
  );
}

function Baselines({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const rpc = useRpc();
  const query = useQuery({ queryKey: ['baselines'], queryFn: () => rpc.call('getBaselines', {}) });
  const data = query.data;
  return (
    <section className="card" aria-label="Baselines">
      <h3>Your baselines</h3>
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && <p role="alert">Could not load baselines: {query.error.message}</p>}
      {data?.rows.length === 0 && (
        <p className="muted">
          Not enough history yet: baselines need at least 5 sessions of the same task type on the same model.
        </p>
      )}
      {data && data.rows.length > 0 && (
        <>
          <DataTable
            caption="Typical usage by task type and model"
            columns={baselineColumns}
            rows={data.rows}
            rowKey={(row) => `${row.taskType}|${row.model}`}
            empty=""
          />
          {data.outliers.length > 0 && (
            <>
              <h4>Unusual sessions</h4>
              <ul className="findings" aria-label="Unusual sessions">
                {data.outliers.map((entry) => (
                  <li key={entry.sessionId}>
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        onOpenSession(entry.sessionId);
                      }}
                    >
                      {entry.title ?? 'Untitled session'}
                    </button>{' '}
                    <Measure
                      measure={{
                        value: entry.verdict.value === null ? null : VERDICT_LABEL[entry.verdict.value],
                        provenance: entry.verdict.provenance,
                      }}
                    />
                    <div className="muted">
                      {entry.taskType} on {entry.model}: {formatInt(entry.thisSession.value ?? 0)} vs median{' '}
                      {formatInt(entry.median.value ?? 0)} input tokens
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
