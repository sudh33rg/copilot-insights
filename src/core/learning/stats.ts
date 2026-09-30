/** Fewest sessions a statistic may rest on before it is shown (D-P6-1). */
export const MIN_SAMPLE = 5;
const SCALED_MAD = 1.4826;
const OUTLIER_SPREADS = 3;
const OUTLIER_RATIO = 1.5;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  if (upper === undefined) return null;
  return sorted.length % 2 === 1 || lower === undefined ? upper : (lower + upper) / 2;
}

/** Median absolute deviation: a spread that one extreme session cannot distort. */
export function mad(values: readonly number[]): number | null {
  const center = median(values);
  return center === null ? null : median(values.map((value) => Math.abs(value - center)));
}

/** Medians of the lower and upper halves (the middle value is left out for odd counts). */
export function quartiles(values: readonly number[]): { q1: number; q3: number } | null {
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  const q1 = median(sorted.slice(0, half));
  const q3 = median(sorted.slice(sorted.length - half));
  return q1 === null || q3 === null ? null : { q1, q3 };
}

/**
 * D-P6-2: an outlier is more than three scaled MADs from the median and at least 1.5× (or at most ⅔ of) it. With
 * no spread at all only the ratio rule applies. Fewer than `MIN_SAMPLE` values, or a zero median, flag nothing.
 */
export function isOutlier(value: number, values: readonly number[]): 'high' | 'low' | null {
  if (values.length < MIN_SAMPLE) return null;
  const center = median(values);
  const spread = mad(values);
  if (center === null || spread === null || center <= 0) return null;
  const farEnough = spread === 0 || Math.abs(value - center) > OUTLIER_SPREADS * SCALED_MAD * spread;
  if (!farEnough) return null;
  if (value >= center * OUTLIER_RATIO) return 'high';
  if (value <= (center * 2) / 3) return 'low';
  return null;
}

export const notEnough = (n: number): string =>
  `not enough data: ${String(n)} of ${String(MIN_SAMPLE)} sessions`;
