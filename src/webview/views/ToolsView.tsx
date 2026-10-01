import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useRpc } from '../rpcContext';
import { Button } from '../ui/Button';
import { DataTable } from '../ui/DataTable';
import { useDebounced } from '../ui/useDebounced';
import { SessionsView } from './SessionsView';

export function ToolsView({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const rpc = useRpc();
  const [workspace, setWorkspace] = useState('');
  const [model, setModel] = useState('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [tool, setTool] = useState<string | null>(null);
  const filters = useMemo(
    () => ({
      offset: 0,
      limit: 100,
      ...(workspace ? { workspace } : {}),
      ...(model ? { model } : {}),
      ...(fromDay ? { fromDay } : {}),
      ...(toDay ? { toDay } : {}),
    }),
    [workspace, model, fromDay, toDay],
  );
  const params = useDebounced(filters, 250);
  const invalidRange = fromDay !== '' && toDay !== '' && fromDay > toDay;
  const query = useQuery({
    queryKey: ['toolAnalytics', params],
    queryFn: () => rpc.call('getToolAnalytics', params),
    enabled: !invalidRange,
  });
  return (
    <section aria-label="Tools and failures">
      <div className="toolbar">
        <label>
          Workspace{' '}
          <input
            maxLength={500}
            value={workspace}
            onChange={(e) => {
              setWorkspace(e.target.value);
            }}
            placeholder="Exact workspace"
          />
        </label>
        <label>
          Model{' '}
          <input
            maxLength={200}
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
            }}
          />
        </label>
        <label>
          From{' '}
          <input
            type="date"
            value={fromDay}
            onChange={(e) => {
              setFromDay(e.target.value);
            }}
          />
        </label>
        <label>
          To{' '}
          <input
            type="date"
            value={toDay}
            onChange={(e) => {
              setToDay(e.target.value);
            }}
          />
        </label>
      </div>
      {invalidRange && <p role="alert">From must be before To.</p>}
      <p className="notice">
        Call counts and completion labels come from recorded events. Unknown outcomes stay unknown. A failed
        turn does not establish which tool failed. Tool durations are unavailable in these sources.
      </p>
      {query.isPending && !invalidRange && <p>Loading tool activity…</p>}
      {query.isError && <p role="alert">Could not load tool activity: {query.error.message}</p>}
      {query.data && !invalidRange && (
        <>
          <dl className="metric-grid">
            <div>
              <dt>Recorded calls</dt>
              <dd>{query.data.tools.reduce((n, row) => n + row.calls, 0)}</dd>
            </div>
            <div>
              <dt>Distinct tools</dt>
              <dd>{query.data.tools.length}</dd>
            </div>
            <div>
              <dt>Unknown outcomes</dt>
              <dd>{query.data.tools.reduce((n, row) => n + row.unknown, 0)}</dd>
            </div>
          </dl>
          <DataTable
            caption="Tool activity"
            rowKey={(row) => row.name}
            rows={query.data.tools}
            columns={[
              {
                id: 'name',
                header: 'Tool',
                cell: (row) => (
                  <Button
                    onClick={() => {
                      setTool(row.name);
                    }}
                  >
                    {row.name} →
                  </Button>
                ),
              },
              ...(['calls', 'sessions', 'complete', 'incomplete', 'unknown'] as const).map((key) => ({
                id: key,
                header:
                  key === 'complete'
                    ? 'Recorded complete'
                    : key === 'incomplete'
                      ? 'Recorded incomplete'
                      : key.slice(0, 1).toUpperCase() + key.slice(1),
                align: 'end' as const,
                cell: (row: NonNullable<typeof query.data>['tools'][number]) => row[key],
              })),
            ]}
            empty="No recorded tools in this scope."
          />
          <h3>Failed turns by recorded error</h3>
          <DataTable
            caption="Recorded turn failures"
            rowKey={(row) => row.code ?? 'unknown'}
            rows={query.data.failures}
            columns={[
              { id: 'code', header: 'Error', cell: (row) => row.code ?? 'Code not recorded' },
              { id: 'turns', header: 'Turns', cell: (row) => row.turns },
              { id: 'sessions', header: 'Sessions', cell: (row) => row.sessions },
            ]}
            empty="No failed turns in this scope."
          />
        </>
      )}
      {tool !== null && (
        <section className="card">
          <div className="section-heading">
            <h3>Sessions using {tool}</h3>
            <Button
              onClick={() => {
                setTool(null);
              }}
            >
              Close tool sessions
            </Button>
          </div>
          <SessionsView
            key={`${tool}-${JSON.stringify(params)}`}
            initialFilters={{ ...params, tool }}
            onOpen={onOpenSession}
          />
        </section>
      )}
    </section>
  );
}
