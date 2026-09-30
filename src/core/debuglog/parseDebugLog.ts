import { isRecord } from '../json';
import { classifyDebugName } from './debugNames';
import type { DebugSessionLog, LlmCall } from './types';

const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
/** A bare file name like `tools_0.json`; anything with a path separator is ignored (no path traversal). */
const plainFileName = (value: unknown): string | null =>
  typeof value === 'string' && /^[\w.-]+$/.test(value) && !value.startsWith('.') ? value : null;
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/**
 * Reads only named identifier/numeric fields. `userRequest`, `inputMessages`, tool arguments and results and
 * message content are never read, so they cannot leak into storage.
 */
export function parseDebugLog(sessionId: string, content: string): DebugSessionLog {
  const log: DebugSessionLog = {
    sessionId,
    copilotVersion: null,
    vscodeVersion: null,
    calls: [],
    badLines: 0,
    toolsFile: null,
    systemPromptFile: null,
    toolDefs: null,
    systemPromptChars: null,
  };
  const seen = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      log.badLines++;
      continue;
    }
    if (!isRecord(event) || typeof event.type !== 'string') continue;
    const attrs = isRecord(event.attrs) ? event.attrs : {};
    if (event.type === 'session_start') {
      log.copilotVersion ??= text(attrs.copilotVersion);
      log.vscodeVersion ??= text(attrs.vscodeVersion);
      continue;
    }
    if (event.type !== 'llm_request') continue;
    const spanId = text(event.spanId);
    const startedAt = number(event.ts);
    if (spanId === null || startedAt === null || seen.has(spanId)) continue;
    seen.add(spanId);
    log.toolsFile = plainFileName(attrs.toolsFile) ?? log.toolsFile;
    log.systemPromptFile = plainFileName(attrs.systemPromptFile) ?? log.systemPromptFile;
    const debugName = text(attrs.debugName);
    const call: LlmCall = {
      sessionId,
      spanId,
      responseId: text(attrs.responseId),
      startedAt,
      durationMs: number(event.dur),
      model: text(attrs.model),
      debugName,
      role: classifyDebugName(debugName),
      inputTokens: number(attrs.inputTokens),
      outputTokens: number(attrs.outputTokens),
      cachedTokens: number(attrs.cachedTokens),
      ttftMs: number(attrs.ttft),
      nanoAiu: number(attrs.copilotUsageNanoAiu),
    };
    log.calls.push(call);
  }
  return log;
}
