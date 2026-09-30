import { readFile, stat } from 'node:fs/promises';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * File text for survival checks. `null` means the file is gone (a real outcome: the edit did not survive);
 * anything that stops us from knowing (too large, unreadable) rejects so the check is retried, not misreported.
 */
export async function readWorkspaceFile(path: string): Promise<string | null> {
  try {
    const { size } = await stat(path);
    if (size > MAX_FILE_BYTES) throw new Error('file is too large to check');
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
