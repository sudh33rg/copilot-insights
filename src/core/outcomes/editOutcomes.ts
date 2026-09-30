export interface AttributedOutcome {
  model: string | null;
  path: string;
  outcome: 'kept' | 'undone' | 'user-modified';
  editTurn: number;
}
const OUTCOMES = new Set(['kept', 'undone', 'user-modified']);
const EDITS = new Set(['edited', 'created']);

/** Copilot reports what happened to an edit on a *later* request; credit it to the model that made the edit. */
export function attributeEditOutcomes(
  turns: readonly {
    index: number;
    model: string | null;
    fileEvents: readonly { path: string; action: string }[];
  }[],
): AttributedOutcome[] {
  const lastEdit = new Map<string, { model: string | null; turn: number }>();
  const result: AttributedOutcome[] = [];
  for (const turn of [...turns].sort((a, b) => a.index - b.index)) {
    for (const event of turn.fileEvents) {
      if (OUTCOMES.has(event.action)) {
        const edit = lastEdit.get(event.path);
        if (edit !== undefined && edit.turn < turn.index) {
          result.push({
            model: edit.model,
            path: event.path,
            outcome: event.action as AttributedOutcome['outcome'],
            editTurn: edit.turn,
          });
        }
      }
    }
    for (const event of turn.fileEvents) {
      if (EDITS.has(event.action)) lastEdit.set(event.path, { model: turn.model, turn: turn.index });
    }
  }
  return result;
}
