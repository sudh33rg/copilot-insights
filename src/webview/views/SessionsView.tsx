import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { SessionRow } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { Button } from '../ui/Button';
import { DataTable, type Column } from '../ui/DataTable';
import { formatCredits, formatDateTime, formatInt } from '../ui/format';
import { Measure } from '../ui/Measure';
import { useDebounced } from '../ui/useDebounced';

const PAGE_SIZE = 50;

const STATE_LABEL: Record<SessionRow['state'], string> = {
  complete: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
  pending: 'In progress',
  unknown: 'Unknown',
};

const columns: Column<SessionRow>[] = [
  { id: 'time', header: 'Time', cell: (row) => formatDateTime(row.startedAt) },
  {
    id: 'session',
    header: 'Session',
    cell: (row) => (
      <>
        <strong>{row.title ?? row.outcome ?? 'Untitled session'}</strong>
        <div className="muted">
          {row.workspace}
          {row.title !== null && row.outcome !== null ? ` · ${row.outcome}` : ''}
        </div>
      </>
    ),
  },
  { id: 'routing', header: 'Model', cell: (row) => row.routing.label },
  {
    id: 'input',
    header: 'Input tokens',
    align: 'end',
    cell: (row) => <Measure measure={row.inputTokens} format={(value) => formatInt(Number(value))} />,
  },
  {
    id: 'output',
    header: 'Output tokens',
    align: 'end',
    cell: (row) => <Measure measure={row.outputTokens} format={(value) => formatInt(Number(value))} />,
  },
  {
    id: 'credits',
    header: 'Credits',
    align: 'end',
    cell: (row) => <Measure measure={row.credits} format={(value) => formatCredits(Number(value))} />,
  },
  { id: 'turns', header: 'Turns', align: 'end', cell: (row) => formatInt(row.turns) },
  {
    id: 'state',
    header: 'State',
    cell: (row) => (
      <span className={`state state--${row.state}`}>
        {STATE_LABEL[row.state]}
        {row.failedTurns > 0 ? ` · ${String(row.failedTurns)} failed` : ''}
      </span>
    ),
  },
];

export function SessionsView({
  onOpen,
  debounceMs = 250,
}: {
  onOpen: (id: string) => void;
  debounceMs?: number;
}) {
  const rpc = useRpc();
  const [text, setText] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);
  const [workspace, setWorkspace] = useState('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const q = useDebounced(text.trim(), debounceMs);
  const workspaceFilter = useDebounced(workspace.trim(), debounceMs);
  const filtered = q !== '' || failedOnly || workspaceFilter !== '' || fromDay !== '' || toDay !== '';
  const invalidRange = fromDay !== '' && toDay !== '' && fromDay > toDay;

  const list = useInfiniteQuery({
    queryKey: ['sessions', q, failedOnly, workspaceFilter, fromDay, toDay],
    initialPageParam: 0,
    enabled: !invalidRange,
    queryFn: ({ pageParam }) =>
      rpc.call('listSessions', {
        offset: pageParam,
        limit: PAGE_SIZE,
        ...(q !== '' ? { q } : {}),
        ...(failedOnly ? { failedOnly: true } : {}),
        ...(workspaceFilter !== '' ? { workspace: workspaceFilter } : {}),
        ...(fromDay !== '' ? { fromDay } : {}),
        ...(toDay !== '' ? { toDay } : {}),
      }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.rows.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });

  const rows = list.data?.pages.flatMap((page) => page.rows) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  return (
    <section aria-label="Sessions">
      <div className="section-heading">
        <h3>Session history</h3>
        <span className="muted">{total} sessions found</span>
      </div>
      <div className="toolbar" role="search">
        <input
          type="search"
          aria-label="Search sessions"
          placeholder="Search title, workspace, prompt or model"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <label>
          <input
            type="checkbox"
            checked={failedOnly}
            onChange={(event) => {
              setFailedOnly(event.target.checked);
            }}
          />{' '}
          Only sessions with failures
        </label>
        <Button
          onClick={() => {
            void rpc.call('exportData', {});
          }}
        >
          Export…
        </Button>
      </div>
      <details className="filter-panel">
        <summary>Filter by workspace & date</summary>
        <div className="toolbar">
          <label>
            Workspace{' '}
            <input
              type="text"
              value={workspace}
              placeholder="Exact workspace name"
              onChange={(event) => {
                setWorkspace(event.target.value);
              }}
            />
          </label>
          <label>
            From{' '}
            <input
              type="date"
              value={fromDay}
              onChange={(event) => {
                setFromDay(event.target.value);
              }}
            />
          </label>
          <label>
            To{' '}
            <input
              type="date"
              value={toDay}
              onChange={(event) => {
                setToDay(event.target.value);
              }}
            />
          </label>
        </div>
      </details>
      {filtered && (
        <Button
          onClick={() => {
            setText('');
            setFailedOnly(false);
            setWorkspace('');
            setFromDay('');
            setToDay('');
          }}
        >
          Reset filters
        </Button>
      )}
      {invalidRange && <p role="alert">The start date must be on or before the end date.</p>}
      {list.isPending && !invalidRange && <p className="muted">Loading…</p>}
      {list.isError && <p role="alert">Could not load sessions: {list.error.message}</p>}
      {list.data && !invalidRange && (
        <>
          <DataTable
            caption="Sessions"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            onRowActivate={(row) => {
              onOpen(row.id);
            }}
            empty={
              filtered
                ? 'No sessions match your search.'
                : 'No sessions indexed yet. Use Copilot Chat, then refresh.'
            }
          />
          {rows.length > 0 && (
            <p className="muted">
              Showing {rows.length} of {total} sessions
            </p>
          )}
          {list.hasNextPage && (
            <Button
              disabled={list.isFetchingNextPage}
              onClick={() => {
                void list.fetchNextPage();
              }}
            >
              Load more
            </Button>
          )}
        </>
      )}
    </section>
  );
}
