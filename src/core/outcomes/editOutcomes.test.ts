import { describe, expect, it } from 'vitest';
import { attributeEditOutcomes } from './editOutcomes';

const turn = (index: number, model: string | null, ...events: [string, string][]) => ({
  index,
  model,
  fileEvents: events.map(([path, action]) => ({ path, action })),
});

describe('attributeEditOutcomes', () => {
  it('credits a keep/undo/user-modified event to the model that made the latest earlier edit of that file', () => {
    const result = attributeEditOutcomes([
      turn(1, 'gpt-a', ['/r/a.ts', 'edited']),
      turn(2, 'gpt-b', ['/r/a.ts', 'edited']),
      turn(3, 'gpt-c', ['/r/a.ts', 'kept']),
    ]);
    expect(result).toEqual([{ model: 'gpt-b', path: '/r/a.ts', outcome: 'kept', editTurn: 2 }]);
  });
  it('ignores outcome events with no earlier edit in this session', () => {
    expect(attributeEditOutcomes([turn(1, 'gpt-a', ['/r/a.ts', 'undone'])])).toEqual([]);
  });
  it('supports created files and all three outcomes', () => {
    const result = attributeEditOutcomes([
      turn(1, 'm', ['/r/n.ts', 'created'], ['/r/o.ts', 'edited']),
      turn(2, 'm', ['/r/n.ts', 'user-modified'], ['/r/o.ts', 'undone']),
    ]);
    expect(result.map((r) => r.outcome).sort()).toEqual(['undone', 'user-modified']);
  });
});
