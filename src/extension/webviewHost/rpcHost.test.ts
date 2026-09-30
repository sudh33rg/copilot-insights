import { describe, expect, it, vi } from 'vitest';
import type { HostToWebview } from '../../shared/protocol';
import { RpcHost, type RpcHandlers } from './rpcHost';

function fakeWebview() {
  const posted: HostToWebview[] = [];
  let listener: ((message: unknown) => void) | undefined;
  return {
    posted,
    async send(message: unknown) {
      listener?.(message);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    webview: {
      postMessage: (message: HostToWebview) => {
        posted.push(message);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (next: (message: unknown) => void) => {
        listener = next;
        return {
          dispose: () => {
            listener = undefined;
          },
        };
      },
    },
  };
}

// Every RPC method needs a handler here; add one when protocol.ts gains a method.
const handlers: RpcHandlers = { ping: () => ({ version: '1.2.3', now: 7 }) };

describe('RpcHost', () => {
  it('answers a valid request', async () => {
    const fake = fakeWebview();
    new RpcHost(fake.webview, handlers);
    await fake.send({ kind: 'rpc', id: 4, method: 'ping', params: {} });
    expect(fake.posted).toEqual([
      { kind: 'rpc-result', id: 4, ok: true, result: { version: '1.2.3', now: 7 } },
    ]);
  });

  it('rejects unknown methods and invalid params', async () => {
    const fake = fakeWebview();
    new RpcHost(fake.webview, handlers);
    await fake.send({ kind: 'rpc', id: 1, method: 'dropTables', params: {} });
    await fake.send({ kind: 'rpc', id: 2, method: 'ping', params: 'x' });
    expect(fake.posted).toEqual([
      { kind: 'rpc-result', id: 1, ok: false, error: 'Unknown method: dropTables' },
      { kind: 'rpc-result', id: 2, ok: false, error: 'Invalid params for ping' },
    ]);
  });

  it('reports handler failures without crashing', async () => {
    const fake = fakeWebview();
    const onError = vi.fn();
    new RpcHost(fake.webview, { ...handlers, ping: () => Promise.reject(new Error('boom')) }, onError);
    await fake.send({ kind: 'rpc', id: 3, method: 'ping', params: {} });
    expect(fake.posted).toEqual([{ kind: 'rpc-result', id: 3, ok: false, error: 'boom' }]);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('ignores malformed messages and emits events', async () => {
    const fake = fakeWebview();
    const host = new RpcHost(fake.webview, handlers);
    await fake.send({ nonsense: true });
    host.emit({ name: 'dataChanged' });
    expect(fake.posted).toEqual([{ kind: 'event', event: { name: 'dataChanged' } }]);
  });

  it('stops listening after dispose', async () => {
    const fake = fakeWebview();
    new RpcHost(fake.webview, handlers).dispose();
    await fake.send({ kind: 'rpc', id: 5, method: 'ping', params: {} });
    expect(fake.posted).toEqual([]);
  });
});
