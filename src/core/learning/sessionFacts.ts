import type { SessionDetail, TurnDetail } from '../../shared/dto';
import { summarizeChanges } from '../analysis/changes';
import { ACCEPTANCE_CUE, CORRECTION, FILE_REFERENCE, constraintWords } from '../analysis/findings';

/** What the learning statistics need to know about one session; computed in memory, never stored. */
export interface SessionFacts {
  id: string;
  workspace: string;
  day: string;
  startedAt: number;
  taskType: string | null;
  model: string | null;
  selection: 'auto' | 'manual' | 'mixed' | 'unknown';
  host: 'copilot' | 'byok' | 'unknown';
  inputTokens: number | null;
  /** Null unless Copilot reported credits for every Copilot-hosted turn. */
  credits: number | null;
  userTurns: number;
  /** Null when no prompt text was stored. */
  corrections: number | null;
  failedTurns: number;
  undone: number;
  lastTestPassed: boolean | null;
  editKeepRate: number | null;
  laterSurvival: number | null;
  /** Mean first-token latency over the turns that have it. */
  ttftMs: number | null;
  /** Null when no prompt text was stored. */
  opening: { namesFile: boolean; statesSuccess: boolean; statesConstraints: boolean } | null;
  /** D-P6-3: no failed user turns, no undone edits, and the last known test run did not fail. */
  successful: boolean;
}

function dominantModel(turns: readonly TurnDetail[]): string | null {
  const counts = new Map<string, number>();
  for (const turn of turns) {
    if (turn.model !== null) counts.set(turn.model, (counts.get(turn.model) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [model, count] of counts) {
    if (count > bestCount) {
      best = model;
      bestCount = count;
    }
  }
  return best;
}

function selectionOf(turns: readonly TurnDetail[]): SessionFacts['selection'] {
  const kinds = new Set(turns.map((turn) => turn.routing.kind));
  if (kinds.size === 0) return 'unknown';
  if (kinds.size === 1) {
    const only = [...kinds][0];
    return only === 'auto' || only === 'manual' ? only : only === 'mixed' ? 'mixed' : 'unknown';
  }
  return 'mixed';
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

export function sessionFactsFromDetail(detail: SessionDetail): SessionFacts {
  const userTurns = detail.turns.filter((turn) => !turn.systemInitiated);
  const texts = userTurns.map((turn) => (turn.userText ?? '').trim());
  const hasText = texts.some((text) => text !== '');
  const first = texts[0] ?? '';
  const failedTurns = userTurns.filter((turn) => turn.state === 'failed').length;
  const undone = summarizeChanges(detail.turns).undone;
  const lastTestPassed = detail.outcomes.lastTestPassed.value;
  const hasCopilotTurn = userTurns.some((turn) => turn.host === 'copilot');
  const hasByokTurn = userTurns.some((turn) => turn.host === 'byok');
  return {
    id: detail.id,
    workspace: detail.workspace,
    day: detail.day,
    startedAt: detail.startedAt,
    taskType: detail.analysis?.taskType.value ?? null,
    model: dominantModel(userTurns),
    selection: selectionOf(userTurns),
    host: hasCopilotTurn ? 'copilot' : hasByokTurn ? 'byok' : 'unknown',
    inputTokens: detail.inputTokens.value,
    credits: detail.credits.provenance.kind === 'exact' ? detail.credits.value : null,
    userTurns: userTurns.length,
    corrections: hasText ? texts.slice(1).filter((text) => CORRECTION.test(text)).length : null,
    failedTurns,
    undone,
    lastTestPassed,
    editKeepRate: detail.outcomes.editKeepRate.value,
    laterSurvival: detail.outcomes.laterSurvival.value,
    ttftMs: mean(detail.turns.flatMap((turn) => (turn.ttftMs.value === null ? [] : [turn.ttftMs.value]))),
    opening: hasText
      ? {
          namesFile: FILE_REFERENCE.test(first),
          statesSuccess: ACCEPTANCE_CUE.test(first),
          statesConstraints: constraintWords(first).length > 0,
        }
      : null,
    successful: failedTurns === 0 && undone === 0 && lastTestPassed !== false,
  };
}
