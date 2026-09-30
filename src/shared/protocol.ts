import { z } from 'zod';

/** Every RPC method the webview may call. Params are validated in the extension before dispatch. */
export const rpcSchemas = {
  ping: {
    params: z.object({}),
    result: z.object({ version: z.string(), now: z.number() }),
  },
} as const;

export type RpcMethod = keyof typeof rpcSchemas;
export type RpcParams<M extends RpcMethod> = z.infer<(typeof rpcSchemas)[M]['params']>;
export type RpcResult<M extends RpcMethod> = z.infer<(typeof rpcSchemas)[M]['result']>;

export const webviewToHost = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rpc'),
    id: z.number().int().nonnegative(),
    method: z.string(),
    params: z.unknown(),
  }),
  z.object({ kind: z.literal('ready') }),
]);
export type WebviewToHost = z.infer<typeof webviewToHost>;

export interface HostEvent {
  name: 'dataChanged';
}

export type HostToWebview =
  | { kind: 'rpc-result'; id: number; ok: true; result: unknown }
  | { kind: 'rpc-result'; id: number; ok: false; error: string }
  | { kind: 'event'; event: HostEvent };

export function isRpcMethod(name: string): name is RpcMethod {
  return Object.hasOwn(rpcSchemas, name);
}
