import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDebugLog } from '../../src/core/debuglog/parseDebugLog';
import { parseModelsJson } from '../../src/core/debuglog/parseModels';
import { normalizeChatSession } from '../../src/core/ingest/chatSession';
import { replayMutationLog } from '../../src/core/ingest/mutationLog';
import type { NormalizedSession } from '../../src/core/ingest/types';
import { applyCaptureLevel, type CaptureLevel } from '../../src/core/privacy/captureLevel';
import { Database } from '../../src/core/storage/database';
import { CatalogStore } from '../../src/core/storage/catalogStore';
import { LlmCallStore } from '../../src/core/storage/llmCallStore';
import { SessionStore } from '../../src/core/storage/sessionStore';
import { DEBUG_LOG_FIXTURES, fixturePath } from './fixtures';

export function loadFixtureSession(
  name: string,
  workspace: string,
  level: CaptureLevel = 'full',
): NormalizedSession {
  const state = replayMutationLog(readFileSync(fixturePath(name), 'utf8')).state;
  const session = normalizeChatSession(state, { file: name, workspace });
  if (session === null) throw new Error(`fixture ${name} failed to normalize`);
  return applyCaptureLevel(session, level);
}

/** A copy of `session` under a new id, shifted in time (for paging and ordering tests). */
export function cloneSession(session: NormalizedSession, id: string, shiftMs: number): NormalizedSession {
  const shift = (value: number | null): number | null => (value === null ? null : value + shiftMs);
  return {
    ...session,
    id,
    startedAt: session.startedAt + shiftMs,
    endedAt: session.endedAt + shiftMs,
    turns: session.turns.map((turn) => ({
      ...turn,
      startedAt: shift(turn.startedAt),
      endedAt: shift(turn.endedAt),
    })),
  };
}

/** In-memory database with `fx-auto-1` (workspace alpha) and `fx-byok-1` (workspace beta). */
export function seededStore(level: CaptureLevel = 'full') {
  const database = new Database(':memory:');
  const sessions = new SessionStore(database);
  sessions.replaceSession(loadFixtureSession('auto-agent-session.jsonl', 'alpha', level), level, 1);
  sessions.replaceSession(loadFixtureSession('byok-failed-session.jsonl', 'beta', level), level, 1);
  new LlmCallStore(database).replaceSession(
    parseDebugLog('fx-auto-1', readFileSync(join(DEBUG_LOG_FIXTURES, 'fx-auto-1', 'main.jsonl'), 'utf8')),
    'fixture',
    1,
  );
  new CatalogStore(database).upsertAll(
    parseModelsJson(readFileSync(join(DEBUG_LOG_FIXTURES, 'fx-auto-1', 'models.json'), 'utf8')),
    1,
  );
  return { database, sessions };
}
