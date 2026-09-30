import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Synthetic fixtures that mirror docs/copilot-data-formats.md. Never replace them with real user data. */
export const CHAT_SESSION_FIXTURES = fileURLToPath(new URL('./chatSessions/', import.meta.url));

export function fixturePath(name: string): string {
  return join(CHAT_SESSION_FIXTURES, name);
}
