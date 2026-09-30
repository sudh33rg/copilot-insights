import type { Database } from '../storage/database';

export class GithubUsageStore {
  constructor(private readonly database: Pick<Database, 'db'>) {}

  upsert(day: string, account: string, credits: number, syncedAt: number): void {
    this.database.db
      .prepare(
        `INSERT INTO github_daily_usage (day, account, credits, synced_at) VALUES (:day, :account, :credits, :syncedAt)
         ON CONFLICT(day, account) DO UPDATE SET credits = excluded.credits, synced_at = excluded.synced_at`,
      )
      .run({ day, account, credits, syncedAt });
  }

  list(fromDay: string, toDay: string): { day: string; credits: number }[] {
    return this.database.db
      .prepare(
        'SELECT day, credits FROM github_daily_usage WHERE day >= :fromDay AND day <= :toDay ORDER BY day',
      )
      .all({ fromDay, toDay }) as unknown as { day: string; credits: number }[];
  }

  lastSyncedAt(): number | null {
    const row = this.database.db
      .prepare('SELECT max(synced_at) AS at FROM github_daily_usage')
      .get() as unknown as {
      at: number | null;
    };
    return row.at;
  }

  account(): string | null {
    const row = this.database.db
      .prepare('SELECT account FROM github_daily_usage ORDER BY synced_at DESC LIMIT 1')
      .get() as unknown as { account: string } | undefined;
    return row?.account ?? null;
  }
}
