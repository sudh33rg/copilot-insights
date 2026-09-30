import type { HostToWebview } from '../shared/protocol';
import type { Transport } from './rpcClient';

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export function createVsCodeTransport(): Transport {
  const api = acquireVsCodeApi();
  return {
    post: (message) => {
      api.postMessage(message);
    },
    subscribe: (listener) => {
      const handler = (event: MessageEvent<HostToWebview>): void => {
        listener(event.data);
      };
      window.addEventListener('message', handler);
      return () => {
        window.removeEventListener('message', handler);
      };
    },
  };
}
