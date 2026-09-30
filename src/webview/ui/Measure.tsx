import { ProvenanceBadge, type ProvenanceKind } from './Badge';
import { formatInt } from './format';

const defaultFormat = (value: number | string): string =>
  typeof value === 'number' ? formatInt(value) : value;

export interface MeasureLike {
  value: number | string | null;
  provenance: { kind: ProvenanceKind; source: string };
}

export function Measure({
  measure,
  format = defaultFormat,
}: {
  measure: MeasureLike;
  format?: (value: number | string) => string;
}) {
  return (
    <span className="measure">
      <span className="measure__value">{measure.value === null ? '—' : format(measure.value)}</span>
      <ProvenanceBadge provenance={measure.provenance} />
    </span>
  );
}
