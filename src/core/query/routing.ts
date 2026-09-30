import type { Routing } from '../../shared/dto';
import { modelNameFromId } from '../ingest/chatSession';

export interface RoutingEntry {
  mode: string;
  model: string | null;
}

/** Human label for how models were chosen: "Auto → X" (Copilot picked), "Manual · X" (user picked). */
export function routingFor(entries: readonly RoutingEntry[]): Routing {
  const parts = new Map<string, 'auto' | 'manual' | 'unknown'>();
  for (const entry of entries) {
    const name = entry.model === null ? 'Unknown model' : modelNameFromId(entry.model);
    const kind = entry.mode === 'AUTO' ? 'auto' : entry.mode === 'MANUAL' ? 'manual' : 'unknown';
    const label = kind === 'auto' ? `Auto → ${name}` : kind === 'manual' ? `Manual · ${name}` : name;
    if (!parts.has(label)) parts.set(label, kind);
  }
  const labels = [...parts.keys()];
  const known = [...new Set([...parts.values()].filter((kind) => kind !== 'unknown'))];
  const kind = known.length === 0 ? 'unknown' : known.length === 1 ? (known[0] ?? 'unknown') : 'mixed';
  const [first, second] = labels;
  const label =
    first === undefined
      ? 'Unknown'
      : second === undefined || labels.length === 2
        ? labels.join(', ')
        : `${first}, ${second} +${String(labels.length - 2)} more`;
  return { kind, label };
}
