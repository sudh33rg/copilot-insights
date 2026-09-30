import * as vscode from 'vscode';
import { DEBUG_LOGGING_SETTING, enableDebugLogging, type EnableOutcome } from '../core/telemetry/consent';

export function readDebugLoggingEnabled(): boolean {
  return vscode.workspace
    .getConfiguration(DEBUG_LOGGING_SETTING.section)
    .get<boolean>(DEBUG_LOGGING_SETTING.key, false);
}

/** Command and webview button both end here; the modal is the only way to a "yes". */
export async function runEnableDebugLogging(): Promise<EnableOutcome> {
  const outcome = await enableDebugLogging({
    isEnabled: readDebugLoggingEnabled,
    confirm: async (text) => {
      const choice = await vscode.window.showWarningMessage(
        text.title,
        { modal: true, detail: text.detail },
        text.confirmLabel,
      );
      return choice === text.confirmLabel;
    },
    enable: () =>
      Promise.resolve(
        vscode.workspace
          .getConfiguration(DEBUG_LOGGING_SETTING.section)
          .update(DEBUG_LOGGING_SETTING.key, true, vscode.ConfigurationTarget.Global),
      ),
  });
  if (outcome === 'enabled') {
    void vscode.window.showInformationMessage(
      'Agent debug logging is on. Exact telemetry will appear for new Copilot chat sessions.',
    );
  }
  return outcome;
}
