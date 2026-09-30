import { ProvenanceBadge, type ProvenanceKind } from './Badge';
import { formatInt } from './format';

const defaultFormat = (value: number | string): string =>
  typeof value === 'number' ? formatInt(value) : value;

export interface MeasureLike {
  value: number | string | null;
  provenance: { kind: ProvenanceKind; source: string };
}

/** A derived sum over partial data is a floor, not a total; the ≥ keeps it from reading as one. */
const isLowerBound = (measure: MeasureLike): boolean =>
  measure.provenance.kind === 'derived' && measure.provenance.source.includes('lower bound');

export function Measure({
  measure,
  format = defaultFormat,
}: {
  measure: MeasureLike;
  format?: (value: number | string) => string;
}) {
  return (
    <span className="measure">
      <span className="measure__value">
        {measure.value === null ? '—' : `${isLowerBound(measure) ? '≥ ' : ''}${format(measure.value)}`}
      </span>
      <ProvenanceBadge provenance={measure.provenance} />
    </span>
  );
}
