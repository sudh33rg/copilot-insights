import type { ClearScope } from '../../shared/dto';
import { deletesSessions } from './clearService';

const sessionsOf = (count: number): string => `${String(count)} session${count === 1 ? '' : 's'}`;

const REASSURE = "Only TraceOn' own index is affected; Copilot's own chat history is not touched.";

/** Confirmation-dialog wording, shared by every entry point so the promise is identical everywhere. */
export function describeScope(
  scope: ClearScope,
  count: number,
): { title: string; detail: string; confirmLabel: string; destructive: boolean } {
  const destructive = deletesSessions(scope);
  const title = ((): string => {
    switch (scope.kind) {
      case 'session':
        return 'Delete this session from TraceOn?';
      case 'sessionContent':
        return 'Clear conversation text from this session?';
      case 'beforeDay':
        return `Delete ${sessionsOf(count)} from before ${scope.day}?`;
      case 'workspace':
        return `Delete ${sessionsOf(count)} from workspace "${scope.workspace}"?`;
      case 'everything':
        return `Delete all ${sessionsOf(count)} from TraceOn?`;
      case 'allContent':
        return `Clear conversation text from ${sessionsOf(count)}?`;
    }
  })();
  const detail = destructive
    ? `${REASSURE} Deleted sessions will not be re-imported.`
    : `${REASSURE} Tokens, credits, models and file paths are kept; prompts, responses, titles, tool arguments/results, context values, debug artifacts, notes and tags are removed. Bookmarks are kept.`;
  return {
    title,
    detail,
    confirmLabel: destructive ? (scope.kind === 'session' ? 'Delete session' : 'Delete') : 'Clear text',
    destructive,
  };
}
