import { commandHash } from '../privacy/fingerprint';
import type { CaptureLevel } from '../privacy/captureLevel';
import type { ObservationStore } from '../storage/observationStore';
import { classifyCommand } from './commandKind';

export interface FinishedCommand {
  command: string;
  startedAt: number | null;
  endedAt: number;
  exitCode: number | null;
}

/**
 * Stores a finished terminal command as kind, exit code, timing and a salted hash of the redacted command; the
 * text is never kept. At capture level `metrics` nothing derived from the command is kept either (no hash, and
 * so no kind), only that a command finished and how. Returns whether a run was recorded.
 */
export function recordTerminalRun(
  observations: ObservationStore,
  salt: string,
  captureLevel: CaptureLevel,
  finished: FinishedCommand,
): boolean {
  if (finished.command.trim() === '') return false;
  const keepDerived = captureLevel !== 'metrics';
  observations.addTerminalRun({
    startedAt: finished.startedAt,
    endedAt: finished.endedAt,
    exitCode: finished.exitCode,
    kind: keepDerived ? classifyCommand(finished.command) : 'other',
    commandHash: keepDerived ? commandHash(salt, finished.command) : '',
  });
  return true;
}
