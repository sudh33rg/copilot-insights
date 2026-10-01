import type { IndexStatus } from '../../shared/protocol';
import type { IngestStateStore } from '../storage/ingestStateStore';
import type { SessionStore } from '../storage/sessionStore';
import { META, type IngestService } from './ingestService';

export function indexStatus(
  service: Pick<IngestService, 'lastResult' | 'lastError'>,
  sessions: SessionStore,
  state: IngestStateStore,
): IndexStatus {
  const lastSyncAt = Number(state.getMeta(META.lastSyncAt));
  return {
    ...sessions.counts(),
    lastSyncAt: Number.isFinite(lastSyncAt) && lastSyncAt > 0 ? lastSyncAt : null,
    role: service.lastResult?.role ?? 'idle',
    lastError: service.lastError,
    captureLevel: 'full',
  };
}
