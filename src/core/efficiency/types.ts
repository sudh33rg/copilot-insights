import type { Provenance } from '../../shared/provenance';

/** One fact about why a session cost what it did, with the numbers it rests on. */
export interface CostDriver {
  id: string;
  title: string;
  evidence: string;
  provenance: Provenance;
}

/** A hedged observation with its evidence; never claims a model or prompt was "wrong". */
export interface Finding {
  id: string;
  message: string;
  evidence: string;
  provenance: Provenance;
}
