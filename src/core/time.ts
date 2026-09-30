/** Local calendar day (YYYY-MM-DD) for a timestamp, in the machine's current time zone. */
export function localDay(ms: number = Date.now()): string {
  const date = new Date(ms);
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day `count` days before `day` (negative moves forward). UTC noon keeps DST from skipping a day. */
export function daysAgo(day: string, count: number): string {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

/** First day to keep for a retention window; sessions with an earlier day are purged. Null disables retention. */
export function retentionCutoff(retentionDays: number, today: string): string | null {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return null;
  return daysAgo(today, retentionDays);
}

function parseDay(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError(`Invalid day: ${day}`);
  return new Date(`${day}T12:00:00Z`);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
