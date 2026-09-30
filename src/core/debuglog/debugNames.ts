import type { DebugRole } from './types';

// Seed table: the `debugName` literals Copilot Chat 0.67.0 passes for its own utility requests. Extend it from
// data (Diagnostics lists every unclassified name) — never from heuristics on prompt content.
const INTERNAL = new Set([
  'title',
  'summarize',
  'summarizeConversationHistory',
  'progressMessages',
  'contextualProgressMessage',
  'promptCategorization',
  'git-branch',
  'healStringReplace',
  'healApplyPatch',
  'modelList',
  'contentExclusion',
  'testSetupAutomaticFrameworkID',
  'setupTestDeriveName',
  'backgroundTodoAgent',
  'nes.nextCursorPosition',
]);

// Agent/chat requests are named `<surface>/<agent>` (observed: `panel/editAgent`).
const USER_FACING = /^(panel|inline)\/.+/;

export function classifyDebugName(name: string | null): DebugRole {
  if (name === null) return 'UNKNOWN';
  if (USER_FACING.test(name)) return 'USER_FACING';
  return INTERNAL.has(name) ? 'COPILOT_INTERNAL' : 'UNKNOWN';
}
