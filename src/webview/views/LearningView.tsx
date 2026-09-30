import { useQuery } from '@tanstack/react-query';
import type { BaselineRowDto, Leaderboard, PromptStyle } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { DataTable, type Column } from '../ui/DataTable';
import { formatCredits, formatDuration, formatInt, formatPercent } from '../ui/format';
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
      <LeaderboardSection />
      <PromptStyleSection />
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

type LeaderRow = Leaderboard['groups'][number]['rows'][number];

const percent = (value: number | string) => formatPercent(Number(value));
const leaderColumns: readonly Column<LeaderRow>[] = [
  { id: 'model', header: 'Model', cell: (row) => row.model },
  { id: 'sessions', header: 'Sessions', align: 'end', cell: (row) => formatInt(row.sessions) },
  {
    id: 'credits',
    header: 'Credits per success',
    align: 'end',
    cell: (row) => (
      <Measure measure={row.creditsPerSuccess} format={(value) => formatCredits(Number(value))} />
    ),
  },
  {
    id: 'corrections',
    header: 'Corrections per session',
    align: 'end',
    cell: (row) => (
      <Measure
        measure={row.correctionsPerSession}
        format={(value) => String(Number(Number(value).toFixed(2)))}
      />
    ),
  },
  {
    id: 'keep',
    header: 'Edits kept',
    align: 'end',
    cell: (row) => <Measure measure={row.editKeepRate} format={percent} />,
  },
  {
    id: 'failure',
    header: 'Failure rate',
    align: 'end',
    cell: (row) => <Measure measure={row.failureRate} format={percent} />,
  },
  {
    id: 'ttft',
    header: 'First token',
    align: 'end',
    cell: (row) => <Measure measure={row.ttftMs} format={(value) => formatDuration(Number(value))} />,
  },
];

/** Which models worked best for you, per task type; every metric needs five sessions behind it. */
function LeaderboardSection() {
  const rpc = useRpc();
  const query = useQuery({ queryKey: ['leaderboard'], queryFn: () => rpc.call('getLeaderboard', {}) });
  const groups = query.data?.groups;
  return (
    <section className="card" aria-label="Model leaderboard">
      <h3>Model leaderboard</h3>
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && <p role="alert">Could not load the leaderboard: {query.error.message}</p>}
      {groups?.length === 0 && <p className="muted">No task type has 5 or more sessions on a model yet.</p>}
      {groups?.map((group) => (
        <DataTable
          key={group.taskType}
          caption={`Best models for ${group.taskType} work`}
          columns={leaderColumns}
          rows={group.rows}
          rowKey={(row) => row.model}
          empty=""
        />
      ))}
      {groups !== undefined && groups.length > 0 && (
        <p className="muted">
          Success means no failed turns, no undone edits and no failed last test run. Metrics need at least
          five sessions behind them; BYOK sessions have no Copilot credits.
        </p>
      )}
    </section>
  );
}

const FEATURE_LABEL: Record<PromptStyle['rows'][number]['feature'], string> = {
  namesFile: 'Opening prompts that name a file',
  statesSuccess: 'Opening prompts that state a success condition',
  statesConstraints: 'Opening prompts that state constraints',
};

/** Do opening-prompt habits go with fewer corrections in your history? A correlation, shown with sample sizes. */
function PromptStyleSection() {
  const rpc = useRpc();
  const query = useQuery({ queryKey: ['promptStyle'], queryFn: () => rpc.call('getPromptStyle', {}) });
  return (
    <section className="card" aria-label="Prompt style">
      <h3>Prompt style</h3>
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && <p role="alert">Could not load prompt style: {query.error.message}</p>}
      {query.data && (
        <>
          <ul className="findings" aria-label="Prompt style comparison">
            {query.data.rows.map((row) => {
              const missing =
                row.withFeature.correctionsPerSession.value === null ||
                row.without.correctionsPerSession.value === null;
              return (
                <li key={row.feature}>
                  <strong>{FEATURE_LABEL[row.feature]}</strong>
                  <div>
                    With: <Measure measure={row.withFeature.correctionsPerSession} format={oneDecimal} />{' '}
                    corrections per session ({formatInt(row.withFeature.sessions)} sessions)
                  </div>
                  <div>
                    Without: <Measure measure={row.without.correctionsPerSession} format={oneDecimal} />{' '}
                    corrections per session ({formatInt(row.without.sessions)} sessions)
                  </div>
                  {missing && (
                    <div className="muted">Not enough data yet: each side needs at least 5 sessions.</div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="muted">
            Correlation from your own history, not proof that the habit causes fewer corrections. Needs stored
            prompt text.
          </p>
        </>
      )}
    </section>
  );
}

const oneDecimal = (value: number | string): string => String(Number(Number(value).toFixed(1)));
