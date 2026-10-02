/** Copilot Chat 0.67.0: `github.copilot.chat.agentDebugLog.fileLogging.enabled` (default false). */
export const DEBUG_LOGGING_SETTING = {
  section: 'github.copilot.chat.agentDebugLog.fileLogging',
  key: 'enabled',
} as const;

export interface ConsentText {
  title: string;
  detail: string;
  confirmLabel: string;
}

export function debugLoggingExplanation(): ConsentText {
  return {
    title: 'Turn on Copilot’s agent debug log for exact telemetry?',
    detail:
      'With it on, TraceOn can show cached tokens, per-request latency and Copilot’s own usage figures, ' +
      'and can account for utility requests Copilot makes itself.\n\n' +
      'Copilot writes this log as files on this machine, and the files include your prompts, the messages sent to ' +
      'the model and tool results. TraceOn reads only numbers and identifiers from them and never stores ' +
      'or displays that text. It applies to new chat sessions only, and you can turn it off at any time in the ' +
      'setting github.copilot.chat.agentDebugLog.fileLogging.enabled.',
    confirmLabel: 'Enable',
  };
}

export type EnableOutcome = 'already-enabled' | 'declined' | 'enabled';

export interface EnableDeps {
  isEnabled(): boolean;
  confirm(text: ConsentText): Promise<boolean>;
  enable(): Promise<void>;
}

/** The only path that turns logging on: it asks first and never enables on a decline or a failure. */
export async function enableDebugLogging(deps: EnableDeps): Promise<EnableOutcome> {
  if (deps.isEnabled()) return 'already-enabled';
  if (!(await deps.confirm(debugLoggingExplanation()))) return 'declined';
  await deps.enable();
  return 'enabled';
}
