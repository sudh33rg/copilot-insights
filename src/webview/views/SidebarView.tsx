import { useQuery } from '@tanstack/react-query';
import { useRpc } from '../rpcContext';
import { Button } from '../ui/Button';
import { formatCredits, formatInt } from '../ui/format';
import { Measure } from '../ui/Measure';
import { IndexStatus } from './IndexStatus';

export function SidebarView() {
  const rpc = useRpc();
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => rpc.call('getOverview', {}) });
  return (
    <>
      <h1>Copilot Insights</h1>
      {overview.isError && <p role="alert">Could not load the overview: {overview.error.message}</p>}
      {overview.data && (
        <section aria-label="Today">
          <h3>Today</h3>
          <dl className="facts">
            <dt>Input tokens</dt>
            <dd>
              <Measure
                measure={overview.data.today.inputTokens}
                format={(value) => formatInt(Number(value))}
              />
            </dd>
            <dt>Output tokens</dt>
            <dd>
              <Measure
                measure={overview.data.today.outputTokens}
                format={(value) => formatInt(Number(value))}
              />
            </dd>
            <dt>Credits</dt>
            <dd>
              <Measure
                measure={overview.data.today.credits}
                format={(value) => formatCredits(Number(value))}
              />
            </dd>
          </dl>
        </section>
      )}
      <IndexStatus />
      <Button
        variant="primary"
        onClick={() => {
          void rpc.call('openDashboard', {});
        }}
      >
        Open dashboard
      </Button>
    </>
  );
}
