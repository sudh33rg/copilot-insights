import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, readWorkspaceFile } from './readFile';

const dir = () => mkdtempSync(join(tmpdir(), 'ci-read-'));

describe('readWorkspaceFile', () => {
  it('reads text files', async () => {
    const file = join(dir(), 'a.ts');
    writeFileSync(file, 'hello\n');
    expect(await readWorkspaceFile(file)).toBe('hello\n');
  });

  it('returns null for a file that does not exist', async () => {
    expect(await readWorkspaceFile(join(dir(), 'gone.ts'))).toBeNull();
  });

  it('rejects rather than reporting a missing file when the file is too large to check', async () => {
    const file = join(dir(), 'big.txt');
    writeFileSync(file, 'x'.repeat(MAX_FILE_BYTES + 1));
    await expect(readWorkspaceFile(file)).rejects.toThrow('too large');
  });

  it('rejects when the path cannot be read as a file', async () => {
    await expect(readWorkspaceFile(dir())).rejects.toThrow();
  });
});
