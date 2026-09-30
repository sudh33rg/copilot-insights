import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { HostToWebview } from '../../shared/protocol';
import { RpcClient, type Transport } from '../rpcClient';
import { RpcProvider } from '../rpcContext';

export interface RpcCall {
  method: string;
  params: unknown;
}

/**
 * A transport whose host answers `rpc` messages from `results` (by method name). A result may be a function
 * of the request params. Methods without an entry reject with "boom". Every request is recorded in `calls`.
 */
export function fakeHost(results: Record<string, unknown>, calls: RpcCall[] = []): Transport {
  let listener: ((message: HostToWebview) => void) | undefined;
  return {
    post: (message) => {
      const request = message as { id: number; method: string; params: unknown };
      calls.push({ method: request.method, params: request.params });
      queueMicrotask(() => {
        if (!Object.hasOwn(results, request.method)) {
          listener?.({ kind: 'rpc-result', id: request.id, ok: false, error: 'boom' });
          return;
        }
        const entry = results[request.method];
        const result =
          typeof entry === 'function' ? (entry as (params: unknown) => unknown)(request.params) : entry;
        listener?.({ kind: 'rpc-result', id: request.id, ok: true, result });
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

/** Renders `ui` against a fake host; `calls` lists every RPC the UI made, in order. */
export function renderWithHost(ui: ReactElement, results: Record<string, unknown>) {
  const calls: RpcCall[] = [];
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RpcProvider client={new RpcClient(fakeHost(results, calls))}>{ui}</RpcProvider>
    </QueryClientProvider>,
  );
  return { ...utils, calls };
}
