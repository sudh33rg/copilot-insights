import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../json';
import {
  autoModePartSchema,
  markdownPartSchema,
  requestSchema,
  summarySchema,
  thinkingPartSchema,
  toolCallRoundSchema,
  toolCallSchema,
  toolInvocationPartSchema,
  uriPartSchema,
  type ChatRequest,
  type EditedFileEvent,
} from './chatSessionSchema';
import type {
  Compaction,
  FileAction,
  FileEvent,
  ModelHost,
  NormalizedSession,
  NormalizedTurn,
  SelectionMode,
  SelectionSource,
  ToolCall,
  TurnState,
} from './types';

// modelState.value, confirmed against result.errorDetails on real data.
const TURN_STATES: Partial<Record<number, TurnState>> = {
  0: 'pending',
  1: 'complete',
  2: 'cancelled',
  3: 'failed',
};
// VS Code ChatRequestEditedFileEventKind: 1 Keep, 2 Undo, 3 UserModification.
const EDIT_EVENT_ACTIONS: Partial<Record<number, FileAction>> = {
  1: 'kept',
  2: 'undone',
  3: 'user-modified',
};

const KNOWN_PART_KINDS = new Set([
  'thinking',
  'toolInvocationSerialized',
  'inlineReference',
  'textEditGroup',
  'undoStop',
  'codeblockUri',
  'mcpServersStarting',
  'progressTaskSerialized',
  'elicitationSerialized',
  'autoModeResolution',
  'workspaceEdit',
  'confirmation',
]);

const KNOWN_REQUEST_KEYS = new Set([
  'requestId',
  'timestamp',
  'responseId',
  'modelState',
  'contentReferences',
  'codeCitations',
  'timeSpentWaiting',
  'modeInfo',
  'response',
  'message',
  'variableData',
  'agent',
  'modelId',
  'result',
  'elapsedMs',
  'followups',
  'completionTokens',
  'promptTokens',
  'outputBuffer',
  'promptTokenDetails',
  'responseMarkdownInfo',
  'responseTimestamp',
  'editedFileEvents',
  'hiddenFromTranscript',
  'confirmation',
  'isSystemInitiated',
  'systemInitiatedLabel',
  'terminalExecutionId',
  'copilotCredits',
]);

export interface NormalizeContext {
  file: string;
  workspace: string;
}

export function normalizeChatSession(state: unknown, context: NormalizeContext): NormalizedSession | null {
  if (!isRecord(state) || !Array.isArray(state.requests) || state.requests.length === 0) return null;
  const unknownPartKinds = new Set<string>();
  const unknownRequestKeys = new Set<string>();
  let invalidRequests = 0;
  const turns: NormalizedTurn[] = [];
  for (const raw of state.requests as unknown[]) {
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      invalidRequests++;
      continue;
    }
    for (const key of Object.keys(parsed.data)) if (!KNOWN_REQUEST_KEYS.has(key)) unknownRequestKeys.add(key);
    turns.push(normalizeTurn(parsed.data, turns.length + 1, unknownPartKinds));
  }
  if (turns.length === 0) return null;

  const starts = turns.map((turn) => turn.startedAt).filter((value): value is number => value !== null);
  const creationDate = typeof state.creationDate === 'number' ? state.creationDate : 0;
  const startedAt = starts.length > 0 ? Math.min(...starts) : creationDate;
  const endedAt = Math.max(startedAt, ...turns.map((turn) => turn.endedAt ?? 0));
  const sessionId = typeof state.sessionId === 'string' && state.sessionId !== '' ? state.sessionId : null;
  return {
    id: sessionId ?? basename(context.file).replace(/\.jsonl?$/i, ''),
    sourceFile: context.file,
    workspace: context.workspace,
    title: nonEmpty(typeof state.customTitle === 'string' ? state.customTitle : undefined),
    location: typeof state.initialLocation === 'string' ? state.initialLocation : null,
    startedAt,
    endedAt,
    activeMs: turns.reduce((sum, turn) => sum + (turn.elapsedMs ?? 0), 0),
    turns,
    diagnostics: {
      unknownPartKinds: [...unknownPartKinds].sort(),
      unknownRequestKeys: [...unknownRequestKeys].sort(),
      invalidRequests,
    },
  };
}

