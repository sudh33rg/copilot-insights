import type { Efficiency, Outcomes, TurnDetail } from '../../shared/dto';
import { derived, inferred } from '../../shared/provenance';
import { contextBloat } from '../efficiency/contextBloat';
import { costDrivers } from '../efficiency/costDrivers';
import { freshSessionEstimate } from '../efficiency/freshSession';
import { modelFindings } from '../efficiency/modelFindings';
import { priceCounterfactual, type ModelPrice } from '../efficiency/priceCounterfactual';
import { efficiencyScore } from '../efficiency/score';
import type { Database } from '../storage/database';
import { readModelPrices } from './modelPrices';

/** Everything that explains a session's cost and how to do better; see docs/superpowers/plans (Phase 5). */
export function getSessionEfficiency(
  database: Pick<Database, 'db'>,
  turns: readonly TurnDetail[],
  sessionId: string,
  outcomes: Outcomes,
): Efficiency {
  const prices = readModelPrices(database);
  return {
    drivers: costDrivers(turns),
    findings: [...contextFindings(database, turns, sessionId), ...modelFindings({ turns, prices })],
    freshSession: freshSession(turns),
    priceAlternatives: priceAlternatives(prices, turns),
    score: score(turns, outcomes),
  };
}

function score(turns: readonly TurnDetail[], outcomes: Outcomes): Efficiency['score'] {
  const result = efficiencyScore({ turns, outcomes });
  if (result === null) return null;
  return {
    band: { value: result.band, provenance: result.provenance },
    components: result.components.map((component) => ({
      id: component.id,
      label: component.label,
      value: { value: component.value, provenance: component.provenance },
      evidence: component.evidence,
    })),
  };
}

const PRICE_SOURCE =
  'catalog list prices applied to this session’s exact tokens; relative to the list cost of the models actually used, not a credit figure';

function priceAlternatives(
  prices: readonly ModelPrice[],
  turns: readonly TurnDetail[],
): Efficiency['priceAlternatives'] {
  return priceCounterfactual({
    turns: turns.map((turn) => ({
      modelId: turn.modelId,
      inputTokens: turn.inputTokens.value,
      outputTokens: turn.outputTokens.value,
      cachedTokens: turn.cachedTokens.value,
    })),
    prices,
  }).map((row) => ({
    model: row.model,
    name: row.name,
    relativeCost: derived(row.relativeCost, PRICE_SOURCE),
  }));
}

const FRESH_SOURCE =
  'estimate: a fresh session would resend the first request’s baseline instead of the accumulated context; ignores prompt-cache discounts';

function freshSession(turns: readonly TurnDetail[]): Efficiency['freshSession'] {
  const estimate = freshSessionEstimate(
    turns.map((turn) => ({
      index: turn.index,
      inputTokens: turn.inputTokens.value,
      systemInitiated: turn.systemInitiated,
    })),
  );
  if (estimate === null) return null;
  return {
    restartAtTurn: estimate.restartAtTurn,
    tokensSaved: inferred(estimate.tokensSaved, FRESH_SOURCE),
    shareOfInput: inferred(estimate.shareOfInput, FRESH_SOURCE),
  };
}

function contextFindings(database: Pick<Database, 'db'>, turns: readonly TurnDetail[], sessionId: string) {
  const { db } = database;
  const files = db
    .prepare('SELECT system_prompt_chars, tool_defs_chars FROM llm_prompt_files WHERE session_id = :id')
    .get({ id: sessionId }) as
    { system_prompt_chars: number | null; tool_defs_chars: number | null } | undefined;
  const toolDefs =
    files?.tool_defs_chars == null
      ? null
      : (db
          .prepare('SELECT name, chars FROM llm_tool_defs WHERE session_id = :id')
          .all({ id: sessionId }) as unknown as { name: string; chars: number }[]);
  const used = new Set(
    (
      db
        .prepare('SELECT DISTINCT name FROM tool_calls WHERE session_id = :id')
        .all({ id: sessionId }) as unknown as {
        name: string;
      }[]
    ).map((row) => row.name),
  );
  const llmRequests = (
    db
      .prepare("SELECT count(*) AS n FROM llm_calls WHERE session_id = :id AND role != 'COPILOT_INTERNAL'")
      .get({ id: sessionId }) as { n: number }
  ).n;
  return contextBloat({
    toolDefs,
    systemPromptChars: files?.system_prompt_chars ?? null,
    usedToolNames: used,
    requests: llmRequests > 0 ? llmRequests : turns.length,
  });
}
