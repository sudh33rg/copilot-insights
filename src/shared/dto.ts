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
  taskType: measured(z.string()),
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
  /** The catalog id behind `model` (for price lookups); null when unknown. */
  modelId: z.string().nullable(),
  host: hostSchema,
  inputTokens: measuredNumber,
  outputTokens: measuredNumber,
  credits: measuredNumber,
  cachedTokens: measuredNumber,
  ttftMs: measuredNumber,
  nanoAiu: measuredNumber,
  reasoningMs: measuredNumber,
  toolRounds: measuredNumber,
  toolInputRetries: measuredNumber,
  compactions: measuredNumber,
  /** Largest context size before one of this turn's compactions. */
  contextTokensBefore: measuredNumber,
  /** Share (0–1) of the prompt each category took, as Copilot reported it. */
  promptComposition: z.array(z.object({ category: z.string(), label: z.string(), share: measuredNumber })),
  toolCalls: z.array(z.object({ name: z.string(), status: z.string() })),
  fileEvents: z.array(z.object({ path: z.string(), action: z.string() })),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type TurnDetail = z.infer<typeof turnDetailSchema>;

export const commitCostRowSchema = z.object({
  hash: z.string(),
  committedAt: z.number(),
  /** Sessions linked to this commit. */
  sessions: z.number(),
  credits: measuredNumber,
});
export type CommitCostRow = z.infer<typeof commitCostRowSchema>;

export const outcomesSchema = z.object({
  linesAdded: measuredNumber,
  linesRemoved: measuredNumber,
  editsKept: measuredNumber,
  editsUndone: measuredNumber,
  editsUserModified: measuredNumber,
  /** kept ÷ (kept + undone + user-modified) */
  editKeepRate: measuredNumber,
  /** Fraction (0–1) of Copilot's inserted lines still present at the latest check. */
  laterSurvival: measuredNumber,
  terminalRuns: measuredNumber,
  terminalFailures: measuredNumber,
  testRuns: measuredNumber,
  testFailures: measuredNumber,
  /** Whether the last test run with a known exit code passed. */
  lastTestPassed: measured(z.boolean()),
  /** Change in VS Code error / warning counts over the files this session edited; negative means fewer. */
  errorsDelta: measuredNumber,
  warningsDelta: measuredNumber,
  /** Commits this session is linked to (see linkCommits), with its credits split evenly across them. */
  commits: z.array(
    z.object({
      hash: z.string(),
      committedAt: z.number(),
      overlapFiles: z.number(),
      editedFiles: z.number(),
      credits: measuredNumber,
    }),
  ),
});
export type Outcomes = z.infer<typeof outcomesSchema>;

export const costDriverSchema = z.object({
  id: z.string(),
  title: z.string(),
  evidence: z.string(),
  provenance: provenanceSchema,
});

/** Why the session cost what it did and how to do better; estimates are `inferred` and never summed into totals. */
export const findingSchema = z.object({
  id: z.string(),
  message: z.string(),
  evidence: z.string(),
  provenance: provenanceSchema,
});
export type FindingDto = z.infer<typeof findingSchema>;

export const efficiencySchema = z.object({
  drivers: z.array(costDriverSchema),
  /** Hedged advice about context and model choice, each with its evidence. */
  findings: z.array(findingSchema),
  /** What restarting in a fresh session might have saved; an estimate, never part of the exact totals. */
  freshSession: z
    .object({
      restartAtTurn: z.number(),
      tokensSaved: measuredNumber,
      shareOfInput: measuredNumber,
    })
    .nullable(),
  /** A band made of the measured components shown with it; null when fewer than three have evidence. */
  score: z
    .object({
      band: measured(z.enum(['good', 'fair', 'needs-work'])),
      components: z.array(
        z.object({ id: z.string(), label: z.string(), value: measuredNumber, evidence: z.string() }),
      ),
    })
    .nullable(),
  /** The same exact tokens priced on cheaper catalog models; a list-price ratio, not a credit figure. */
  priceAlternatives: z.array(
    z.object({ model: z.string(), name: z.string().nullable(), relativeCost: measuredNumber }),
  ),
});
export type Efficiency = z.infer<typeof efficiencySchema>;

export const baselineSchema = z.object({
  taskType: z.string(),
  model: z.string(),
  /** How many of your other sessions the comparison rests on. */
  sessions: z.number(),
  verdict: measured(z.enum(['typical', 'high', 'low'])),
  median: measuredNumber,
  typicalLow: measuredNumber,
  typicalHigh: measuredNumber,
  thisSession: measuredNumber,
  message: z.string(),
});
export type Baseline = z.infer<typeof baselineSchema>;