function normalizeTurn(request: ChatRequest, index: number, unknownPartKinds: Set<string>): NormalizedTurn {
  const parts = request.response ?? [];
  for (const part of parts) {
    if (isRecord(part) && typeof part.kind === 'string' && !KNOWN_PART_KINDS.has(part.kind))
      unknownPartKinds.add(part.kind);
  }
  const meta = request.result?.metadata;
  const startedAt = request.timestamp ?? null;
  const elapsedMs = request.elapsedMs ?? request.result?.timings?.totalElapsed ?? null;
  const completedAt = request.modelState?.completedAt ?? null;
  const endedAt =
    completedAt ?? (startedAt !== null && elapsedMs !== null ? startedAt + elapsedMs : startedAt);
  const rounds = parseRounds(meta?.toolCallRounds);
  const toolCalls = collectToolCalls(rounds, parts);
  const reasoning = parsePartsOfKind(parts, 'thinking', thinkingPartSchema);
  const stateValue = request.modelState?.value;
  const errorDetails = request.result?.errorDetails;
  return {
    index,
    requestId: request.requestId ?? null,
    responseId: meta?.responseId ?? null,
    startedAt,
    endedAt,
    elapsedMs,
    state: stateValue === undefined ? 'unknown' : (TURN_STATES[stateValue] ?? 'unknown'),
    systemInitiated: request.isSystemInitiated === true,
    hidden: request.hiddenFromTranscript === true,
    mode: request.modeInfo?.kind ?? null,
    userText: nonEmpty(request.message?.text),
    assistantText: nonEmpty(assistantText(parts)),
    ...modelRouting(request.modelId ?? null, parts, meta?.resolvedModel ?? null),
    promptTokens: request.promptTokens ?? meta?.promptTokens ?? null,
    completionTokens: request.completionTokens ?? meta?.outputTokens ?? null,
    credits: request.copilotCredits ?? null,
    promptComposition: (request.promptTokenDetails ?? []).map((detail) => ({
      category: detail.category ?? '',
      label: detail.label ?? '',
      percent: detail.percentageOfPrompt ?? null,
    })),
    reasoningBlocks: reasoning.length,
    reasoningMs: reasoning.reduce((sum, block) => sum + (block.reasoningDurationMs ?? 0), 0),
    toolCalls,
    fileEvents: collectFileEvents(parts, toolCalls, request.editedFileEvents ?? []),
    compactions: parseCompactions(meta?.summaries),
    toolRounds: rounds.length,
    toolInputRetries: rounds.reduce((sum, round) => sum + round.toolInputRetry, 0),
    maxToolCallsExceeded: meta?.maxToolCallsExceeded === true,
    errorCode: errorDetails ? (errorDetails.code ?? 'unknown') : null,
    errorMessage: errorDetails?.message ?? null,
  };
}

interface Routing {
  requestedModel: string | null;
  resolvedModel: string | null;
  resolvedModelSource: string;
  selectionMode: SelectionMode;
  selectionSource: SelectionSource;
  modelHost: ModelHost;
}

function modelRouting(
  requestedModel: string | null,
  parts: readonly unknown[],
  metadataModel: string | null,
): Routing {
  const autoResolved =
    parsePartsOfKind(parts, 'autoModeResolution', autoModePartSchema)[0]?.resolved.id ?? null;
  const isAuto = autoResolved !== null || (requestedModel !== null && /(^|\/)auto$/i.test(requestedModel));
  const isManual = !isAuto && requestedModel !== null;
  let resolvedModel: string | null = null;
  let resolvedModelSource = 'unavailable';
  if (autoResolved !== null) {
    resolvedModel = autoResolved;
    resolvedModelSource = 'exact:autoModeResolution';
  } else if (metadataModel !== null && metadataModel !== '') {
    resolvedModel = metadataModel;
    resolvedModelSource = 'exact:result.metadata.resolvedModel';
  } else if (isManual) {
    resolvedModel = modelNameFromId(requestedModel);
    resolvedModelSource = 'derived:modelId';
  }
  return {
    requestedModel,
    resolvedModel,
    resolvedModelSource,
    selectionMode: isAuto ? 'AUTO' : isManual ? 'MANUAL' : 'UNKNOWN',
    selectionSource: isAuto ? 'COPILOT_AUTO' : isManual ? 'USER' : 'UNKNOWN',
    modelHost: modelHost(requestedModel),
  };
}

export function modelHost(modelId: string | null): ModelHost {
  if (!modelId?.includes('/')) return 'unknown';
  return modelId.startsWith('copilot/') ? 'copilot' : 'byok';
}

/** "copilot/gpt-5.6" → "gpt-5.6"; "<vendor>/<provider label>/<model>" → "<model>". */
export function modelNameFromId(modelId: string): string {
  const segments = modelId.split('/');
  if (segments.length === 1) return modelId;
  if (segments[0] === 'copilot' || segments.length === 2) return segments.slice(1).join('/');
  return segments.slice(2).join('/');
}

export function toolFileAction(toolName: string): FileAction {
  if (/delete|remove/i.test(toolName)) return 'deleted';
  if (/create_?file|new_?file/i.test(toolName)) return 'created';
  if (/edit|replace|insert|write|patch|apply/i.test(toolName)) return 'edited';
  return 'read';
}

