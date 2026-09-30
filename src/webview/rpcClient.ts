import type { HostEvent, HostToWebview, RpcMethod, RpcParams, RpcResult } from '../shared/protocol';

export interface Transport {
  post(message: unknown): void;
  subscribe(listener: (message: HostToWebview) => void): () => void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class RpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: HostEvent) => void>();

  constructor(private readonly transport: Transport) {
    transport.subscribe((message) => {
      if (message.kind === 'event') {
        for (const listener of this.listeners) listener(message.event);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error));
    });
  }

  call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
    const id = this.nextId++;
    return new Promise<RpcResult<M>>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => {
          resolve(value as RpcResult<M>);
        },
        reject,
      });
      this.transport.post({ kind: 'rpc', id, method, params });
    });
  }

  onEvent(listener: (event: HostEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
