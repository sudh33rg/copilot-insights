import type { z } from 'zod';
import { coverageDaySchema } from '../../shared/dto';
import { derived, exact, unavailable } from '../../shared/provenance';
import type { Database } from '../storage/database';
import { SOURCES, summed } from './measure';

export type CoverageDay = z.infer<typeof coverageDaySchema>;

const BILLED = 'GitHub billing API: ai_credit/usage (account-wide, all devices)';

export function getCoverage(
  database: Pick<Database, 'db'>,
  billed: readonly { day: string; credits: number }[],
): CoverageDay[] {
  if (billed.length === 0) return [];
  const rows = database.db
    .prepare(
      `SELECT day, sum(credits) AS credit_sum, count(credits) AS credit_known,
              coalesce(sum(model_host <> 'byok'), 0) AS billable
         FROM turns WHERE day IN (SELECT value FROM json_each(:days)) GROUP BY day`,
    )
    .all({ days: JSON.stringify(billed.map((row) => row.day)) }) as unknown as {
    day: string;
    credit_sum: number | null;
    credit_known: number;
    billable: number;
  }[];
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return billed.map(({ day, credits }): CoverageDay => {
    const row = byDay.get(day);
    const local =
      row === undefined
        ? unavailable<number>('no Copilot-hosted turns indexed on this machine for this day')
        : summed(row.credit_sum, row.credit_known, row.billable, SOURCES.credits);
    const localValue = local.value ?? 0;
    const lowerBound = local.provenance.kind === 'derived';
    const exceeds = credits > 0 && localValue > credits + 1e-9;
    return {
      day,
      billed: exact(credits, BILLED),
      local,
      coverage:
        credits > 0
          ? derived(
              localValue / credits,
              exceeds
                ? 'local credits ÷ GitHub billed credits (local credits exceed GitHub billed credits for this day)'
                : 'local credits ÷ GitHub billed credits',
            )
          : unavailable<number>('GitHub billed no credits for this day'),
      unexplained: derived(
        Math.max(0, credits - localValue),
        lowerBound
          ? 'billed − local (upper bound: local credits are a lower bound); other machines, Copilot CLI, github.com or other clients'
          : 'billed − local; other machines, Copilot CLI, github.com or other clients',
      ),
    };
  });
}
