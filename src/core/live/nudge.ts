export interface LiveStatus {
  /** Input tokens of the latest request: how much context Copilot is carrying now. */
  contextTokens: number;
  /** Exact credits reported so far; null when none were. */
  credits: number | null;
  compactions: number;
  nudge: string | null;
}

/** A session counts as active for this long after its last turn ended. */
export const ACTIVE_WINDOW_MS = 600_000;
const GROWTH_NUDGE = 3;
const COMPACTION_NUDGE = 2;

/**
 * What to show for the session being worked in right now. Null when it is not active or has no known context
 * size. Growth against the session's own start wins over compactions when both apply.
 */
export function liveStatus(input: {
  now: number;
  endedAt: number;
  turns: readonly {
    index: number;
    inputTokens: number | null;
    credits: number | null;
    compactions: number;
  }[];
}): LiveStatus | null {
  if (input.now - input.endedAt > ACTIVE_WINDOW_MS) return null;
  const ordered = [...input.turns].sort((a, b) => a.index - b.index);
  const inputs = ordered.flatMap((turn) => (turn.inputTokens === null ? [] : [turn.inputTokens]));
  const first = inputs[0];
  const last = inputs[inputs.length - 1];
  if (first === undefined || last === undefined) return null;
  const reported = ordered.flatMap((turn) => (turn.credits === null ? [] : [turn.credits]));
  const compactions = ordered.reduce((sum, turn) => sum + turn.compactions, 0);
  let nudge: string | null = null;
  if (first > 0 && last / first >= GROWTH_NUDGE) {
    nudge = `Context is ${String(Number((last / first).toFixed(1)))}× where this session started. A fresh session may cost less.`;
  } else if (compactions >= COMPACTION_NUDGE) {
    nudge = `This session has been compacted ${String(compactions)} times. A fresh session may cost less.`;
  }
  return {
    contextTokens: last,
    credits: reported.length === 0 ? null : reported.reduce((sum, value) => sum + value, 0),
    compactions,
    nudge,
  };
}

function abbreviate(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  const thousands = Math.round((tokens / 1000) * 10) / 10;
  if (thousands < 1000) return `${String(thousands)}K`;
  return `${String(Math.round((tokens / 1_000_000) * 10) / 10)}M`;
}

/** e.g. `Copilot 48K ctx · 1.2 cr`. */
export function statusText(status: LiveStatus): string {
  const credits = status.credits === null ? '' : ` · ${String(Number(status.credits.toFixed(2)))} cr`;
  return `Copilot ${abbreviate(status.contextTokens)} ctx${credits}`;
}
