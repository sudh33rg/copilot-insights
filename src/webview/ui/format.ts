const INT = new Intl.NumberFormat('en-US');

export function formatInt(value: number): string {
  return INT.format(value);
}

export function formatCredits(value: number): string {
  return String(Number(value.toFixed(3)));
}

export function formatPercent(ratio: number): string {
  return `${String(Math.round(ratio * 100))}%`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${String(Number(seconds.toFixed(1)))} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(Math.round(seconds - minutes * 60))}s`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h ${String(minutes - hours * 60)}m`;
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString();
}
