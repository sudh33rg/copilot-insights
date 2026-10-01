import { z } from 'zod';

// Copilot's formats are undocumented. A field with an unexpected type becomes undefined instead of
// rejecting the whole request; unknown keys pass through and are reported as schema drift.
const str = z.string().optional().catch(undefined);
const num = z.number().optional().catch(undefined);
const bool = z.boolean().optional().catch(undefined);
const list = z.array(z.unknown()).optional().catch(undefined);
const uri = z.looseObject({ fsPath: str, path: str }).optional().catch(undefined);

export const requestSchema = z.looseObject({
  requestId: str,
  timestamp: num,
  message: z.looseObject({ text: str }).optional().catch(undefined),
  modelId: str,
  modeInfo: z.looseObject({ kind: str }).optional().catch(undefined),
  modelState: z.looseObject({ value: num, completedAt: num }).optional().catch(undefined),
  elapsedMs: num,
  promptTokens: num,
  completionTokens: num,
  copilotCredits: num,
  promptTokenDetails: z
    .array(z.looseObject({ category: str, label: str, percentageOfPrompt: num }))
    .optional()
    .catch(undefined),
  variableData: z.looseObject({ variables: list }).optional().catch(undefined),
  editedFileEvents: z
    .array(z.looseObject({ uri, eventKind: num }))
    .optional()
    .catch(undefined),
  isSystemInitiated: bool,
  hiddenFromTranscript: bool,
  response: list,
  result: z
    .looseObject({
      errorDetails: z.looseObject({ code: str, message: str }).optional().catch(undefined),
      timings: z.looseObject({ totalElapsed: num }).optional().catch(undefined),
      metadata: z
        .looseObject({
          responseId: str,
          resolvedModel: str,
          promptTokens: num,
          outputTokens: num,
          maxToolCallsExceeded: bool,
          toolCallRounds: list,
          summaries: list,
        })
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
});
export type ChatRequest = z.infer<typeof requestSchema>;
export type EditedFileEvent = NonNullable<ChatRequest['editedFileEvents']>[number];

export const toolCallRoundSchema = z.looseObject({ id: str, toolInputRetry: num, toolCalls: list });
export const toolCallSchema = z.looseObject({ id: str, name: str, arguments: z.unknown() });
export const summarySchema = z.looseObject({
  contextLengthBefore: num,
  model: str,
  durationMs: num,
  outcome: str,
});

export const markdownPartSchema = z.looseObject({ value: z.string() });
export const autoModePartSchema = z.looseObject({ resolved: z.looseObject({ id: z.string() }) });
export const thinkingPartSchema = z.looseObject({ reasoningDurationMs: num });
export const toolInvocationPartSchema = z.looseObject({
  toolId: str,
  toolCallId: str,
  isComplete: bool,
  invocationMessage: z
    .looseObject({ uris: z.record(z.string(), z.unknown()).optional().catch(undefined) })
    .optional()
    .catch(undefined),
});
export const uriPartSchema = z.looseObject({ uri, isEdit: bool });
