/** How much a value can be trusted. See docs/PRODUCT_VISION.md §7. */
export type ProvenanceKind = 'exact' | 'derived' | 'inferred' | 'unavailable';

/** Where a value came from; `source` names the concrete field or rule, e.g. "chatSessions.copilotCredits". */
export interface Provenance {
  readonly kind: ProvenanceKind;
  readonly source: string;
}

export interface Measured<T> {
  readonly value: T | null;
  readonly provenance: Provenance;
}

export const exact = <T>(value: T, source: string): Measured<T> => ({
  value,
  provenance: { kind: 'exact', source },
});
export const derived = <T>(value: T, source: string): Measured<T> => ({
  value,
  provenance: { kind: 'derived', source },
});
export const inferred = <T>(value: T, source: string): Measured<T> => ({
  value,
  provenance: { kind: 'inferred', source },
});
export const unavailable = <T>(source: string): Measured<T> => ({
  value: null,
  provenance: { kind: 'unavailable', source },
});

const STRENGTH: Record<ProvenanceKind, number> = { exact: 3, derived: 2, inferred: 1, unavailable: 0 };

/** Combining values keeps the weakest provenance so estimates never masquerade as exact telemetry. */
export function weakest(...kinds: readonly ProvenanceKind[]): ProvenanceKind {
  let result: ProvenanceKind | null = null;
  for (const kind of kinds) {
    if (result === null || STRENGTH[kind] < STRENGTH[result]) result = kind;
  }
  return result ?? 'unavailable';
}

/** Sums known values. A sum that skipped unavailable items is a lower bound, so it is at most `derived`. */
export function sumMeasured(items: readonly Measured<number>[], source: string): Measured<number> {
  const known = items.filter((item): item is Measured<number> & { value: number } => item.value !== null);
  if (known.length === 0) return unavailable(source);
  const kinds = known.map((item) => item.provenance.kind);
  const kind = known.length < items.length ? weakest('derived', ...kinds) : weakest(...kinds);
  return { value: known.reduce((sum, item) => sum + item.value, 0), provenance: { kind, source } };
}
