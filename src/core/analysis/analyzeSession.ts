import type { Analysis, SessionDetail } from '../../shared/dto';
import { derived, inferred, unavailable } from '../../shared/provenance';
import { buildOutcome, summarizeChanges } from './changes';
import { estimateComplexity } from './complexity';
import { promptFindings } from './findings';
import { classifyIntent } from './intent';

/** Bump when any rule changes; cached analyses with an older version are recomputed on next read. */
export const ANALYZER_VERSION = 1;

export function analyzeSession(input: Pick<SessionDetail, 'turns'>): Analysis {
  const { turns } = input;
  const userTurns = turns.filter((turn) => !turn.systemInitiated);
  const changes = summarizeChanges(turns);
  const firstPrompt =
    userTurns.find((turn) => turn.userText !== null && turn.userText.trim() !== '')?.userText ?? undefined;
  const intent =
    firstPrompt === undefined
      ? unavailable<string>('no prompt text stored at this capture level')
      : inferred(classifyIntent(firstPrompt).intent, 'keyword rules on the first user prompt');
  return {
    intent,
    outcome: derived(buildOutcome(changes, turns), 'file events, terminal tool calls and turn state'),
    areas: derived(changes.areas, 'parent directories of changed files'),
    complexity: inferred(
      estimateComplexity({
        userTurns: userTurns.length,
        toolCalls: turns.reduce((sum, turn) => sum + turn.toolCalls.length, 0),
        changedFiles: changes.changed.length,
        compactions: turns.reduce((sum, turn) => sum + turn.compactions, 0),
      }),
      'turns + tool calls/5 + changed files + 3 × compactions',
    ),
    commandCount: derived(changes.commandCount, 'tool calls whose name mentions a terminal'),
    findings: promptFindings(turns).map((finding) => ({
      ...finding,
      provenance: { kind: 'inferred', source: 'prompt rules' },
    })),
  };
}
