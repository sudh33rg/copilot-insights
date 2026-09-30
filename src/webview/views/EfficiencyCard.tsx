import type { Efficiency } from '../../shared/dto';
import { ProvenanceBadge } from '../ui/Badge';
import { DataTable, type Column } from '../ui/DataTable';
import { formatInt, formatPercent } from '../ui/format';
import { Measure } from '../ui/Measure';

/** Why a session cost what it did, from evidence; estimates are labelled and kept apart from exact numbers. */
export function EfficiencyCard({ efficiency }: { efficiency: Efficiency }) {
  const fresh = freshSessionSentence(efficiency.freshSession);
  return (
    <section className="card" aria-label="Efficiency">
      <h3>Why it cost what it did</h3>
      {efficiency.drivers.length === 0 ? (
        <p className="muted">No cost drivers stood out for this session.</p>
      ) : (
        <ul className="findings">
          {efficiency.drivers.map((driver) => (
            <li key={driver.id}>
              <strong>{driver.title}</strong> <ProvenanceBadge provenance={driver.provenance} />
              <div className="muted">{driver.evidence}</div>
            </li>
          ))}
        </ul>
      )}
      {fresh !== null && (
        <p>
          <span>{fresh}</span>{' '}
          <ProvenanceBadge provenance={efficiency.freshSession?.tokensSaved.provenance ?? UNKNOWN} />
          <span className="muted"> Estimate, not part of the exact totals above.</span>
        </p>
      )}
      {efficiency.priceAlternatives.length > 0 && (
        <>
          <DataTable
            caption="Same tokens on other models (list-price index)"
            columns={priceColumns}
            rows={efficiency.priceAlternatives}
            rowKey={(row) => row.model}
            empty=""
          />
          <p className="muted">Relative list cost of this session’s exact tokens; not a credit figure.</p>
        </>
      )}
      {efficiency.findings.length > 0 && (
        <>
          <h4>Context and model advice</h4>
          <ul className="findings">
            {efficiency.findings.map((finding) => (
              <li key={finding.id}>
                <strong>{finding.message}</strong> <ProvenanceBadge provenance={finding.provenance} />
                <div className="muted">Evidence: {finding.evidence}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const UNKNOWN = { kind: 'unavailable', source: 'no estimate' } as const;

function freshSessionSentence(estimate: Efficiency['freshSession']): string | null {
  if (estimate?.tokensSaved.value == null) return null;
  const share =
    estimate.shareOfInput.value === null
      ? ''
      : ` (${formatPercent(estimate.shareOfInput.value)} of this session’s input)`;
  return `Restarting in a fresh session at turn ${String(estimate.restartAtTurn)} would have saved an estimated ${formatInt(estimate.tokensSaved.value)} input tokens${share}.`;
}

const priceColumns: readonly Column<Efficiency['priceAlternatives'][number]>[] = [
  { id: 'model', header: 'Model', cell: (row) => row.name ?? row.model },
  {
    id: 'cost',
    header: 'List cost vs. what ran',
    align: 'end',
    cell: (row) => (
      <Measure
        measure={row.relativeCost}
        format={(value) => `${String(Number(Number(value).toFixed(2)))}×`}
      />
    ),
  },
];
