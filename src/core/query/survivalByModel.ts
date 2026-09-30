import type { SurvivalByModelRow } from '../../shared/dto';
import { derived, unavailable } from '../../shared/provenance';
import { attributeEditOutcomes } from '../outcomes/editOutcomes';
import type { Database } from '../storage/database';
import { groupBy } from './measure';

const KEEP_SOURCE = 'Copilot editedFileEvents, attributed to the model that made the edit';
const SURVIVAL_SOURCE = 'fingerprints of inserted lines still present at the latest check';

interface Tally {
  kept: number;
  outcomes: number;
  present: number;
  total: number;
  sample: number;
}

/** Keep rate and later survival per model. Only models with at least one outcome event or survival check appear. */
export function getSurvivalByModel(database: Pick<Database, 'db'>): SurvivalByModelRow[] {
  const { db } = database;
  const turns = db
    .prepare(
      'SELECT session_id, idx, COALESCE(resolved_model, requested_model) AS model FROM turns ORDER BY session_id, idx',
    )
    .all() as unknown as { session_id: string; idx: number; model: string | null }[];
  const events = db
    .prepare('SELECT session_id, turn_idx, path, action FROM file_events ORDER BY session_id, turn_idx, seq')
    .all() as unknown as { session_id: string; turn_idx: number; path: string; action: string }[];
  const checks = db
    .prepare(
      `SELECT c.session_id, c.turn_idx, c.present, c.total FROM survival_checks c
        WHERE c.total > 0 AND c.checked_at = (
          SELECT MAX(d.checked_at) FROM survival_checks d
           WHERE d.session_id = c.session_id AND d.turn_idx = c.turn_idx AND d.path = c.path)`,
    )
    .all() as unknown as { session_id: string; turn_idx: number; present: number; total: number }[];

  const modelOf = new Map(turns.map((turn) => [`${turn.session_id}\0${String(turn.idx)}`, turn.model]));
  const tallies = new Map<string, Tally>();
  const tally = (model: string): Tally => {
    let entry = tallies.get(model);
    if (entry === undefined) {
      entry = { kept: 0, outcomes: 0, present: 0, total: 0, sample: 0 };
      tallies.set(model, entry);
    }
    return entry;
  };

  const eventsBySession = groupBy(events, (event) => event.session_id);
  const turnsBySession = groupBy(turns, (turn) => turn.session_id);
  for (const [sessionId, sessionEvents] of eventsBySession) {
    const attributed = attributeEditOutcomes(
      (turnsBySession.get(sessionId) ?? []).map((turn) => ({
        index: turn.idx,
        model: turn.model,
        fileEvents: sessionEvents.filter((event) => event.turn_idx === turn.idx),
      })),
    );
    for (const outcome of attributed) {
      if (outcome.model === null) continue;
      const entry = tally(outcome.model);
      entry.outcomes++;
      if (outcome.outcome === 'kept') entry.kept++;
    }
  }
  for (const check of checks) {
    const model = modelOf.get(`${check.session_id}\0${String(check.turn_idx)}`);
    if (model === null || model === undefined) continue;
    const entry = tally(model);
    entry.present += check.present;
    entry.total += check.total;
    entry.sample++;
  }

  return [...tallies]
    .map(([model, entry]): SurvivalByModelRow => ({
      model,
      edits: entry.outcomes,
      keepRate:
        entry.outcomes === 0
          ? unavailable('no keep/undo events reported by Copilot for this model')
          : derived(entry.kept / entry.outcomes, KEEP_SOURCE),
      laterSurvival:
        entry.total === 0
          ? unavailable('no survival check has run for this model’s edits yet')
          : derived(entry.present / entry.total, SURVIVAL_SOURCE),
      sampleSize: entry.sample,
    }))
    .sort((a, b) => b.edits - a.edits || a.model.localeCompare(b.model));
}