interface Round {
  toolInputRetry: number;
  calls: { id: string | null; name: string; args: Record<string, unknown> | null }[];
}

function parseRounds(raw: readonly unknown[] | undefined): Round[] {
  return (raw ?? []).flatMap((value) => {
    const round = toolCallRoundSchema.safeParse(value);
    if (!round.success) return [];
    const calls = (round.data.toolCalls ?? []).flatMap((entry) => {
      const call = toolCallSchema.safeParse(entry);
      return call.success
        ? [{ id: call.data.id ?? null, name: call.data.name ?? 'tool', args: parseArgs(call.data.arguments) }]
        : [];
    });
    return [{ toolInputRetry: round.data.toolInputRetry ?? 0, calls }];
  });
}

function parseArgs(raw: unknown): Record<string, unknown> | null {
  if (isRecord(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : { value };
  } catch {
    return { raw };
  }
}

function collectToolCalls(rounds: readonly Round[], parts: readonly unknown[]): ToolCall[] {
  const fromRounds = rounds.flatMap((round) =>
    round.calls.map((call): ToolCall => ({
      callId: call.id,
      name: call.name,
      args: call.args,
      origin: 'toolCallRound',
      status: 'unknown',
    })),
  );
  if (fromRounds.length > 0) return fromRounds;
  // Some builds/agents record only UI invocation parts. Their ids never match toolCallRounds ids, so the
  // two lists are never merged (see docs/copilot-data-formats.md).
  return parsePartsOfKind(parts, 'toolInvocationSerialized', toolInvocationPartSchema).map(
    (invocation): ToolCall => ({
      callId: invocation.toolCallId ?? null,
      name: invocation.toolId ?? 'tool',
      args: null,
      origin: 'invocation',
      status:
        invocation.isComplete === undefined ? 'unknown' : invocation.isComplete ? 'complete' : 'incomplete',
    }),
  );
}

function collectFileEvents(
  parts: readonly unknown[],
  toolCalls: readonly ToolCall[],
  editedFileEvents: readonly EditedFileEvent[],
): FileEvent[] {
  const events: FileEvent[] = [];
  const add = (path: string | null, action: FileAction, source: string): void => {
    if (path === null || path === '') return;
    if (!events.some((event) => event.path === path && event.action === action))
      events.push({ path, action, source });
  };
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part.kind === 'toolInvocationSerialized') {
      const invocation = toolInvocationPartSchema.safeParse(part);
      if (!invocation.success) continue;
      const toolId = invocation.data.toolId ?? 'unknown';
      for (const uri of Object.keys(invocation.data.invocationMessage?.uris ?? {})) {
        add(fileUriToPath(uri), toolFileAction(toolId), `tool:${toolId}`);
      }
    } else if (part.kind === 'textEditGroup' || part.kind === 'codeblockUri') {
      const edit = uriPartSchema.safeParse(part);
      if (edit.success && (part.kind === 'textEditGroup' || edit.data.isEdit === true)) {
        add(edit.data.uri?.fsPath ?? edit.data.uri?.path ?? null, 'edited', part.kind);
      }
    }
  }
  for (const call of toolCalls) {
    const target = call.args?.filePath;
    if (typeof target === 'string') add(target, toolFileAction(call.name), `toolArgs:${call.name}`);
  }
  for (const event of editedFileEvents) {
    const action = event.eventKind === undefined ? undefined : EDIT_EVENT_ACTIONS[event.eventKind];
    if (action !== undefined) add(event.uri?.fsPath ?? event.uri?.path ?? null, action, 'editedFileEvents');
  }
  return events;
}

function parseCompactions(raw: readonly unknown[] | undefined): Compaction[] {
  return (raw ?? []).flatMap((value) => {
    const summary = summarySchema.safeParse(value);
    return summary.success
      ? [
          {
            contextLengthBefore: summary.data.contextLengthBefore ?? null,
            model: summary.data.model ?? null,
            durationMs: summary.data.durationMs ?? null,
            outcome: summary.data.outcome ?? null,
          },
        ]
      : [];
  });
}

function assistantText(parts: readonly unknown[]): string {
  return parts
    .flatMap((part) => {
      if (isRecord(part) && part.kind !== undefined) return [];
      const markdown = markdownPartSchema.safeParse(part);
      return markdown.success ? [markdown.data.value] : [];
    })
    .join('\n');
}

function parsePartsOfKind<T>(
  parts: readonly unknown[],
  kind: string,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
): T[] {
  return parts.flatMap((part) => {
    if (!isRecord(part) || part.kind !== kind) return [];
    const parsed = schema.safeParse(part);
    return parsed.success ? [parsed.data] : [];
  });
}

function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith('file:')) return null;
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : null;
}
