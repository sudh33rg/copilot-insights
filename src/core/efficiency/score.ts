import type { Outcomes, TurnDetail } from '../../shared/dto';
import { weakest, type Provenance } from '../../shared/provenance';
import { summarizeChanges } from '../analysis/changes';
import { CORRECTION } from '../analysis/findings';

export interface ScoreComponent {
  id: string;
  label: string;
  /** 0–1, higher is better. */
  value: number;
  evidence: string;
  provenance: Provenance;
}

export type ScoreBand = 'good' | 'fair' | 'needs-work';

export interface EfficiencyScore {
  band: ScoreBand;
  components: ScoreComponent[];
  provenance: Provenance;
}

const MIN_COMPONENTS = 3;
const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
const derivedFrom = (source: string): Provenance => ({ kind: 'derived', source });

/**
 * A band made of visible components (D-P5-5): each component states its number and evidence, the band is their
 * plain average, and with fewer than three components with evidence there is no score at all.
 */
export function efficiencyScore(input: {
  turns: readonly TurnDetail[];
  outcomes: Outcomes;
}): EfficiencyScore | null {
  const components = [
    firstPass(input.turns),
    editKeep(input.outcomes),
    tests(input.outcomes),
    toolReliability(input.turns),
    contextDiscipline(input.turns),
  ].filter((component): component is ScoreComponent => component !== null);
  if (components.length < MIN_COMPONENTS) return null;
  const mean = sum(components.map((component) => component.value)) / components.length;
  return {
    band: mean >= 0.75 ? 'good' : mean >= 0.5 ? 'fair' : 'needs-work',
    components,
    provenance: {
      kind: weakest(...components.map((component) => component.provenance.kind)),
      source: 'unweighted average of the components shown',
    },
  };
}

function firstPass(turns: readonly TurnDetail[]): ScoreComponent | null {
  const userTurns = turns.filter((turn) => !turn.systemInitiated);
  if (userTurns.length === 0) return null;
  const hasText = userTurns.some((turn) => (turn.userText ?? '').trim() !== '');
  const corrections = userTurns.slice(1).filter((turn) => CORRECTION.test(turn.userText ?? '')).length;
  const undone = summarizeChanges(turns).undone;
  const failed = userTurns.filter((turn) => turn.state === 'failed').length;
  const trouble = corrections + undone + failed;
  const parts = [
    hasText ? plural(corrections, 'correction') : null,
    `${plural(undone, 'edit')} undone`,
    plural(failed, 'failed turn'),
  ].filter((part): part is string => part !== null);
  return {
    id: 'first-pass',
    label: 'Right the first time',
    value: trouble === 0 ? 1 : clamp01(1 - trouble / userTurns.length),
    evidence: `${parts.join(', ')} over ${plural(userTurns.length, 'user turn')}${hasText ? '' : ' (corrections need stored prompt text)'}`,
    provenance: derivedFrom('corrections, undone edits and failed turns relative to user turns'),
  };
}

function editKeep(outcomes: Outcomes): ScoreComponent | null {
  const rate = outcomes.editKeepRate.value;
  if (rate === null) return null;
  return {
    id: 'edit-keep',
    label: 'Edits kept',
    value: clamp01(rate),
    evidence: `${String(outcomes.editsKept.value ?? 0)} kept, ${String(outcomes.editsUndone.value ?? 0)} undone, ${String(outcomes.editsUserModified.value ?? 0)} modified by you`,
    provenance: derivedFrom('kept ÷ (kept + undone + modified) from Copilot editedFileEvents'),
  };
}

function tests(outcomes: Outcomes): ScoreComponent | null {
  const passed = outcomes.lastTestPassed.value;
  if (passed === null) return null;
  return {
    id: 'tests',
    label: 'Tests',
    value: passed ? 1 : 0,
    evidence: passed ? 'the last test run passed' : 'the last test run failed',
    provenance: derivedFrom('last test run with a known exit code'),
  };
}

function toolReliability(turns: readonly TurnDetail[]): ScoreComponent | null {
  const rounds = sum(turns.map((turn) => turn.toolRounds.value ?? 0));
  if (rounds <= 0) return null;
  const retries = sum(turns.map((turn) => turn.toolInputRetries.value ?? 0));
  return {
    id: 'tool-reliability',
    label: 'Tool reliability',
    value: clamp01(1 - retries / rounds),
    evidence: `${String(retries)} tool-input ${retries === 1 ? 'retry' : 'retries'} over ${plural(rounds, 'tool round')}`,
    provenance: derivedFrom('tool-input retries ÷ tool rounds (chatSessions toolCallRounds)'),
  };
}

function contextDiscipline(turns: readonly TurnDetail[]): ScoreComponent | null {
  const inputs = [...turns]
    .sort((a, b) => a.index - b.index)
    .flatMap((turn) => (turn.inputTokens.value === null ? [] : [turn.inputTokens.value]));
  const first = inputs[0];
  const last = inputs[inputs.length - 1];
  if (inputs.length < 3 || first === undefined || last === undefined || first <= 0) return null;
  const ratio = last / first;
  const shown = String(Number(ratio.toFixed(1)));
  return {
    id: 'context-discipline',
    label: 'Context size',
    value: clamp01(1 - Math.max(0, ratio - 1) / 4),
    evidence:
      ratio >= 1.5 ? `context grew ${shown}×` : `context stayed within ${shown}× of the first request`,
    provenance: derivedFrom('ratio of exact input tokens, first to last turn'),
  };
}
