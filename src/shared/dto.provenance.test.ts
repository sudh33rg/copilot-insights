import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  autoAuditSchema,
  baselinesSchema,
  budgetSchema,
  commitCostRowSchema,
  failureAnalyticsSchema,
  githubUsageSchema,
  leaderboardSchema,
  promptStyleSchema,
  overviewSchema,
  rangeBreakdownSchema,
  sessionDetailSchema,
  sessionListSchema,
  survivalByModelRowSchema,
  trendsSchema,
} from './dto';

interface Def {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  options?: z.ZodType[];
}
const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** Dotted paths of every number in a schema (`[]` marks arrays). Measured values end in `.value`. */
export function numericLeaves(schema: z.ZodType, path = ''): string[] {
  const def = defOf(schema);
  switch (def.type) {
    case 'number':
      return [path];
    case 'object':
      return Object.entries(def.shape ?? {}).flatMap(([key, value]) =>
        numericLeaves(value, path === '' ? key : `${path}.${key}`),
      );
    case 'array':
      return def.element === undefined ? [] : numericLeaves(def.element, `${path}[]`);
    case 'nullable':
    case 'optional':
      return def.innerType === undefined ? [] : numericLeaves(def.innerType, path);
    case 'union':
      return (def.options ?? []).flatMap((option) => numericLeaves(option, path));
    default:
      return [];
  }
}

const unmeasured = (schema: z.ZodType): string[] =>
  numericLeaves(schema)
    .filter((path) => !path.endsWith('.value'))
    .sort();

// Counts of rows in this machine's own index, identifiers' ordinals and timestamps: facts about the index,
// not measurements. Everything else must be a Measured value.
const ALLOWED = {
  sessionList: ['total', 'rows[].failedTurns', 'rows[].startedAt', 'rows[].turns'],
  sessionDetail: [
    'activeMs',
    'debug.calls',
    'debug.internalCalls',
    'debug.unmatchedCalls',
    'efficiency.freshSession.restartAtTurn',
    'baseline.sessions',
    'endedAt',
    'outcomes.commits[].committedAt',
    'outcomes.commits[].editedFiles',
    'outcomes.commits[].overlapFiles',
    'startedAt',
    'turns[].index',
    'turns[].startedAt',
  ],
  overview: [
    'byModel[].sessions',
    'byModel[].turns',
    'byWorkspace[].sessions',
    'byWorkspace[].turns',
    'hostSplit[].sessions',
    'hostSplit[].turns',
    'internal.byName[].calls',
    'internal.calls',
    'internal.sessionsWithLogs',
    'month.sessions',
    'month.turns',
    'today.sessions',
    'today.turns',
  ],
  githubUsage: ['lastSyncedAt'],
  survivalByModel: ['rows[].edits', 'rows[].sampleSize'],
  commitCosts: ['rows[].committedAt', 'rows[].sessions'],
  budget: ['daysElapsed', 'daysInMonth'],
  autoAudit: ['excludedSessions', 'rows[].auto.sessions', 'rows[].manual.sessions'],
  baselines: ['rows[].creditSessions', 'rows[].sessions'],
  trends: ['days[].sessions', 'days[].turns'],
  rangeBreakdown: ['byModel[].sessions', 'byModel[].turns', 'byWorkspace[].sessions', 'byWorkspace[].turns'],
  promptStyle: ['rows[].withFeature.sessions', 'rows[].without.sessions'],
  leaderboard: [
    'groups[].rows[].creditSessions',
    'groups[].rows[].sessions',
    'groups[].rows[].successfulSessions',
  ],
  failureAnalytics: [
    'byMode[].failed',
    'byMode[].turns',
    'byModel[].failed',
    'byModel[].turns',
    'byProvider[].failed',
    'byProvider[].turns',
  ],
} as const;

describe('provenance is enforced on every DTO', () => {
  it.each([
    ['session list', sessionListSchema, ALLOWED.sessionList],
    ['session detail', sessionDetailSchema, ALLOWED.sessionDetail],
    ['overview', overviewSchema, ALLOWED.overview],
    ['github usage', githubUsageSchema, ALLOWED.githubUsage],
    ['survival by model', z.object({ rows: z.array(survivalByModelRowSchema) }), ALLOWED.survivalByModel],
    ['commit costs', z.object({ rows: z.array(commitCostRowSchema) }), ALLOWED.commitCosts],
    ['failure analytics', failureAnalyticsSchema, ALLOWED.failureAnalytics],
    ['baselines', baselinesSchema, ALLOWED.baselines],
    ['budget', budgetSchema, ALLOWED.budget],
    ['trends', trendsSchema, ALLOWED.trends],
    ['range breakdown', rangeBreakdownSchema, ALLOWED.rangeBreakdown],
    ['auto audit', autoAuditSchema, ALLOWED.autoAudit],
    ['leaderboard', leaderboardSchema, ALLOWED.leaderboard],
    ['prompt style', promptStyleSchema, ALLOWED.promptStyle],
  ])('%s has no raw measurement numbers', (_name, schema, allowed) => {
    expect(unmeasured(schema)).toEqual([...allowed].sort());
  });

  it('finds numbers through arrays, nullable and nested objects', () => {
    const schema = z.object({ a: z.number(), b: z.array(z.object({ c: z.number().nullable() })) });
    expect(numericLeaves(schema)).toEqual(['a', 'b[].c']);
  });
});