export const baselineRowSchema = z.object({
  taskType: z.string(),
  model: z.string(),
  sessions: z.number(),
  inputMedian: measuredNumber,
  creditsMedian: measuredNumber,
  /** Copilot sessions with exact credits behind `creditsMedian`. */
  creditSessions: z.number(),
});
export type BaselineRowDto = z.infer<typeof baselineRowSchema>;

export const baselinesSchema = z.object({
  rows: z.array(baselineRowSchema),
  outliers: z.array(
    z.object({
      sessionId: z.string(),
      title: z.string().nullable(),
      taskType: z.string(),
      model: z.string(),
      verdict: measured(z.enum(['typical', 'high', 'low'])),
      thisSession: measuredNumber,
      median: measuredNumber,
    }),
  ),
});
export type Baselines = z.infer<typeof baselinesSchema>;

export const leaderboardRowSchema = z.object({
  model: z.string(),
  sessions: z.number(),
  successfulSessions: z.number(),
  /** Successful Copilot sessions with exact credits behind `creditsPerSuccess`. */
  creditSessions: z.number(),
  creditsPerSuccess: measuredNumber,
  correctionsPerSession: measuredNumber,
  editKeepRate: measuredNumber,
  failureRate: measuredNumber,
  ttftMs: measuredNumber,
});
export const leaderboardSchema = z.object({
  groups: z.array(z.object({ taskType: z.string(), rows: z.array(leaderboardRowSchema) })),
});
export type Leaderboard = z.infer<typeof leaderboardSchema>;

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
  outcomes: outcomesSchema,
  efficiency: efficiencySchema,
  /** How this session compares with your own history; set by the query layer, null without enough history. */
  baseline: baselineSchema.nullable(),
  debug: z.object({ calls: z.number(), internalCalls: z.number(), unmatchedCalls: z.number() }).nullable(),
  turns: z.array(turnDetailSchema),
});
export type SessionDetail = z.infer<typeof sessionDetailSchema>;

export const survivalByModelRowSchema = z.object({
  model: z.string(),
  /** Keep/undo/user-modified events attributed to this model (the denominator of keepRate). */
  edits: z.number(),
  keepRate: measuredNumber,
  laterSurvival: measuredNumber,
  /** Edits (session, turn, file) that have a survival check behind laterSurvival. */
  sampleSize: z.number(),
});
export type SurvivalByModelRow = z.infer<typeof survivalByModelRowSchema>;

export const failureRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** User-initiated, finished turns in the group (a count of rows in this index). */
  turns: z.number(),
  failed: z.number(),
  failureRate: measuredNumber,
  toolInputRetries: measuredNumber,
  maxToolCallsExceeded: measuredNumber,
});
export type FailureRow = z.infer<typeof failureRowSchema>;

export const failureAnalyticsSchema = z.object({
  byModel: z.array(failureRowSchema),
  byProvider: z.array(failureRowSchema),
  byMode: z.array(failureRowSchema),
});
export type FailureAnalytics = z.infer<typeof failureAnalyticsSchema>;

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
export const coverageDaySchema = z.object({
  day: z.string(),
  billed: measuredNumber,
  local: measuredNumber,
  coverage: measuredNumber,
  unexplained: measuredNumber,
});
export const githubUsageSchema = z.object({
  days: z.array(coverageDaySchema),
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

// ---- diagnostics ----
export const diagnosticsSchema = z.object({
  versions: z.object({ vscode: z.string(), copilotChat: z.string().nullable(), extension: z.string() }),
  debugLogging: z.boolean(),
  scan: z.object({
    role: z.enum(['leader', 'follower', 'idle']),
    lastSyncAt: z.number().nullable(),
    lastError: z.string().nullable(),
    parseErrors: z.number(),
    badLines: z.number(),
  }),
  index: z.object({ sessions: z.number(), turns: z.number(), invalidRequests: z.number() }),
  drift: z.object({ unknownPartKinds: z.array(z.string()), unknownRequestKeys: z.array(z.string()) }),
  debugLog: z.object({
    sessionsWithLogs: z.number(),
    llmCalls: z.number(),
    unknownDebugNames: z.array(z.object({ name: z.string(), count: z.number() })),
    copilotVersionsSeen: z.array(z.string()),
  }),
  catalog: z.object({ models: z.number(), lastSeenAt: z.number().nullable() }),
});
export type Diagnostics = z.infer<typeof diagnosticsSchema>;
