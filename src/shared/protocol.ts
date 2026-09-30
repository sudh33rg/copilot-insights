import { z } from 'zod';
import {
  clearScopeSchema,
  baselinesSchema,
  commitCostRowSchema,
  diagnosticsSchema,
  failureAnalyticsSchema,
  survivalByModelRowSchema,
  githubSyncSchema,
  githubUsageParams,
  githubUsageSchema,
  overviewSchema,
  sessionDetailSchema,
  sessionIdParams,
  sessionListParams,
  sessionListSchema,
} from './dto';

export const indexStatusSchema = z.object({
  sessions: z.number(),
  turns: z.number(),
  lastSyncAt: z.number().nullable(),
  role: z.enum(['leader', 'follower', 'idle']),
  lastError: z.string().nullable(),
  captureLevel: z.enum(['metrics', 'summaries', 'full']),
});
export type IndexStatus = z.infer<typeof indexStatusSchema>;

/** Every RPC method the webview may call. Params are validated in the extension before dispatch. */
export const rpcSchemas = {
  ping: {
    params: z.object({}),
    result: z.object({ version: z.string(), now: z.number() }),
  },
  getIndexStatus: {
    params: z.object({}),
    result: indexStatusSchema,
  },
  listSessions: { params: sessionListParams, result: sessionListSchema },
  getSession: { params: sessionIdParams, result: sessionDetailSchema.nullable() },
  getOverview: { params: z.object({}), result: overviewSchema },
  openDashboard: { params: z.object({}), result: z.object({ opened: z.boolean() }) },
  clearData: {
    params: z.object({ scope: clearScopeSchema }),
    result: z.object({ confirmed: z.boolean(), sessions: z.number() }),
  },
  exportData: { params: z.object({}), result: z.object({ saved: z.boolean() }) },
  getGithubUsage: { params: githubUsageParams, result: githubUsageSchema },
  syncGithubUsage: { params: z.object({}), result: githubSyncSchema },
  enableDebugLogging: {
    params: z.object({}),
    result: z.object({ outcome: z.enum(['already-enabled', 'declined', 'enabled']) }),
  },
  getDiagnostics: { params: z.object({}), result: diagnosticsSchema },
  getBaselines: { params: z.object({}), result: baselinesSchema },
  getFailureAnalytics: { params: z.object({}), result: failureAnalyticsSchema },
  getCommitCosts: {
    params: z.object({}),
    result: z.object({ rows: z.array(commitCostRowSchema) }),
  },
  getSurvivalByModel: {
    params: z.object({}),
    result: z.object({ rows: z.array(survivalByModelRowSchema) }),
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
