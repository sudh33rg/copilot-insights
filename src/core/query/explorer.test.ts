import { ClearService } from '../clear/clearService';
import { IngestStateStore } from '../storage/ingestStateStore';
import { LlmCallStore } from '../storage/llmCallStore';
import { getToolAnalytics } from './toolAnalytics';
import { describe, expect, it } from 'vitest';
import { seededStore, loadFixtureSession } from '../../../test/fixtures/sessions';
import { normalizeChatSession } from '../ingest/chatSession';
import { applyCaptureLevel } from '../privacy/captureLevel';
import { SessionLibrary } from '../storage/sessionLibrary';
import { getSessionDetail } from './sessionDetail';
import { listSessions } from './sessionList';

const source = () =>
  normalizeChatSession(
    {
      sessionId: 'inspect',
      requests: [
        {
          timestamp: 1,
          message: { text: 'Investigate files' },
          modelState: { value: 1 },
          variableData: { variables: [{ kind: 'file', name: 'main.ts', value: 'historical snippet' }] },
          result: {
            metadata: {
              toolCallRounds: [{ toolCalls: [{ id: 'read-1', name: 'read_file', arguments: '{}' }] }],
              toolCallResults: {
                'read-1': { content: [{ type: 'text', text: 'historical result', password: 'tiny' }] },
              },
            },
          },
        },
      ],
    },
    { file: '/synthetic/session.json', workspace: 'alpha' },
  );

describe('explorer evidence and local library', () => {
  it('joins results by round call id, redacts before storage and clears new content', () => {
    const { database, sessions } = seededStore();
    const raw = source();
    expect(raw).not.toBeNull();
    if (raw === null) throw new Error('fixture');
    sessions.replaceSession(applyCaptureLevel(raw, 'full'), 'full', 1);
    const detail = getSessionDetail(database, 'inspect');
    expect(detail?.turns[0]?.toolCalls[0]?.output).toContain('historical result');
    expect(detail?.turns[0]?.toolCalls[0]?.output).not.toContain('tiny');
    expect(detail?.turns[0]?.contextItems?.[0]?.content).toContain('historical snippet');
    sessions.clearContent(['inspect']);
    expect(getSessionDetail(database, 'inspect')?.turns[0]?.toolCalls[0]?.output).toBeNull();
    expect(getSessionDetail(database, 'inspect')?.turns[0]?.contextItems).toEqual([]);
  });
  it('searches responses, tool arguments/results and file paths and combines filters', () => {
    const { database, sessions } = seededStore();
    const raw = source();
    if (raw === null) throw new Error('fixture');
    sessions.replaceSession(applyCaptureLevel(raw, 'full'), 'full', 1);
    expect(
      listSessions(database, { q: 'historical result', tool: 'read_file', offset: 0, limit: 50 }).rows.map(
        (r) => r.id,
      ),
    ).toEqual(['inspect']);
    expect(listSessions(database, { tool: 'does-not-exist', offset: 0, limit: 50 }).total).toBe(0);
  });
  it('keeps annotations across rescans, redacts them and removes them on content clearing', () => {
    const { database, sessions } = seededStore();
    const library = new SessionLibrary(database);
    library.save('fx-auto-1', { bookmarked: true, note: 'password=super-secret-value', tags: ['useful'] });
    expect(library.get('fx-auto-1').note).not.toContain('super-secret-value');
    sessions.replaceSession(loadFixtureSession('auto-agent-session.jsonl', 'alpha'), 'full', 2);
    expect(library.get('fx-auto-1').bookmarked).toBe(true);
    expect(listSessions(database, { bookmarkedOnly: true, offset: 0, limit: 50 }).total).toBe(1);
    sessions.clearContent(['fx-auto-1']);
    expect(library.get('fx-auto-1').note).toBe('');
  });
  it('persists saved filters and scopes tool analytics to matching sessions', () => {
    const { database } = seededStore();
    const library = new SessionLibrary(database);
    library.saveView({ id: 'view-1', label: 'Failures', filters: { failedOnly: true, model: 'test' } });
    expect(new SessionLibrary(database).views()[0]?.filters).toEqual({ failedOnly: true, model: 'test' });
    const total = getToolAnalytics(database, { offset: 0, limit: 50 });
    expect(total.tools.length).toBeGreaterThan(0);
    expect(getToolAnalytics(database, { workspace: 'absent', offset: 0, limit: 50 })).toEqual({
      tools: [],
      failures: [],
    });
    library.deleteView('view-1');
    expect(library.views()).toEqual([]);
  });
  it('clears orphan artifacts and rejects stale debug payload writes after clearing', () => {
    const { database, sessions } = seededStore();
    const state = new IngestStateStore(database);
    database.db
      .prepare('INSERT INTO llm_prompt_files (session_id, content) VALUES (?, ?)')
      .run('orphan', 'historical instruction');
    new ClearService(database, sessions, state).clear({ kind: 'allContent' });
    expect(
      database.db.prepare('SELECT content FROM llm_prompt_files WHERE session_id = ?').get('orphan'),
    ).toMatchObject({ content: null });
    const log = {
      sessionId: 'orphan',
      copilotVersion: null,
      vscodeVersion: null,
      systemPromptFile: 'system.json',
      toolsFile: null,
      systemPromptChars: 22,
      toolDefs: null,
      calls: [],
      badLines: 0,
      systemPromptContent: 'stale historical instruction',
    };
    new LlmCallStore(database).replaceSession(log, '/synthetic/debug.jsonl', 3);
    expect(
      database.db.prepare('SELECT content FROM llm_prompt_files WHERE session_id = ?').get('orphan'),
    ).toMatchObject({ content: null });
  });
});
