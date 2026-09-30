import { createContext, useContext, type ReactNode } from 'react';
import type { RpcClient } from './rpcClient';

const RpcContext = createContext<RpcClient | null>(null);

export function RpcProvider({ client, children }: { client: RpcClient; children: ReactNode }) {
  return <RpcContext value={client}>{children}</RpcContext>;
}

export function useRpc(): RpcClient {
  const client = useContext(RpcContext);
  if (client === null) throw new Error('useRpc must be used inside <RpcProvider>');
  return client;
}
