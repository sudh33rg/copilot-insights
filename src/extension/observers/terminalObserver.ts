import * as vscode from 'vscode';
import { recordTerminalRun } from '../../core/outcomes/terminalRecord';
import type { CaptureLevel } from '../../core/privacy/captureLevel';
import type { ObservationStore } from '../../core/storage/observationStore';

/**
 * Records every finished terminal command that VS Code's shell integration reports, through
 * `recordTerminalRun`: only kind, exit code, timing and a salted hash of the redacted command are stored, and
 * nothing command-derived at capture level `metrics`.
 */
export function registerTerminalObserver(
  observations: ObservationStore,
  salt: () => string,
  captureLevel: () => CaptureLevel,
): vscode.Disposable {
  const started = new WeakMap<vscode.TerminalShellExecution, number>();
  return vscode.Disposable.from(
    vscode.window.onDidStartTerminalShellExecution((event) => {
      started.set(event.execution, Date.now());
    }),
    vscode.window.onDidEndTerminalShellExecution((event) => {
      recordTerminalRun(observations, salt(), captureLevel(), {
        command: event.execution.commandLine.value,
        startedAt: started.get(event.execution) ?? null,
        endedAt: Date.now(),
        exitCode: event.exitCode ?? null,
      });
    }),
  );
}
