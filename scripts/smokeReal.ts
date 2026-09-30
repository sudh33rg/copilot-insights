// Parses this machine's real VS Code Copilot chat sessions and prints AGGREGATE COUNTS ONLY.
// It never prints prompts, responses, titles, tool arguments, or file paths.
// Usage: pnpm smoke:real [extra workspaceStorage dirs...]   (VSCODE_PRODUCT="Code - Insiders" for Insiders)
import { normalizeChatSession } from '../src/core/ingest/chatSession';
import { loadChatSessionState } from '../src/core/ingest/mutationLog';
import { defaultUserDir, resolveStorageRoots } from '../src/core/ingest/roots';
import { listChatSessionFiles } from '../src/core/ingest/scanner';
import { isRecord } from '../src/core/json';
import type { NormalizedSession } from '../src/core/ingest/types';
import { checkQueryLayer } from './smokeQueries';

const product = process.env.VSCODE_PRODUCT ?? 'Code';
const roots = resolveStorageRoots({
  userDirs: [defaultUserDir(product)],
  extraWorkspaceStorageRoots: process.argv.slice(2),
});

const totals = {
  roots: roots.length,
  files: 0,
  emptySessions: 0,
  sessions: 0,
  requests: 0,
  turns: 0,
  invalidRequests: 0,
  badLines: 0,
  turnsWithUserText: 0,
  turnsWithAssistantText: 0,
  systemInitiatedTurns: 0,
  promptTokens: 0,
  completionTokens: 0,
  creditTurns: 0,
  credits: 0,
  toolCalls: 0,
  fileEvents: 0,
  compactions: 0,
  readErrors: 0,
};
const byState: Record<string, number> = {};
const byHost: Record<string, number> = {};
const bySelection: Record<string, number> = {};
const byResolvedModelSource: Record<string, number> = {};
const unknownPartKinds: Record<string, number> = {};
const unknownRequestKeys: Record<string, number> = {};
const normalized: NormalizedSession[] = [];
const bump = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

for (const { file, workspace } of listChatSessionFiles(roots)) {
  totals.files++;
  try {
    const { state, badLines } = loadChatSessionState(file);
    totals.badLines += badLines;
    totals.requests += isRecord(state) && Array.isArray(state.requests) ? state.requests.length : 0;
    const session = normalizeChatSession(state, { file, workspace });
    if (session === null) {
      totals.emptySessions++;
      continue;
    }
    totals.sessions++;
    normalized.push(session);
    totals.invalidRequests += session.diagnostics.invalidRequests;
    for (const kind of session.diagnostics.unknownPartKinds) bump(unknownPartKinds, kind);
    for (const key of session.diagnostics.unknownRequestKeys) bump(unknownRequestKeys, key);
    for (const turn of session.turns) {
      totals.turns++;
      if (turn.userText !== null) totals.turnsWithUserText++;
      if (turn.assistantText !== null) totals.turnsWithAssistantText++;
      if (turn.systemInitiated) totals.systemInitiatedTurns++;
      totals.promptTokens += turn.promptTokens ?? 0;
      totals.completionTokens += turn.completionTokens ?? 0;
      if (turn.credits !== null) {
        totals.creditTurns++;
        totals.credits += turn.credits;
      }
      totals.toolCalls += turn.toolCalls.length;
      totals.fileEvents += turn.fileEvents.length;
      totals.compactions += turn.compactions.length;
      bump(byState, turn.state);
      bump(byHost, turn.modelHost);
      bump(bySelection, turn.selectionMode);
      bump(byResolvedModelSource, turn.resolvedModelSource);
    }
  } catch {
    totals.readErrors++;
  }
}

console.log(
  JSON.stringify(
    {
      totals: { ...totals, credits: Number(totals.credits.toFixed(4)) },
      byState,
      byHost,
      bySelection,
      byResolvedModelSource,
      unknownPartKinds,
      unknownRequestKeys,
    },
    null,
    2,
  ),
);

const accounted = totals.turns + totals.invalidRequests;
if (accounted !== totals.requests) {
  console.error(
    `FAIL: ${totals.requests} requests on disk, but ${accounted} turns + invalid requests parsed.`,
  );
  process.exitCode = 1;
} else if (totals.requests > 0 && totals.turnsWithUserText === 0) {
  console.error('FAIL: no user prompt text was recovered.');
  process.exitCode = 1;
} else {
  console.log(`OK: all ${totals.requests} requests became turns.`);
  const failures = checkQueryLayer(normalized);
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
  else console.log('OK: query layer matches parsed totals.');
}
