/** Who asked for a request, decided from Copilot's own `debugName` — never from prompt text. */
export type DebugRole = 'USER_FACING' | 'COPILOT_INTERNAL' | 'UNKNOWN';

/** One `llm_request` span. Numbers are exact Copilot telemetry; there is deliberately no text field. */
export interface LlmCall {
  sessionId: string;
  spanId: string;
  responseId: string | null;
  startedAt: number;
  durationMs: number | null;
  model: string | null;
  debugName: string | null;
  role: DebugRole;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  ttftMs: number | null;
  nanoAiu: number | null;
}

export interface DebugSessionLog {
  sessionId: string;
  copilotVersion: string | null;
  vscodeVersion: string | null;
  calls: LlmCall[];
  badLines: number;
  /** File names (never paths) Copilot reported for the latest tool definitions and system prompt. */
  toolsFile: string | null;
  systemPromptFile: string | null;
  /** Filled in by the scanner from `toolsFile`: names and definition sizes, never descriptions. */
  toolDefs: { name: string; chars: number }[] | null;
  /** Filled in by the scanner from `systemPromptFile`: its character count, never its text. */
  systemPromptChars: number | null;
}
