import { useQuery } from '@tanstack/react-query';
import type { IndexStatus } from '../shared/protocol';
import { useRpc } from './rpcContext';

export function App({ view }: { view: 'dashboard' | 'sidebar' }) {
  const rpc = useRpc();
  const status = useQuery({ queryKey: ['indexStatus'], queryFn: () => rpc.call('getIndexStatus', {}) });
  return (
    <main className={`app app--${view}`}>
      <h1>Copilot Insights</h1>
      {status.isPending && <p className="muted">Loading…</p>}
      {status.isError && <p role="alert">Could not reach the extension: {status.error.message}</p>}
      {status.data && <IndexStatusSummary status={status.data} />}
    </main>
  );
}

function IndexStatusSummary({ status }: { status: IndexStatus }) {
  return (
    <section aria-label="Index status">
      <p>
        <strong>{status.sessions}</strong> sessions · <strong>{status.turns}</strong> turns indexed
      </p>
      <p className="muted">
        Capture level: {status.captureLevel}
        {status.lastSyncAt !== null && ` · last scan ${new Date(status.lastSyncAt).toLocaleString()}`}
      </p>
      {status.role === 'follower' && (
        <p className="muted">
          Another VS Code window is indexing Copilot sessions; showing the shared index.
        </p>
      )}
      {status.lastError !== null && <p role="alert">Last scan failed: {status.lastError}</p>}
    </section>
  );
}
