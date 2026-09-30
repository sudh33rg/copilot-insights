import { describe, expect, it, vi } from 'vitest';
import type { HostToWebview } from '../shared/protocol';
import { RpcClient, type Transport } from './rpcClient';

function fakeTransport() {
  const sent: unknown[] = [];
  let listener: ((message: HostToWebview) => void) | undefined;
  const transport: Transport = {
    post: (message) => {
      sent.push(message);
    },
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  };
  return { transport, sent, deliver: (message: HostToWebview) => listener?.(message) };
}

describe('RpcClient', () => {
  it('correlates responses by id', async () => {
    const fake = fakeTransport();
    const client = new RpcClient(fake.transport);
    const first = client.call('ping', {});
    const second = client.call('ping', {});
    expect(fake.sent).toEqual([
      { kind: 'rpc', id: 1, method: 'ping', params: {} },
      { kind: 'rpc', id: 2, method: 'ping', params: {} },
    ]);
    fake.deliver({ kind: 'rpc-result', id: 2, ok: true, result: { version: 'b', now: 2 } });
    fake.deliver({ kind: 'rpc-result', id: 1, ok: false, error: 'nope' });
    await expect(second).resolves.toEqual({ version: 'b', now: 2 });
    await expect(first).rejects.toThrow('nope');
  });

  it('delivers host events to subscribers until they unsubscribe', () => {
    const fake = fakeTransport();
    const client = new RpcClient(fake.transport);
    const listener = vi.fn();
    const unsubscribe = client.onEvent(listener);
    fake.deliver({ kind: 'event', event: { name: 'dataChanged' } });
    unsubscribe();
    fake.deliver({ kind: 'event', event: { name: 'dataChanged' } });
    expect(listener).toHaveBeenCalledOnce();
  });
});
