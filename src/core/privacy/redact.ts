const PATTERNS: readonly (readonly [name: string, pattern: RegExp])[] = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ['api-key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
];

// `password = "…"`, `apiKey: '…'`, etc. Over-redaction is acceptable; leaking is not.
const ASSIGNMENT =
  /\b((?:api[_-]?key|secret|token|password|passwd|client[_-]?secret)["']?\s*[:=]\s*["']?)([^\s"'`]{8,})/gi;

export function redactSecrets(text: string): string {
  let result = text;
  for (const [name, pattern] of PATTERNS) result = result.replace(pattern, `[REDACTED:${name}]`);
  return result.replace(ASSIGNMENT, (match: string, prefix: string, value: string) =>
    value.startsWith('[REDACTED') ? match : `${prefix}[REDACTED:secret]`,
  );
}

export function redactDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (typeof value !== 'object' || value === null || depth > 32) return value;
  if (Array.isArray(value)) return value.map((item: unknown) => redactDeep(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, depth + 1)]));
}
