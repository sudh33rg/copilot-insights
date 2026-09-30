/** Counts added/removed lines inside hunks; `+++`/`---` file headers precede the first `@@` and are skipped. */
export function countPatchLines(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (line.startsWith('diff --git')) {
      inHunk = false;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return { added, removed };
}
