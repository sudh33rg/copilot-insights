export type AlertThreshold = 80 | 100;
const THRESHOLDS: readonly AlertThreshold[] = [80, 100];

/** Thresholds the spend has reached that were not alerted yet, in ascending order. */
export function thresholdsToAlert(input: {
  spent: number;
  budget: number;
  alerted: readonly AlertThreshold[];
}): AlertThreshold[] {
  if (!Number.isFinite(input.budget) || input.budget <= 0 || input.spent <= 0) return [];
  return THRESHOLDS.filter(
    (threshold) => input.spent >= (input.budget * threshold) / 100 && !input.alerted.includes(threshold),
  );
}
