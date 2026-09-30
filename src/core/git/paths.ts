/** Whether `path` is `root` or lies below it (either separator; a trailing separator on `root` is fine). */
export function isWithin(path: string, root: string): boolean {
  const base = root.length > 1 ? root.replace(/[\\/]+$/, '') : root;
  if (path === base) return true;
  if (base === '/' || base === '\\') return path.startsWith(base);
  return path.startsWith(`${base}/`) || path.startsWith(`${base}\\`);
}

/** Whether one path contains the other. */
export const pathsRelated = (a: string, b: string): boolean => isWithin(a, b) || isWithin(b, a);
