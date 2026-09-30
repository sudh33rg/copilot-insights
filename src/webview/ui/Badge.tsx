export type ProvenanceKind = 'exact' | 'derived' | 'inferred' | 'unavailable';

const LABELS: Record<ProvenanceKind, string> = {
  exact: 'Exact',
  derived: 'Derived',
  inferred: 'Inferred',
  unavailable: 'Unavailable',
};

export function ProvenanceBadge({ provenance }: { provenance: { kind: ProvenanceKind; source: string } }) {
  const label = LABELS[provenance.kind];
  return (
    <abbr className={`badge badge--${provenance.kind}`} title={`${label} — ${provenance.source}`}>
      {label}
    </abbr>
  );
}
