import * as vscode from 'vscode';
import { classifyCommand } from '../../core/outcomes/commandKind';
import { commandHash } from '../../core/privacy/fingerprint';
import type { ObservationStore } from '../../core/storage/observationStore';

/**
 * Records every finished terminal command that VS Code's shell integration reports. Only kind, exit code,
 * timing and a salted hash of the redacted command are stored; the command text is never kept.
 */
export function registerTerminalObserver(
  observations: ObservationStore,
  salt: () => string,
): vscode.Disposable {
  const started = new WeakMap<vscode.TerminalShellExecution, number>();
  return vscode.Disposable.from(
    vscode.window.onDidStartTerminalShellExecution((event) => {
      started.set(event.execution, Date.now());
    }),
    vscode.window.onDidEndTerminalShellExecution((event) => {
      const command = event.execution.commandLine.value;
      if (command.trim() === '') return;
      observations.addTerminalRun({
        startedAt: started.get(event.execution) ?? null,
        endedAt: Date.now(),
        exitCode: event.exitCode ?? null,
        kind: classifyCommand(command),
        commandHash: commandHash(salt(), command),
      });
    }),
  );
}
