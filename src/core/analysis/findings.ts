import type { TurnDetail } from '../../shared/dto';

export interface Finding {
  id: string;
  message: string;
  evidence: string;
}

export const CORRECTION = /^\s*(no|nope|wrong|that'?s (?:not|wrong)|still|again|actually|instead|don'?t)\b/i;

/**
 * Prompt-quality findings. Text rules need stored prompt text (skipped when there is none); the failure rule
 * uses turn state only. System-initiated turns (Copilot's own follow-ups) never count as user prompts.
 */
export function promptFindings(turns: readonly TurnDetail[]): Finding[] {
  const findings: Finding[] = [];
  const userTurns = turns.filter((turn) => !turn.systemInitiated);
  const withText = userTurns.filter((turn) => turn.userText !== null && turn.userText.trim() !== '');

  const first = withText[0]?.userText?.trim();
  if (first !== undefined && first.length < 25) {
    findings.push({
      id: 'vague-first-prompt',
      message:
        'The opening prompt was very short. Stating the goal, the files involved and how you will judge success up front usually saves follow-up turns.',
      evidence: `opening prompt is ${String(first.length)} characters`,
    });
  }

  const corrections = withText.slice(1).filter((turn) => CORRECTION.test(turn.userText ?? ''));
  if (corrections.length >= 2) {
    findings.push({
      id: 'repeated-corrections',
      message:
        'Several follow-ups corrected the previous answer. Restating the requirement in one message may converge faster.',
      evidence: `${String(corrections.length)} follow-up prompts read as corrections (turns ${corrections.map((turn) => String(turn.index)).join(', ')})`,
    });
  }

  const compactions = turns.reduce((sum, turn) => sum + (turn.compactions.value ?? 0), 0);
  if (userTurns.length >= 12 || compactions >= 2) {
    findings.push({
      id: 'long-session',
      message:
        'Long sessions carry a growing context. Starting a fresh session for the next task usually costs less.',
      evidence: `${String(userTurns.length)} user turns, ${String(compactions)} context compactions`,
    });
  }

  const failed = userTurns.filter((turn) => turn.state === 'failed').length;
  if (failed >= 2) {
    findings.push({
      id: 'repeated-failures',
      message: 'Several turns failed. Check the model/provider and the error codes on those turns.',
      evidence: `${String(failed)} of ${String(userTurns.length)} turns failed`,
    });
  }
  return findings;
}
