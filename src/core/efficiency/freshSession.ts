export interface FreshSessionEstimate {
  /** Turn index where a fresh session would have started. */
  restartAtTurn: number;
  /** Estimated input tokens not sent. */
  tokensSaved: number;
  /** tokensSaved ÷ the session's total input tokens (0–1). */
  shareOfInput: number;
}

const MIN_TURNS_WITH_INPUT = 4;
const MIN_SHARE = 0.2;

/**
 * What restarting in a fresh session might have saved. The first request's input approximates the fixed baseline
 * (system prompt, tool definitions, the first message). A session restarted at turn k would have sent
 * `baseline + (input_i − input_k)` for every later turn i, so it saves `input_k − baseline` on each turn from k on.
 * An estimate that ignores prompt-cache discounts; null unless the best saving is at least a fifth of the input.
 */
export function freshSessionEstimate(
  turns: readonly { index: number; inputTokens: number | null; systemInitiated: boolean }[],
): FreshSessionEstimate | null {
  const known = turns
    .flatMap((turn) =>
      turn.inputTokens === null
        ? []
        : [{ index: turn.index, input: turn.inputTokens, systemInitiated: turn.systemInitiated }],
    )
    .sort((a, b) => a.index - b.index);
  const first = known[0];
  if (known.length < MIN_TURNS_WITH_INPUT || first === undefined) return null;
  const total = known.reduce((sum, turn) => sum + turn.input, 0);
  if (total <= 0) return null;

  let best: { restartAtTurn: number; tokensSaved: number } | null = null;
  known.forEach((candidate, position) => {
    if (position === 0 || candidate.systemInitiated) return;
    const saved = (known.length - position) * (candidate.input - first.input);
    if (saved > 0 && (best === null || saved > best.tokensSaved)) {
      best = { restartAtTurn: candidate.index, tokensSaved: saved };
    }
  });
  const chosen = best as { restartAtTurn: number; tokensSaved: number } | null;
  if (chosen === null || chosen.tokensSaved / total < MIN_SHARE) return null;
  return { ...chosen, shareOfInput: chosen.tokensSaved / total };
}
