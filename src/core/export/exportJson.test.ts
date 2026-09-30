import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { exportIndex } from './exportJson';

describe('exportIndex', () => {
  it('exports every session with provenance-tagged measurements and no tool arguments', () => {
    const doc = exportIndex(seededStore().database, 1790000000000);
    expect(doc).toMatchObject({ format: 'copilot-insights-export', version: 1 });
    expect(doc.exportedAt).toBe(new Date(1790000000000).toISOString());
    expect(doc.sessions.map((session) => session.id).sort()).toEqual(['fx-auto-1', 'fx-byok-1']);
    expect(doc.sessions[0]?.turns[0]?.inputTokens.provenance).toBeDefined();
    expect(JSON.stringify(doc)).not.toContain('"args"');
  });

  it('respects the stored capture level: no text at metrics', () => {
    const doc = exportIndex(seededStore('metrics').database, 1);
    expect(doc.sessions.every((session) => session.turns.every((turn) => turn.userText === null))).toBe(true);
  });

  it('is an empty document for an empty index', () => {
    const { database } = seededStore();
    database.db.exec('DELETE FROM sessions');
    expect(exportIndex(database, 1).sessions).toEqual([]);
  });
});
