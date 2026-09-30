import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export interface StorageRoot {
  readonly kind: 'workspaceStorage' | 'emptyWindow';
  readonly dir: string;
}

/**
 * The extension's globalStorage is `<User>/globalStorage/<id>` or, with profiles,
 * `<User>/profiles/<profile>/globalStorage/<id>`; workspaceStorage stays under `<User>`.
 */
export function userDirsFromGlobalStorage(globalStorageDir: string): string[] {
  const owner = resolve(globalStorageDir, '..', '..');
  const dirs = [owner];
  if (basename(dirname(owner)) === 'profiles') dirs.push(resolve(owner, '..', '..'));
  return dirs;
}

/** Used only outside VS Code (the smoke script). Inside VS Code, derive from the extension's storage. */
export function defaultUserDir(
  product = 'Code',
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), product, 'User');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', product, 'User');
  return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), product, 'User');
}

export function resolveStorageRoots(options: {
  userDirs: readonly string[];
  extraWorkspaceStorageRoots?: readonly string[];
}): StorageRoot[] {
  const candidates: StorageRoot[] = [
    ...(options.extraWorkspaceStorageRoots ?? []).map((dir) => ({
      kind: 'workspaceStorage' as const,
      dir: resolve(dir),
    })),
    ...options.userDirs.flatMap((userDir) => [
      { kind: 'workspaceStorage' as const, dir: join(userDir, 'workspaceStorage') },
      { kind: 'emptyWindow' as const, dir: join(userDir, 'globalStorage', 'emptyWindowChatSessions') },
    ]),
  ];
  const seen = new Set<string>();
  return candidates.filter((root) => {
    const key = `${root.kind}:${root.dir}`;
    if (seen.has(key) || !isDirectory(root.dir)) return false;
    seen.add(key);
    return true;
  });
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
