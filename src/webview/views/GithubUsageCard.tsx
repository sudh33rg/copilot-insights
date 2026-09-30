import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRpc } from '../rpcContext';
import { Button } from '../ui/Button';
import { DataTable } from '../ui/DataTable';
import { formatCredits, formatDateTime } from '../ui/format';
import { Measure } from '../ui/Measure';

export function GithubUsageCard() {
  const rpc = useRpc();
  const queryClient = useQueryClient();
  const usage = useQuery({
    queryKey: ['githubUsage'],
    queryFn: () => rpc.call('getGithubUsage', { days: 14 }),
  });
  const sync = useMutation({
    mutationFn: () => rpc.call('syncGithubUsage', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['githubUsage'] }),
  });
  const message = ((): string | null => {
    if (sync.isError) return `Sync failed: ${sync.error.message}`;
    if (!sync.data) return null;
    if (!sync.data.signedIn) return 'Sign in to GitHub in VS Code to sync.';
    if (sync.data.unavailable) {
      return 'GitHub does not expose usage for this account here. Usage billed to an organization or enterprise is not available.';
    }
    if (sync.data.errors.length > 0)
      return `Synced ${String(sync.data.synced)} days; ${String(sync.data.errors.length)} failed.`;
    return `Synced ${String(sync.data.synced)} days.`;
  })();
  return (
    <section className="card" aria-label="GitHub billed credits">
      <h3>GitHub billed credits</h3>
      <p className="muted">
        Account-wide usage from GitHub billing, covering all devices and clients. It is not attributed to
        individual sessions.
      </p>
      {usage.data && usage.data.days.length > 0 ? (
        <DataTable
          caption="GitHub billed credits by day"
          columns={[
            { id: 'day', header: 'Day', cell: (row) => row.day },
            {
              id: 'credits',
              header: 'Credits',
              align: 'end',
              cell: (row) => (
                <Measure measure={row.credits} format={(value) => formatCredits(Number(value))} />
              ),
            },
          ]}
          rows={usage.data.days}
          rowKey={(row) => row.day}
          empty=""
        />
      ) : (
        usage.data && <p className="muted">Not synced yet.</p>
      )}
      {usage.data?.lastSyncedAt != null && (
        <p className="muted">
          Last synced {formatDateTime(usage.data.lastSyncedAt)}
          {usage.data.account !== null ? ` as ${usage.data.account}` : ''}
        </p>
      )}
      <Button
        disabled={sync.isPending}
        onClick={() => {
          sync.mutate();
        }}
      >
        Sync now
      </Button>
      {message !== null && <p role="status">{message}</p>}
    </section>
  );
}
