import type { Analysis, SessionDetail } from '../../shared/dto';
import { derived, inferred, unavailable, weakest } from '../../shared/provenance';
import { buildOutcomeSentence } from '../outcomes/outcomeSentence';
import { classifyTask, isTestPath } from '../outcomes/taskType';
import { summarizeChanges } from './changes';
import { estimateComplexity } from './complexity';
import { promptFindings } from './findings';
import { classifyIntent } from './intent';

/** Bump when any rule changes; cached analyses with an older version are recomputed on next read. */
export const ANALYZER_VERSION = 3;

export function analyzeSession(input: Pick<SessionDetail, 'turns' | 'outcomes'>): Analysis {
  const { turns, outcomes } = input;
  const userTurns = turns.filter((turn) => !turn.systemInitiated);
  const changes = summarizeChanges(turns);
  const firstPrompt =
    userTurns.find((turn) => turn.userText !== null && turn.userText.trim() !== '')?.userText ?? undefined;
  const promptIntent = firstPrompt === undefined ? null : classifyIntent(firstPrompt).intent;
  const intent =
    promptIntent === null
      ? unavailable<string>('no prompt text stored at this capture level')
      : inferred(promptIntent, 'keyword rules on the first user prompt');
  const task = classifyTask({
    intent: promptIntent,
    changed: changes.changed,
    commandCount: changes.commandCount,
  });
  const taskType =
    task.basis === 'prompt' ? inferred<string>(task.type, task.rule) : derived<string>(task.type, task.rule);
  const sentence = buildOutcomeSentence({
    taskType: task.type,
    changed: changes.changed,
    areas: changes.areas,
    linesAdded: outcomes.linesAdded.value,
    linesRemoved: outcomes.linesRemoved.value,
    testFilesCreated: changes.changed.filter((file) => file.action === 'created' && isTestPath(file.path))
      .length,
    testsPassed: outcomes.lastTestPassed.value,
    testFailures: outcomes.testFailures.value,
    errorsDelta: outcomes.errorsDelta.value,
    undone: changes.undone,
    failedTurns: userTurns.filter((turn) => turn.state === 'failed').length,
    userTurns: userTurns.length,
  });
  return {
    intent,
    taskType,
    // The sentence contains the task label, so it is never stronger than how that label was decided.
    outcome: {
      value: sentence,
      provenance: {
        kind: weakest('derived', taskType.provenance.kind),
        source: 'file events, git snapshots, terminal runs, diagnostics and turn state',
      },
    },
    areas: derived(changes.areas, 'parent directories of changed files'),
    complexity: inferred(
      estimateComplexity({
        userTurns: userTurns.length,
        toolCalls: turns.reduce((sum, turn) => sum + turn.toolCalls.length, 0),
        changedFiles: changes.changed.length,
        compactions: turns.reduce((sum, turn) => sum + (turn.compactions.value ?? 0), 0),
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
