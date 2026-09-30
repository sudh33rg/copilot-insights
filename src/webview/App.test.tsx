import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HostToWebview } from '../shared/protocol';
import { App } from './App';
import { RpcClient, type Transport } from './rpcClient';
import { RpcProvider } from './rpcContext';

export function fakeHost(results: Record<string, unknown>): Transport {
  let listener: ((message: HostToWebview) => void) | undefined;
  return {
    post: (message) => {
      const { id, method } = message as { id: number; method: string };
      queueMicrotask(() => {
        listener?.(
          method in results
            ? { kind: 'rpc-result', id, ok: true, result: results[method] }
            : { kind: 'rpc-result', id, ok: false, error: 'boom' },
        );
      });
    },
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  };
}

export function renderApp(transport: Transport) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RpcProvider client={new RpcClient(transport)}>
        <App view="dashboard" />
      </RpcProvider>
    </QueryClientProvider>,
  );
}

describe('App', () => {
  it('shows how much has been indexed', async () => {
    renderApp(
      fakeHost({
        getIndexStatus: {
          sessions: 2,
          turns: 5,
          lastSyncAt: null,
          role: 'leader',
          lastError: null,
          captureLevel: 'summaries',
        },
      }),
    );
    const status = await screen.findByLabelText('Index status');
    expect(status).toHaveTextContent('2 sessions · 5 turns indexed');
    expect(status).toHaveTextContent('Capture level: summaries');
  });

  it('explains follower windows and scan errors', async () => {
    renderApp(
      fakeHost({
        getIndexStatus: {
          sessions: 0,
          turns: 0,
          lastSyncAt: 1790000000000,
          role: 'follower',
          lastError: 'disk full',
          captureLevel: 'metrics',
        },
      }),
    );
    expect(await screen.findByText(/Another VS Code window is indexing/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Last scan failed: disk full');
  });

  it('shows an error when the extension fails', async () => {
    renderApp(fakeHost({}));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});
