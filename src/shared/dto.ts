import { z } from 'zod';

export const provenanceSchema = z.object({
  kind: z.enum(['exact', 'derived', 'inferred', 'unavailable']),
  source: z.string(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/** Wire form of `Measured<T>` from `provenance.ts`. */
export const measured = <T extends z.ZodType>(value: T) =>
  z.object({ value: value.nullable(), provenance: provenanceSchema });

export const measuredNumber = measured(z.number());
export type MeasuredNumber = z.infer<typeof measuredNumber>;

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const turnStateSchema = z.enum(['pending', 'complete', 'cancelled', 'failed', 'unknown']);
export const hostSchema = z.enum(['copilot', 'byok', 'unknown']);
export const routingSchema = z.object({
  kind: z.enum(['auto', 'manual', 'mixed', 'unknown']),
  label: z.string(),
});
export type Routing = z.infer<typeof routingSchema>;

// ---- analysis (filled in by Task 2.3) ----
export const analysisSchema = z.object({
  intent: measured(z.string()),
  outcome: measured(z.string()),
  areas: measured(z.array(z.string())),
  complexity: measured(z.enum(['simple', 'moderate', 'complex'])),
  commandCount: measuredNumber,
  findings: z.array(
    z.object({ id: z.string(), message: z.string(), evidence: z.string(), provenance: provenanceSchema }),
  ),
});
export type Analysis = z.infer<typeof analysisSchema>;

// ---- session list ----
export const sessionListParams = z.object({
  q: z.string().max(200).optional(),
  fromDay: dayString.optional(),
  toDay: dayString.optional(),
  workspace: z.string().max(500).optional(),
  failedOnly: z.boolean().optional(),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(100),
});
export type SessionListParams = z.infer<typeof sessionListParams>;

export const sessionRowSchema = z.object({
  id: z.string(),
  day: z.string(),
  startedAt: z.number(),
  workspace: z.string(),
  title: z.string().nullable(),
  outcome: z.string().nullable(),
  routing: routingSchema,
  state: turnStateSchema,
  turns: z.number(),
  failedTurns: z.number(),
  inputTokens: measuredNumber,
  outputTokens: measuredNumber,
  credits: measuredNumber,
});
export type SessionRow = z.infer<typeof sessionRowSchema>;

export const sessionListSchema = z.object({ rows: z.array(sessionRowSchema), total: z.number() });
export type SessionList = z.infer<typeof sessionListSchema>;

// ---- session detail ----
export const sessionIdParams = z.object({ id: z.string().min(1).max(200) });

/** Tool arguments are deliberately absent: they can contain file contents and secrets. */
export const turnDetailSchema = z.object({
  index: z.number(),
  startedAt: z.number().nullable(),
  state: turnStateSchema,
  systemInitiated: z.boolean(),
  mode: z.string().nullable(),
  userText: z.string().nullable(),
  assistantText: z.string().nullable(),
  routing: routingSchema,
  model: z.string().nullable(),
  host: hostSchema,
  inputTokens: measuredNumber,
  outputTokens: measuredNumber,
  credits: measuredNumber,
  cachedTokens: measuredNumber,
  ttftMs: measuredNumber,
  nanoAiu: measuredNumber,
  reasoningMs: z.number(),
  toolRounds: z.number(),
  compactions: z.number(),
  toolCalls: z.array(z.object({ name: z.string(), status: z.string() })),
  fileEvents: z.array(z.object({ path: z.string(), action: z.string() })),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type TurnDetail = z.infer<typeof turnDetailSchema>;

export const sessionDetailSchema = z.object({
  id: z.string(),
  workspace: z.string(),
  title: z.string().nullable(),
  day: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  activeMs: z.number(),
  captureLevel: z.enum(['metrics', 'summaries', 'full']),
  inputTokens: measuredNumber,
  outputTokens: measuredNumber,
  credits: measuredNumber,
  analysis: analysisSchema.nullable(),
  debug: z.object({ calls: z.number(), internalCalls: z.number(), unmatchedCalls: z.number() }).nullable(),
  turns: z.array(turnDetailSchema),
});
export type SessionDetail = z.infer<typeof sessionDetailSchema>;

// ---- overview ----
export const periodTotalsSchema = z.object({
  from: z.string(),
  to: z.string(),
  sessions: z.number(),
  turns: z.number(),
  inputTokens: measuredNumber,
  outputTokens: measuredNumber,
  credits: measuredNumber,
});
export type PeriodTotals = z.infer<typeof periodTotalsSchema>;

export const breakdownRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  host: hostSchema.nullable(),
  tier: measured(z.string()).nullable(),
  sessions: z.number(),
  turns: z.number(),
  inputTokens: measuredNumber,
  outputTokens: measuredNumber,
  credits: measuredNumber,
});
export type BreakdownRow = z.infer<typeof breakdownRowSchema>;

export const overviewSchema = z.object({
  today: periodTotalsSchema,
  month: periodTotalsSchema,
  failureRate: measuredNumber,
  byModel: z.array(breakdownRowSchema),
  byWorkspace: z.array(breakdownRowSchema),
  hostSplit: z.array(z.object({ host: hostSchema, turns: z.number(), sessions: z.number() })),
  internal: z.object({
    sessionsWithLogs: z.number(),
    calls: z.number(),
    inputTokens: measuredNumber,
    outputTokens: measuredNumber,
    nanoAiu: measuredNumber,
    byName: z.array(
      z.object({
        name: z.string(),
        role: z.enum(['USER_FACING', 'COPILOT_INTERNAL', 'UNKNOWN']),
        calls: z.number(),
        inputTokens: measuredNumber,
      }),
    ),
  }),
});
export type Overview = z.infer<typeof overviewSchema>;

// ---- clearing ----
export const clearScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session'), id: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('sessionContent'), id: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('beforeDay'), day: dayString }),
  z.object({ kind: z.literal('workspace'), workspace: z.string().min(1).max(500) }),
  z.object({ kind: z.literal('everything') }),
  z.object({ kind: z.literal('allContent') }),
]);
export type ClearScope = z.infer<typeof clearScopeSchema>;

// ---- GitHub billed usage ----
export const githubUsageParams = z.object({ days: z.number().int().min(1).max(62) });
export const githubUsageSchema = z.object({
  days: z.array(z.object({ day: z.string(), credits: measuredNumber })),
  lastSyncedAt: z.number().nullable(),
  account: z.string().nullable(),
});
export type GithubUsage = z.infer<typeof githubUsageSchema>;
export const githubSyncSchema = z.object({
  signedIn: z.boolean(),
  synced: z.number(),
  unavailable: z.boolean(),
  errors: z.array(z.string()),
});
export type GithubSync = z.infer<typeof githubSyncSchema>;
