import type { Finding } from './types';

export const CHARS_PER_TOKEN = 4;
const SOURCE = `characters ÷ ${String(CHARS_PER_TOKEN)} as a token estimate from the latest recorded tool snapshot; request-level association unavailable`;
const MIN_TOOLS = 5;
const MIN_SYSTEM_PROMPT_CHARS = 20_000;

export interface BloatInput {
  toolDefs: readonly { name: string; chars: number }[] | null;
  systemPromptChars: number | null;
  usedToolNames: ReadonlySet<string>;
  /** LLM requests in the session; used only to avoid advice for a one-request session. */
  requests: number;
}

const int = (value: number): string => value.toLocaleString('en-US');
/** "About" figures are rounded to the nearest hundred: they are estimates. */
const approx = (tokens: number): number => Math.round(tokens / 100) * 100;

/**
 * Latest recorded prompt artifacts. The files are session-level snapshots, so they cannot prove which
 * individual requests carried the same definitions. Sizes are exact characters; tokens are an estimate.
 */
export function contextBloat(input: BloatInput): Finding[] {
  if (input.requests < 2) return [];
  const findings: Finding[] = [];
  const defs = input.toolDefs;
  if (defs !== null && defs.length >= MIN_TOOLS) {
    const unused = defs.filter((def) => !input.usedToolNames.has(def.name));
    if (unused.length / defs.length >= 0.5) {
      const perRequest = approx(unused.reduce((sum, def) => sum + def.chars, 0) / CHARS_PER_TOKEN);
      const largest = [...unused]
        .sort((a, b) => b.chars - a.chars)
        .slice(0, 3)
        .map((def) => def.name.replace(/\s+/g, ' ').slice(0, 80));
      findings.push({
        id: 'unused-tools',
        message:
          'Review the largest uncalled tools in the Copilot tool picker. Disable tools or MCP servers you do not need for this task; keep the ones the agent needs.',
        evidence: `${String(unused.length)} of ${String(defs.length)} definitions in the latest recorded snapshot were not called in this session; about ${int(perRequest)} tokens if this snapshot was sent on a request. Largest: ${largest.join(', ')}. Request-level association unavailable; this is not measured savings.`,
        provenance: { kind: 'inferred', source: SOURCE },
      });
    }
  }
  if (input.systemPromptChars !== null && input.systemPromptChars >= MIN_SYSTEM_PROMPT_CHARS) {
    findings.push({
      id: 'system-prompt',
      message:
        'Review broad custom instructions and move task-specific rules into scoped instruction files where possible.',
      evidence: `the latest recorded system prompt is ${int(input.systemPromptChars)} characters (about ${int(approx(input.systemPromptChars / CHARS_PER_TOKEN))} tokens if sent on a request); request-level association is unavailable`,
      provenance: { kind: 'inferred', source: SOURCE },
    });
  }
  return findings;
}
