import { z } from 'zod';
import { daysAgo } from '../time';
import { GithubApiError, type GithubClient } from './client';
import type { GithubUsageStore } from './usageStore';

// Lenient: a field of the wrong type becomes undefined instead of failing the whole response.
const lenientNumber = z.number().optional().catch(undefined);
const usageItem = z.looseObject({
  unitType: z.string().optional().catch(undefined),
  grossQuantity: lenientNumber,
  netQuantity: lenientNumber,
  quantity: lenientNumber,
  pricePerUnit: lenientNumber,
  grossAmount: lenientNumber,
});
const usageResponse = z.looseObject({ usageItems: z.array(usageItem).catch([]) });

/** Credits consumed by one billing line: credit-denominated quantity, else dollars at the 1-cent credit price. */
export function creditsOf(item: unknown): number {
  const result = usageItem.safeParse(item);
  if (!result.success) return 0;
  const parsed = result.data;
  if (parsed.unitType !== undefined && /credit/i.test(parsed.unitType)) {
    return parsed.grossQuantity ?? parsed.netQuantity ?? parsed.quantity ?? 0;
  }
  if (parsed.pricePerUnit === 0.01 && parsed.grossAmount !== undefined) return parsed.grossAmount / 0.01;
  return 0;
}

export interface SyncOutcome {
  synced: number;
  unavailable: boolean;
  errors: string[];
}

export interface SyncDeps {
  client: GithubClient;
  user: string;
  store: GithubUsageStore;
  today: string;
  days: number;
  now(): number;
}

/** Fetches the last `days` days of the user's own billed AI credits. Individual billing only. */
export async function syncGithubUsage(deps: SyncDeps): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { synced: 0, unavailable: false, errors: [] };
  for (let offset = deps.days - 1; offset >= 0; offset--) {
    const day = daysAgo(deps.today, offset);
    const [year, month, date] = day.split('-').map(Number);
    const path =
      `/users/${encodeURIComponent(deps.user)}/settings/billing/ai_credit/usage` +
      `?year=${String(year)}&month=${String(month)}&day=${String(date)}`;
    try {
      const body = usageResponse.safeParse(await deps.client.getJson(path));
      const items = body.success ? body.data.usageItems : [];
      const credits = items.reduce((sum, item) => sum + creditsOf(item), 0);
      deps.store.upsert(day, deps.user, credits, deps.now());
      outcome.synced++;
    } catch (error) {
      if (error instanceof GithubApiError && (error.status === 403 || error.status === 404)) {
        // Usage billed to an organization/enterprise is not exposed here; retrying every day would only repeat it.
        outcome.unavailable = true;
        return outcome;
      }
      outcome.errors.push(`${day}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return outcome;
}
