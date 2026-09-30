import type { TurnDetail } from '../../shared/dto';
import { summarizeChanges } from '../analysis/changes';
import { estimateComplexity } from '../analysis/complexity';
import { CORRECTION } from '../analysis/findings';
import type { ModelPrice } from './priceCounterfactual';
import type { Finding } from './types';

export interface ModelFindingInput {
  turns: readonly TurnDetail[];
  prices: readonly ModelPrice[];
}

const SOURCE = 'rule over turn state, file events and catalog list prices';
const MIN_PRICED_MODELS = 6;
const HIGH_REASONING_MS = 120_000;
const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

type Band = 'expensive' | 'middle' | 'lightweight';

/** Where a model's input price sits among priced catalog models; unknown when it has no price or the catalog is small. */
function priceBand(modelId: string, prices: readonly ModelPrice[]): Band | null {
  const priced = prices.filter((price) => price.inputPrice > 0);
  if (priced.length < MIN_PRICED_MODELS) return null;
  const own = priced.find((price) => price.id.toLowerCase() === modelId.toLowerCase());
  if (own === undefined) return null;
  const fraction = priced.filter((price) => price.inputPrice < own.inputPrice).length / priced.length;
  return fraction >= 2 / 3 ? 'expensive' : fraction < 1 / 3 ? 'lightweight' : 'middle';
}

/**
 * Evidence-based reading of whether the model fit the work. Every finding is hedged ("looks like", "may") and
 * carries its counts; none claims a model was wrong. Rules that need a price rank are skipped when the catalog
 * cannot give one (BYOK models, small catalogs).
 */
export function modelFindings(input: ModelFindingInput): Finding[] {
  const userTurns = input.turns.filter((turn) => !turn.systemInitiated);
  if (userTurns.length === 0) return [];
  const changes = summarizeChanges(input.turns);
  const corrections = userTurns.slice(1).filter((turn) => CORRECTION.test(turn.userText ?? '')).length;
  const failed = userTurns.filter((turn) => turn.state === 'failed').length;
  const small =
    changes.changed.length <= 1 &&
    userTurns.length <= 2 &&
    failed === 0 &&
    changes.undone === 0 &&
    corrections === 0;
  const complex =
    estimateComplexity({
      userTurns: userTurns.length,
      toolCalls: input.turns.reduce((sum, turn) => sum + turn.toolCalls.length, 0),
      changedFiles: changes.changed.length,
      compactions: input.turns.reduce((sum, turn) => sum + (turn.compactions.value ?? 0), 0),
    }) === 'complex';

  const findings: Finding[] = [];
  const dominant = dominantModel(userTurns, input.prices);
  const band = dominant === null ? null : priceBand(dominant.id, input.prices);
  const name = dominant?.name ?? '';

  if (small && band === 'expensive' && dominant !== null) {
    const base = `${plural(changes.changed.length, 'file')} changed, ${plural(userTurns.length, 'user turn')}, no failures, no corrections`;
    if (dominant.selection === 'manual') {
      findings.push({
        id: 'oversized-model',
        message:
          'This looks like a small task run on an expensive model you selected. A lighter model may have been enough.',
        evidence: `${base}; model ${name} is in the top third of catalog input prices`,
        provenance: { kind: 'inferred', source: SOURCE },
      });
    } else if (dominant.selection === 'auto') {
      findings.push({
        id: 'auto-over-routing',
        message:
          'Auto routed this small task to an expensive model. Picking a lighter model manually may be cheaper for tasks like this.',
        evidence: `${base}; Auto chose ${name}, which is in the top third of catalog input prices`,
        provenance: { kind: 'inferred', source: SOURCE },
      });
    }
  }

  if (complex && band === 'lightweight' && (corrections >= 3 || failed >= 2 || changes.undone >= 2)) {
    const trouble = [
      corrections > 0 ? plural(corrections, 'correction') : null,
      failed > 0 ? plural(failed, 'failed turn') : null,
      changes.undone > 0 ? plural(changes.undone, 'edit') + ' undone' : null,
    ].filter((part): part is string => part !== null);
    findings.push({
      id: 'undersized-model',
      message:
        'A complex task on a lightweight model needed repeated fixes. A stronger reasoning model may have been more efficient.',
      evidence: `${trouble.join(', ')}; model ${name} is in the bottom third of catalog input prices and the task looks complex`,
      provenance: { kind: 'inferred', source: SOURCE },
    });
  }

  const reasoning = userTurns.filter((turn) => (turn.reasoningMs.value ?? 0) > 0);
  const reasoningMs = reasoning.reduce((sum, turn) => sum + (turn.reasoningMs.value ?? 0), 0);
  if (small && reasoningMs >= HIGH_REASONING_MS) {
    findings.push({
      id: 'high-reasoning',
      message: 'Long reasoning on a small task. A lower reasoning effort may have been enough.',
      evidence: `${duration(reasoningMs)} of reasoning across ${plural(reasoning.length, 'turn')} for ${plural(changes.changed.length, 'changed file')}`,
      provenance: { kind: 'inferred', source: SOURCE },
    });
  }
  return findings;
}

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${String(seconds)}s`
    : `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
}

/** The model behind most user turns (ties go to the pricier one) and whether the user or Auto chose it. */
function dominantModel(
  userTurns: readonly TurnDetail[],
  prices: readonly ModelPrice[],
): { id: string; name: string; selection: 'auto' | 'manual' | null } | null {
  const groups = new Map<string, TurnDetail[]>();
  for (const turn of userTurns) {
    if (turn.modelId === null) continue;
    groups.set(turn.modelId, [...(groups.get(turn.modelId) ?? []), turn]);
  }
  const priceOf = (id: string) =>
    prices.find((price) => price.id.toLowerCase() === id.toLowerCase())?.inputPrice ?? 0;
  const best = [...groups].sort((a, b) => b[1].length - a[1].length || priceOf(b[0]) - priceOf(a[0]))[0];
  if (best === undefined) return null;
  const [id, turns] = best;
  const kinds = new Set(turns.map((turn) => turn.routing.kind));
  const only = kinds.size === 1 ? [...kinds][0] : undefined;
  return {
    id,
    name: turns[0]?.model ?? id,
    selection: only === 'auto' || only === 'manual' ? only : null,
  };
}
