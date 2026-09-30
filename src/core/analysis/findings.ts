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
  const underspecified = isUnderspecifiedStart(first, userTurns.length);
  if (first !== undefined && underspecified) {
    findings.push({
      id: 'underspecified-start',
      message:
        'The opening prompt did not say which files were involved or how to judge success, and the session needed several turns. Stating both up front usually saves follow-up turns.',
      evidence: `opening prompt names no file and states no success condition; the session took ${String(userTurns.length)} user turns`,
    });
  } else if (first !== undefined && first.length < 25) {
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

  const late = lateConstraints(withText);
  if (late !== null) findings.push(late);

  const drift = sessionDrift(turns);
  if (drift !== null) findings.push(drift);

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

const FILE_REFERENCE = /[\w./-]+\.[a-z]{1,5}\b|`[^`]+`|#file:/i;
const ACCEPTANCE_CUE = /\b(should|must|expect|so that|when|until|passes?|returns?)\b/i;
const CONSTRAINT = /\b(must|only|never|don'?t|do not|without|make sure|ensure|instead of)\b/gi;
const MIN_UNDERSPECIFIED_TURNS = 3;
const MIN_LATE_TURN_ORDINAL = 3;
const MIN_DRIFT_EVENTS = 6;

function isUnderspecifiedStart(first: string | undefined, userTurns: number): boolean {
  return (
    first !== undefined &&
    userTurns >= MIN_UNDERSPECIFIED_TURNS &&
    !FILE_REFERENCE.test(first) &&
    !ACCEPTANCE_CUE.test(first)
  );
}

const constraintWords = (text: string): string[] => [
  ...new Set([...text.matchAll(CONSTRAINT)].map((match) => match[0].toLowerCase())),
];

/** A requirement that first appears after the third user prompt arrived late; needs stored prompt text. */
function lateConstraints(withText: readonly TurnDetail[]): Finding | null {
  const first = withText[0]?.userText ?? '';
  if (constraintWords(first).length > 0) return null;
  for (const [position, turn] of withText.entries()) {
    if (position + 1 < MIN_LATE_TURN_ORDINAL) continue;
    const words = constraintWords(turn.userText ?? '').slice(0, 3);
    if (words.length === 0) continue;
    return {
      id: 'late-constraints',
      message:
        'Requirements arrived after the work was underway. Stating constraints in the opening prompt usually avoids rework.',
      evidence: `constraints first appeared on turn ${String(turn.index)} (${words.map((word) => `"${word}"`).join(', ')})`,
    };
  }
  return null;
}

const dirOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, '');
const dirName = (dir: string): string => `${dir.split(/[\\/]/).filter(Boolean).pop() ?? dir}/`;
const TOUCHED = new Set(['read', 'edited', 'created', 'deleted']);

/** Early and late turns touched disjoint directories: a sign the session moved to a different topic. */
function sessionDrift(turns: readonly TurnDetail[]): Finding | null {
  const ordered = [...turns].sort((a, b) => a.index - b.index);
  const events = ordered.flatMap((turn) => turn.fileEvents.filter((event) => TOUCHED.has(event.action)));
  if (ordered.length < 2 || events.length < MIN_DRIFT_EVENTS) return null;
  const half = Math.floor(ordered.length / 2);
  const files = (part: readonly TurnDetail[]) => [
    ...new Set(
      part.flatMap((turn) =>
        turn.fileEvents.filter((event) => TOUCHED.has(event.action)).map((event) => event.path),
      ),
    ),
  ];
  const early = files(ordered.slice(0, half));
  const late = files(ordered.slice(half));
  if (early.length < 2 || late.length < 2) return null;
  const earlyDirs = new Set(early.map(dirOf));
  const lateDirs = new Set(late.map(dirOf));
  if ([...earlyDirs].some((dir) => lateDirs.has(dir))) return null;
  const names = (dirs: Set<string>) => [...new Set([...dirs].map(dirName))].sort().slice(0, 3).join(', ');
  return {
    id: 'drift',
    message:
      'The session moved into unrelated areas. Starting a separate session for the new topic may keep context smaller.',
    evidence: `early turns touched ${names(earlyDirs)}; later turns touched ${names(lateDirs)}`,
  };
}
