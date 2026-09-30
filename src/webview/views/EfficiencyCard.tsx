import type { Efficiency } from '../../shared/dto';
import { ProvenanceBadge } from '../ui/Badge';

/** Why a session cost what it did, from evidence; estimates are labelled and kept apart from exact numbers. */
export function EfficiencyCard({ efficiency }: { efficiency: Efficiency }) {
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
