import { createHash, randomBytes } from 'node:crypto';
import { redactSecrets } from './redact';

export const MIN_LINE_CHARS = 20;
export const MAX_FINGERPRINTS_PER_EDIT = 200;

export const newSalt = (): string => randomBytes(16).toString('hex');

/** 16 hex chars of SHA-256(salt \0 text). Not reversible for lines this long; never leaves the machine. */
export function saltedHash(salt: string, text: string): string {
  return createHash('sha256').update(salt).update('\0').update(text).digest('hex').slice(0, 16);
}

export const normalizeCommand = (command: string): string =>
  redactSecrets(command).replace(/\s+/g, ' ').trim();

export const commandHash = (salt: string, command: string): string =>
  saltedHash(salt, normalizeCommand(command));

export function lineFingerprints(salt: string, text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length < MIN_LINE_CHARS) continue;
    seen.add(saltedHash(salt, line));
    if (seen.size >= MAX_FINGERPRINTS_PER_EDIT) break;
  }
  return [...seen];
}
