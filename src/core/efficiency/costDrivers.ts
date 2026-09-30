import type { TurnDetail } from '../../shared/dto';
import type { CostDriver } from './types';

const int = (value: number): string => value.toLocaleString('en-US');
const plural = (count: number, noun: string): string => `${int(count)} ${noun}${count === 1 ? '' : 's'}`;
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
const known = (measure: { value: number | null }): number[] =>
  measure.value === null ? [] : [measure.value];

/**
 * Evidence for why a session cost what it did, from Copilot's exact fields. A driver whose evidence is missing is
 * left out; a cache hit is reported as a fact (cheaper), never as a problem.
 */
export function costDrivers(turns: readonly TurnDetail[]): CostDriver[] {
  const ordered = [...turns].sort((a, b) => a.index - b.index);
  return [
    contextGrowth(ordered),
    cache(ordered),
    composition(ordered),
    rounds(ordered),
    compactions(ordered),
    failedWork(ordered),
  ].filter((driver): driver is CostDriver => driver !== null);
}

function contextGrowth(turns: readonly TurnDetail[]): CostDriver | null {
  const withInput = turns.flatMap((turn) =>
    turn.inputTokens.value === null ? [] : [{ index: turn.index, input: turn.inputTokens.value }],
  );
  const first = withInput[0];
  const last = withInput[withInput.length - 1];
  if (withInput.length < 3 || first === undefined || last === undefined || first.input <= 0) return null;
  const ratio = last.input / first.input;
  if (ratio < 1.5) return null;
  return {
    id: 'context-growth',
    title: 'Context growth',
    evidence: `context grew ${String(Number(ratio.toFixed(1)))}× (${int(first.input)} input tokens on turn ${String(first.index)} → ${int(last.input)} on turn ${String(last.index)})`,
    provenance: { kind: 'derived', source: 'ratio of exact input tokens, first to last turn' },
  };
}

function cache(turns: readonly TurnDetail[]): CostDriver | null {
  const reporting = turns.filter(
    (turn) => turn.cachedTokens.value !== null && turn.inputTokens.value !== null,
  );
  if (reporting.length === 0) return null;
  const cached = sum(reporting.flatMap((turn) => known(turn.cachedTokens)));
  const input = sum(reporting.flatMap((turn) => known(turn.inputTokens)));
  const partial = reporting.length < turns.length;
  return {
    id: 'cache',
    title: 'Prompt cache',
    evidence: `${int(cached)} of ${int(input)} input tokens were read from the prompt cache (cache hits are cheaper, not waste)${
      partial ? `; ${String(reporting.length)} of ${String(turns.length)} turns reported it` : ''
    }`,
    provenance: {
      kind: 'derived',
      source: `agent debug log cachedTokens ÷ chatSessions.promptTokens${partial ? ' (lower bound: not every turn has debug-log data)' : ''}`,
    },
  };
}

function composition(turns: readonly TurnDetail[]): CostDriver | null {
  const weights = new Map<string, { label: string; weighted: number }>();
  let totalInput = 0;
  for (const turn of turns) {
    const input = turn.inputTokens.value;
    if (input === null || turn.promptComposition.length === 0) continue;
    totalInput += input;
    for (const part of turn.promptComposition) {
      if (part.share.value === null) continue;
      const entry = weights.get(part.category) ?? {
        label: part.label.trim() === '' ? part.category : part.label,
        weighted: 0,
      };
      entry.weighted += part.share.value * input;
      weights.set(part.category, entry);
    }
  }
  if (totalInput === 0 || weights.size === 0) return null;
  const top = [...weights.values()]
    .map((entry) => ({
      label: entry.label.toLowerCase(),
      percent: Math.round((entry.weighted / totalInput) * 100),
    }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 3);
  const [head, ...rest] = top;
  if (head === undefined) return null;
  const text = [
    `${head.label} were ${String(head.percent)}% of the prompt`,
    ...rest.map((part) => `${part.label} ${String(part.percent)}%`),
  ];
  return {
    id: 'composition',
    title: 'What filled the prompt',
    evidence: `on average ${text.join(', ')}`,
    provenance: { kind: 'derived', source: 'chatSessions promptTokenDetails weighted by input tokens' },
  };
}

function rounds(turns: readonly TurnDetail[]): CostDriver | null {
  const toolRounds = sum(turns.flatMap((turn) => known(turn.toolRounds)));
  const retries = sum(turns.flatMap((turn) => known(turn.toolInputRetries)));
  if (toolRounds < 10 && retries < 1) return null;
  return {
    id: 'rounds',
    title: 'Tool rounds',
    evidence: `${plural(toolRounds, 'tool round')} across ${plural(turns.length, 'turn')}${
      retries > 0 ? `, ${int(retries)} tool-input ${retries === 1 ? 'retry' : 'retries'}` : ''
    }`,
    provenance: { kind: 'exact', source: 'chatSessions toolCallRounds' },
  };
}

function compactions(turns: readonly TurnDetail[]): CostDriver | null {
  const count = sum(turns.flatMap((turn) => known(turn.compactions)));
  if (count < 1) return null;
  const sizes = turns.flatMap((turn) => known(turn.contextTokensBefore));
  const largest = sizes.length > 0 ? Math.max(...sizes) : null;
  return {
    id: 'compactions',
    title: 'Context compaction',
    evidence: `context was compacted ${String(count)} time${count === 1 ? '' : 's'}${
      largest === null ? '' : ` (largest context before: ${int(largest)} tokens)`
    }`,
    provenance: { kind: 'exact', source: 'chatSessions compaction events' },
  };
}

function failedWork(turns: readonly TurnDetail[]): CostDriver | null {
  const failed = turns.filter(
    (turn) => !turn.systemInitiated && turn.state === 'failed' && turn.inputTokens.value !== null,
  );
  if (failed.length === 0) return null;
  const tokens = sum(failed.flatMap((turn) => known(turn.inputTokens)));
  return {
    id: 'failed-work',
    title: 'Failed turns',
    evidence: `${plural(failed.length, 'failed turn')} consumed ${int(tokens)} input tokens`,
    provenance: { kind: 'exact', source: 'chatSessions turn state and promptTokens' },
  };
}
