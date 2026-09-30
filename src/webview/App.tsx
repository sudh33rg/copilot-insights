import { useQuery } from '@tanstack/react-query';
import { useRpc } from './rpcContext';

export function App({ view }: { view: 'dashboard' | 'sidebar' }) {
  const rpc = useRpc();
  const ping = useQuery({ queryKey: ['ping'], queryFn: () => rpc.call('ping', {}) });
  return (
    <main className={`app app--${view}`}>
      <h1>Copilot Insights</h1>
      {ping.isPending && <p className="muted">Loading…</p>}
      {ping.isError && <p role="alert">Could not reach the extension: {ping.error.message}</p>}
      {ping.data && <p>Connected to extension v{ping.data.version}</p>}
    </main>
  );
}
