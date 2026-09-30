import type { Efficiency, TurnDetail } from '../../shared/dto';
import { costDrivers } from '../efficiency/costDrivers';

/** Everything that explains a session's cost and how to do better; see docs/superpowers/plans (Phase 5). */
export function getSessionEfficiency(turns: readonly TurnDetail[]): Efficiency {
  return { drivers: costDrivers(turns) };
}
