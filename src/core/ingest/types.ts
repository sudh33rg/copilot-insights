export type TurnState = 'pending' | 'complete' | 'cancelled' | 'failed' | 'unknown';
export type SelectionMode = 'AUTO' | 'MANUAL' | 'UNKNOWN';
/** Who chose the model. COPILOT_INTERNAL (utility models) arrives with debug-log parsing in Phase 3. */
export type SelectionSource = 'COPILOT_AUTO' | 'USER' | 'UNKNOWN';
/** `copilot` = Copilot-hosted (billed in Copilot credits); `byok` = any other provider prefix. */
export type ModelHost = 'copilot' | 'byok' | 'unknown';
export type FileAction = 'read' | 'edited' | 'created' | 'deleted' | 'kept' | 'undone' | 'user-modified';
export type TombstoneKind = 'deleted' | 'content-cleared';

export interface ToolCall {
  callId: string | null;
  name: string;
  args: Record<string, unknown> | null;
  origin: 'toolCallRound' | 'invocation';
  status: 'complete' | 'incomplete' | 'unknown';
}

export interface FileEvent {
  path: string;
  action: FileAction;
  source: string;
}

export interface Compaction {
  contextLengthBefore: number | null;
  model: string | null;
  durationMs: number | null;
  outcome: string | null;
}

export interface PromptShare {
  category: string;
  label: string;
  percent: number | null;
}

export interface NormalizedTurn {
  index: number;
  requestId: string | null;
  responseId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  elapsedMs: number | null;
  state: TurnState;
  systemInitiated: boolean;
  hidden: boolean;
  mode: string | null;
  userText: string | null;
  assistantText: string | null;
  requestedModel: string | null;
  resolvedModel: string | null;
  resolvedModelSource: string;
  selectionMode: SelectionMode;
  selectionSource: SelectionSource;
  modelHost: ModelHost;
  promptTokens: number | null;
  completionTokens: number | null;
  credits: number | null;
  promptComposition: PromptShare[];
  reasoningBlocks: number;
  reasoningMs: number;
  toolCalls: ToolCall[];
  fileEvents: FileEvent[];
  compactions: Compaction[];
  toolRounds: number;
  toolInputRetries: number;
  maxToolCallsExceeded: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface SessionDiagnostics {
  unknownPartKinds: string[];
  unknownRequestKeys: string[];
  invalidRequests: number;
}

export interface NormalizedSession {
  id: string;
  sourceFile: string;
  workspace: string;
  title: string | null;
  location: string | null;
  startedAt: number;
  endedAt: number;
  activeMs: number;
  turns: NormalizedTurn[];
  diagnostics: SessionDiagnostics;
}
