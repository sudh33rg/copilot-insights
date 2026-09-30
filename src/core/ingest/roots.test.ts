import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixtureUserDir } from '../../../test/fixtures/fixtures';
import { defaultUserDir, resolveStorageRoots, userDirsFromGlobalStorage } from './roots';

describe('roots', () => {
  it('derives user directories from the extension global storage path, including profiles', () => {
    expect(userDirsFromGlobalStorage('/u/User/globalStorage/local.copilot-insights')).toEqual(['/u/User']);
    expect(userDirsFromGlobalStorage('/u/User/profiles/abc/globalStorage/local.copilot-insights')).toEqual([
      '/u/User/profiles/abc',
      '/u/User',
    ]);
  });

  it('knows the default user directory per platform', () => {
    expect(defaultUserDir('Code', 'darwin', {}, '/h')).toBe('/h/Library/Application Support/Code/User');
    expect(defaultUserDir('Code', 'linux', { XDG_CONFIG_HOME: '/x' }, '/h')).toBe('/x/Code/User');
    expect(defaultUserDir('Code - Insiders', 'linux', {}, '/h')).toBe('/h/.config/Code - Insiders/User');
  });

  it('returns only existing, de-duplicated roots', () => {
    const { userDir } = createFixtureUserDir();
    const roots = resolveStorageRoots({
      userDirs: [userDir, userDir],
      extraWorkspaceStorageRoots: [join(userDir, 'workspaceStorage'), '/does/not/exist'],
    });
    expect(roots).toEqual([
      { kind: 'workspaceStorage', dir: join(userDir, 'workspaceStorage') },
      { kind: 'emptyWindow', dir: join(userDir, 'globalStorage', 'emptyWindowChatSessions') },
    ]);
  });
});
