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
  it('shows the connected extension version', async () => {
    renderApp(fakeHost({ ping: { version: '9.9.9', now: 1 } }));
    expect(await screen.findByText('Connected to extension v9.9.9')).toBeInTheDocument();
  });

  it('shows an error when the extension fails', async () => {
    renderApp(fakeHost({}));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});
