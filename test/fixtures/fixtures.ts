import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Synthetic fixtures that mirror docs/copilot-data-formats.md. Never replace them with real user data. */
export const CHAT_SESSION_FIXTURES = fileURLToPath(new URL('./chatSessions/', import.meta.url));

export function fixturePath(name: string): string {
  return join(CHAT_SESSION_FIXTURES, name);
}

/** Builds a throwaway VS Code `User/` directory laid out like the real one. */
export function createFixtureUserDir(): { userDir: string; globalStorageDir: string } {
  const userDir = join(mkdtempSync(join(tmpdir(), 'ci-user-')), 'User');
  const workspaceDir = join(userDir, 'workspaceStorage', 'ws1');
  mkdirSync(join(workspaceDir, 'chatSessions'), { recursive: true });
  writeFileSync(join(workspaceDir, 'workspace.json'), JSON.stringify({ folder: 'file:///repo/alpha' }));
  copyFileSync(
    fixturePath('auto-agent-session.jsonl'),
    join(workspaceDir, 'chatSessions', 'fx-auto-1.jsonl'),
  );
  copyFileSync(fixturePath('empty-session.jsonl'), join(workspaceDir, 'chatSessions', 'fx-empty-1.jsonl'));
  const emptyWindowDir = join(userDir, 'globalStorage', 'emptyWindowChatSessions');
  mkdirSync(emptyWindowDir, { recursive: true });
  copyFileSync(fixturePath('byok-failed-session.jsonl'), join(emptyWindowDir, 'fx-byok-1.jsonl'));
  const globalStorageDir = join(userDir, 'globalStorage', 'local.copilot-insights');
  mkdirSync(globalStorageDir, { recursive: true });
  return { userDir, globalStorageDir };
}
