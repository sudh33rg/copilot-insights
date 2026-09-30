import type { Finding } from './types';

export const CHARS_PER_TOKEN = 4;
const SOURCE = `characters ÷ ${String(CHARS_PER_TOKEN)} as a token estimate; sent on every request`;
const MIN_TOOLS = 5;
const MIN_SYSTEM_PROMPT_CHARS = 20_000;

export interface BloatInput {
  toolDefs: readonly { name: string; chars: number }[] | null;
  systemPromptChars: number | null;
  usedToolNames: ReadonlySet<string>;
  /** LLM requests in the session; the fixed prompt parts are paid for on each of them. */
  requests: number;
}

const int = (value: number): string => value.toLocaleString('en-US');
/** "About" figures are rounded to the nearest hundred: they are estimates. */
const approx = (tokens: number): number => Math.round(tokens / 100) * 100;

/**
 * Fixed prompt parts paid for on every request: tool definitions nobody called, and the system prompt. Sizes are
 * exact characters; tokens are an estimate, so everything here is `inferred` (D-P5-1).
 */
export function contextBloat(input: BloatInput): Finding[] {
  if (input.requests < 2) return [];
  const findings: Finding[] = [];
  const defs = input.toolDefs;
  if (defs !== null && defs.length >= MIN_TOOLS) {
    const unused = defs.filter((def) => !input.usedToolNames.has(def.name));
    if (unused.length / defs.length >= 0.5) {
      const perRequest = approx(unused.reduce((sum, def) => sum + def.chars, 0) / CHARS_PER_TOKEN);
      findings.push({
        id: 'unused-tools',
        message:
          'Tools you do not use still cost tokens on every request. Disabling unused tools or MCP servers may reduce cost.',
        evidence: `${String(unused.length)} of ${String(defs.length)} tool definitions were never called; about ${int(perRequest)} tokens of definitions were sent with each of ${String(input.requests)} requests (≈ ${int(perRequest * input.requests)} tokens)`,
        provenance: { kind: 'inferred', source: SOURCE },
      });
    }
  }
  if (input.systemPromptChars !== null && input.systemPromptChars >= MIN_SYSTEM_PROMPT_CHARS) {
    findings.push({
      id: 'system-prompt',
      message: 'A large system prompt (instructions, custom instruction files) is paid for on every request.',
      evidence: `the system prompt is ${int(input.systemPromptChars)} characters (about ${int(approx(input.systemPromptChars / CHARS_PER_TOKEN))} tokens) and was sent with each of ${String(input.requests)} requests`,
      provenance: { kind: 'inferred', source: SOURCE },
    });
  }
  return findings;
}
