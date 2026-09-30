import type { FailureAnalytics, FailureRow } from '../../shared/dto';
import { derived, exact, unavailable } from '../../shared/provenance';
import { modelNameFromId } from '../ingest/chatSession';
import type { Database } from '../storage/database';

const RATE_SOURCE = 'turn state over finished user-initiated turns';
const TOOL_SOURCE = 'chatSessions toolCallRounds';

interface TurnRow {
  model: string | null;
  requested_model: string | null;
  mode: string | null;
  state: string;
  tool_input_retries: number;
  max_tool_calls_exceeded: number;
}

interface Group {
  label: string;
  turns: number;
  failed: number;
  retries: number;
  exceeded: number;
}

/** "copilot/auto" → Copilot; "ollama/Ollama/qwen3.5:35b" → ollama; anything without a vendor prefix → Unknown. */
function providerOf(requestedModel: string | null): string {
  if (!requestedModel?.includes('/')) return 'Unknown';
  const vendor = requestedModel.split('/')[0] ?? '';
  return vendor === 'copilot' ? 'Copilot' : vendor;
}

function rows(groups: Map<string, Group>): FailureRow[] {
  return [...groups]
    .map(([key, group]): FailureRow => ({
      key,
      label: group.label,
      turns: group.turns,
      failed: group.failed,
      failureRate:
        group.turns === 0 ? unavailable(RATE_SOURCE) : derived(group.failed / group.turns, RATE_SOURCE),
      toolInputRetries: exact(group.retries, TOOL_SOURCE),
      maxToolCallsExceeded: exact(group.exceeded, TOOL_SOURCE),
    }))
    .sort((a, b) => b.failed - a.failed || b.turns - a.turns || a.key.localeCompare(b.key));
}

/**
 * Where turns fail, across everything in the index. The population is the Overview's: user-initiated turns that
 * finished (complete or failed); cancelled, pending and system-initiated turns are left out.
 */
export function getFailureAnalytics(database: Pick<Database, 'db'>): FailureAnalytics {
  const turns = database.db
    .prepare(
      `SELECT COALESCE(resolved_model, requested_model) AS model, requested_model, mode, state,
              tool_input_retries, max_tool_calls_exceeded
         FROM turns WHERE system_initiated = 0 AND state IN ('complete', 'failed')`,
    )
    .all() as unknown as TurnRow[];
  const byModel = new Map<string, Group>();
  const byProvider = new Map<string, Group>();
  const byMode = new Map<string, Group>();
  const add = (groups: Map<string, Group>, key: string, label: string, turn: TurnRow) => {
    const group = groups.get(key) ?? { label, turns: 0, failed: 0, retries: 0, exceeded: 0 };
    group.turns++;
    if (turn.state === 'failed') group.failed++;
    group.retries += turn.tool_input_retries;
    group.exceeded += turn.max_tool_calls_exceeded;
    groups.set(key, group);
  };
  for (const turn of turns) {
    add(
      byModel,
      turn.model ?? 'unknown',
      turn.model === null ? 'Unknown model' : modelNameFromId(turn.model),
      turn,
    );
    const provider = providerOf(turn.requested_model);
    add(byProvider, provider, provider, turn);
    add(byMode, turn.mode ?? 'unknown', turn.mode ?? 'unknown', turn);
  }
  return { byModel: rows(byModel), byProvider: rows(byProvider), byMode: rows(byMode) };
}
