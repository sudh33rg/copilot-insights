import { useQuery } from '@tanstack/react-query';
import type { CommitCostRow, SurvivalByModelRow } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { DataTable, type Column } from '../ui/DataTable';
import { formatCredits, formatDateTime, formatInt, formatPercent } from '../ui/format';
import { Measure } from '../ui/Measure';

const percent = (value: number | string) => formatPercent(Number(value));

const survivalColumns: readonly Column<SurvivalByModelRow>[] = [
  { id: 'model', header: 'Model', cell: (row) => row.model },
  { id: 'edits', header: 'Edits judged', align: 'end', cell: (row) => formatInt(row.edits) },
  {
    id: 'keep',
    header: 'Kept',
    align: 'end',
    cell: (row) => <Measure measure={row.keepRate} format={percent} />,
  },
  {
    id: 'survival',
    header: 'Lines still present later',
    align: 'end',
    cell: (row) => <Measure measure={row.laterSurvival} format={percent} />,
  },
  { id: 'sample', header: 'Checked edits', align: 'end', cell: (row) => formatInt(row.sampleSize) },
];

const commitColumns: readonly Column<CommitCostRow>[] = [
  { id: 'hash', header: 'Commit', cell: (row) => <code>{row.hash.slice(0, 7)}</code> },
  { id: 'when', header: 'Committed', cell: (row) => formatDateTime(row.committedAt) },
  { id: 'sessions', header: 'Sessions', align: 'end', cell: (row) => formatInt(row.sessions) },
  {
    id: 'credits',
    header: 'Credits',
    align: 'end',
    cell: (row) => <Measure measure={row.credits} format={(value) => formatCredits(Number(value))} />,
  },
];

/** Whether Copilot's edits were kept, and whether their lines are still there later, per model. */
export function EditSurvivalCard() {
  const rpc = useRpc();
  const query = useQuery({
    queryKey: ['survivalByModel'],
    queryFn: () => rpc.call('getSurvivalByModel', {}),
  });
  return (
    <section className="card" aria-label="Edit survival by model">
      <h3>Edit survival by model</h3>
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && <p role="alert">Could not load edit survival: {query.error.message}</p>}
      {query.data && (
        <>
          <DataTable
            caption="Edit survival by model"
            columns={survivalColumns}
            rows={query.data.rows}
            rowKey={(row) => row.model}
            empty="No Copilot keep/undo events or survival checks yet."
          />
          <p className="muted">
            Kept = Copilot’s own keep/undo events, credited to the model that made the edit. Survival compares
            fingerprints of the inserted lines an hour, a day and one commit later; it needs VS Code open at
            those times.
          </p>
        </>
      )}
    </section>
  );
}

/** Commits that touched files a session edited, with that session's credits split evenly across them. */
export function CommitsCard() {
  const rpc = useRpc();
  const query = useQuery({ queryKey: ['commitCosts'], queryFn: () => rpc.call('getCommitCosts', {}) });
  return (
    <section className="card" aria-label="Commits">
      <h3>Commits</h3>
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && <p role="alert">Could not load commit costs: {query.error.message}</p>}
      {query.data && (
        <>
          <DataTable
            caption="Commits and their credits"
            columns={commitColumns}
            rows={query.data.rows}
            rowKey={(row) => row.hash}
            empty="No commits have been linked to a session yet."
          />
          <p className="muted">
            A commit is linked when it touches a file a session edited. Each session’s Copilot credits are
            split evenly across its commits; this is an allocation of the session’s own credits, not of
            GitHub’s account totals.
          </p>
        </>
      )}
    </section>
  );
}
