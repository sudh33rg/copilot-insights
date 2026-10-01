import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { SessionDetail } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { formatCredits, formatDuration, formatInt } from '../ui/format';
import { Measure } from '../ui/Measure';

const int = (value: number | string) => formatInt(Number(value));

const BAND_LABEL = { good: 'Good', fair: 'Fair', 'needs-work': 'Needs work' } as const;

/** Two sessions side by side; every number is the same measured value the session page shows. */
export function CompareView() {
  const rpc = useRpc();
  const [firstId, setFirstId] = useState('');
  const [secondId, setSecondId] = useState('');
  const list = useQuery({
    queryKey: ['compareChoices'],
    queryFn: () => rpc.call('listSessions', { offset: 0, limit: 100 }),
  });
  const ready = firstId !== '' && secondId !== '';
  const pair = useQuery({
    queryKey: ['comparePair', firstId, secondId],
    queryFn: () =>
      Promise.all([rpc.call('getSession', { id: firstId }), rpc.call('getSession', { id: secondId })]),
    enabled: ready,
  });
  const rows = list.data?.rows ?? [];
  const select = (label: string, value: string, onChange: (id: string) => void) => (
    <label>
      {label}{' '}
      <select
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        <option value="">Choose…</option>
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.title ?? row.outcome ?? 'Untitled session'}
          </option>
        ))}
      </select>
    </label>
  );
  const sessions = pair.data;
  return (
    <section className="card" aria-label="Compare sessions">
      <h3>Compare sessions</h3>
      <p className="muted">
        Choose sessions with comparable tasks. Differences describe recorded evidence; they do not establish a
        model quality ranking.
      </p>
      {list.isPending && <p className="muted">Loading session choices…</p>}
      {list.isError && <p role="alert">Could not load session choices: {list.error.message}</p>}
      {ready && pair.isPending && <p className="muted">Loading comparison…</p>}
      <div className="toolbar">
        {select('First session', firstId, setFirstId)}
        {select('Second session', secondId, setSecondId)}
      </div>
      {!ready && <p className="muted">Choose two sessions to compare.</p>}
      {pair.isError && <p role="alert">Could not load the sessions: {pair.error.message}</p>}
      {ready && sessions !== undefined && (sessions[0] === null || sessions[1] === null) && (
        <p className="muted">One of these sessions is no longer in the index.</p>
      )}
      {sessions?.[0] != null && sessions[1] != null && <ComparisonTable a={sessions[0]} b={sessions[1]} />}
    </section>
  );
}

function ComparisonTable({ a, b }: { a: SessionDetail; b: SessionDetail }) {
  const row = (label: string, cell: (session: SessionDetail) => React.ReactNode) => (
    <tr>
      <th scope="row">{label}</th>
      <td>{cell(a)}</td>
      <td>{cell(b)}</td>
    </tr>
  );
  return (
    <div className="table-scroll" role="region" aria-label="Session comparison" tabIndex={0}>
      <table className="table" aria-label="Session comparison">
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col">{a.title ?? 'Untitled session'}</th>
            <th scope="col">{b.title ?? 'Untitled session'}</th>
          </tr>
        </thead>
        <tbody>
          {row('Workspace', (s) => s.workspace)}
          {row('Initial prompt', (s) => (
            <pre className="text compare-prompt">
              {s.turns.find((t) => !t.systemInitiated)?.userText ?? 'Not recorded or explicitly cleared'}
            </pre>
          ))}
          {row('Models', (s) => [...new Set(s.turns.map((t) => t.model ?? 'Unknown'))].join(', '))}
          {row('Active time', (s) => (
            <Measure
              measure={{
                value: s.activeMs,
                provenance: { kind: 'derived', source: 'sum of recorded turn elapsed times' },
              }}
              format={(value) => formatDuration(Number(value))}
            />
          ))}
          {row(
            'Tools',
            (s) =>
              [...new Set(s.turns.flatMap((t) => t.toolCalls.map((c) => c.name)))].join(', ') ||
              'No recorded calls',
          )}
          {row('Context references', (s) => (
            <ul className="files">
              {[...new Set(s.turns.flatMap((t) => t.fileEvents.map((f) => f.path)))].map((path) => (
                <li key={path}>
                  <code>{path}</code>
                </li>
              ))}
            </ul>
          ))}
          {row('Context payloads', (s) => (
            <>
              {s.turns.flatMap((t) =>
                (t.contextItems ?? []).map((item, i) => (
                  <details key={`${t.index}-${i}`}>
                    <summary>
                      Turn {t.index} · {item.name}
                    </summary>
                    <pre className="text">{item.content}</pre>
                  </details>
                )),
              )}
              {s.promptArtifacts?.map((item, i) => (
                <details key={`artifact-${i}`}>
                  <summary>{item.name}</summary>
                  <pre className="text">{item.content}</pre>
                </details>
              ))}
            </>
          ))}
          {row('Final response', (s) => (
            <details>
              <summary>Inspect recorded response</summary>
              <pre className="text compare-prompt">
                {s.turns.at(-1)?.assistantText ?? 'Not recorded or explicitly cleared'}
              </pre>
            </details>
          ))}
          {row('Turns', (s) => formatInt(s.turns.length))}
          {row('Input tokens', (s) => (
            <Measure measure={s.inputTokens} format={int} />
          ))}
          {row('Output tokens', (s) => (
            <Measure measure={s.outputTokens} format={int} />
          ))}
          {row('Credits', (s) => (
            <Measure measure={s.credits} format={(value) => formatCredits(Number(value))} />
          ))}
          {row('Task type', (s) => (s.analysis === null ? '—' : <Measure measure={s.analysis.taskType} />))}
          {row('Outcome', (s) => (s.analysis === null ? '—' : <Measure measure={s.analysis.outcome} />))}
          {row('Efficiency', (s) =>
            s.efficiency.score === null ? (
              '—'
            ) : (
              <Measure
                measure={{
                  value:
                    s.efficiency.score.band.value === null ? null : BAND_LABEL[s.efficiency.score.band.value],
                  provenance: s.efficiency.score.band.provenance,
                }}
              />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
