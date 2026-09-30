import { readFileSync } from 'node:fs';

// VS Code persists each chat session as an append-only JSONL mutation log. See docs/copilot-data-formats.md.
//   {kind:0, v}        replace the whole state (initial snapshot)
//   {kind:1, k, v}     set the value at key path k
//   {kind:2, k, v, i?} array at k: truncate to length i (when given), then append the items of v
//   {kind:3, k}        delete the value at key path k (not yet observed in real files)

type PathKey = string | number;
type Container = Record<PathKey, unknown>;

// Keys come from files on disk; never let them reach an object's prototype.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface ReplayResult {
  state: unknown;
  entries: number;
  badLines: number;
}

export function applyMutation(state: unknown, entry: unknown): unknown {
  if (!isContainer(entry)) return state;
  if (entry.kind === 0) return entry.v ?? null;
  const path = entry.k;
  if (!isContainer(state) || !isPath(path)) return state;
  const last = path.at(-1);
  if (last === undefined) return state;
  const parent = parentOf(state, path);
  switch (entry.kind) {
    case 1:
      parent[last] = entry.v;
      break;
    case 2:
      appendItems(parent, last, entry.v, entry.i);
      break;
    case 3:
      removeKey(parent, last);
      break;
    default:
      break;
  }
  return state;
}

export function replayMutationLog(text: string): ReplayResult {
  let state: unknown = null;
  let entries = 0;
  let badLines = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    entries++;
    state = applyMutation(state, entry);
  }
  return { state, entries, badLines };
}

/** Older VS Code builds wrote one JSON snapshot (*.json); newer builds write the JSONL mutation log. */
export function loadChatSessionState(file: string): ReplayResult {
  const text = readFileSync(file, 'utf8');
  if (!/\.json$/i.test(file)) return replayMutationLog(text);
  try {
    return { state: JSON.parse(text) as unknown, entries: 1, badLines: 0 };
  } catch {
    return { state: null, entries: 0, badLines: 1 };
  }
}

function isContainer(value: unknown): value is Container {
  return typeof value === 'object' && value !== null;
}

function isPath(value: unknown): value is PathKey[] {
  return Array.isArray(value) && value.length > 0 && value.every(isPathKey);
}

function isPathKey(key: unknown): key is PathKey {
  if (typeof key === 'string') return !FORBIDDEN_KEYS.has(key);
  return typeof key === 'number' && Number.isInteger(key) && key >= 0;
}

function parentOf(root: Container, path: readonly PathKey[]): Container {
  let node = root;
  const parents = path.slice(0, -1);
  for (const [index, key] of parents.entries()) {
    const next = node[key];
    if (isContainer(next)) {
      node = next;
      continue;
    }
    const created = (typeof path[index + 1] === 'number' ? [] : {}) as Container;
    node[key] = created;
    node = created;
  }
  return node;
}

function appendItems(parent: Container, key: PathKey, items: unknown, truncateTo: unknown): void {
  const current = parent[key];
  const array: unknown[] = Array.isArray(current) ? current : [];
  parent[key] = array;
  if (
    typeof truncateTo === 'number' &&
    Number.isInteger(truncateTo) &&
    truncateTo >= 0 &&
    truncateTo < array.length
  ) {
    array.length = truncateTo;
  }
  // Push one by one: spreading a 100k-item array into push() overflows the call stack.
  if (Array.isArray(items)) for (const item of items) array.push(item);
}

function removeKey(parent: Container, key: PathKey): void {
  if (Array.isArray(parent) && typeof key === 'number') parent.splice(key, 1);
  else Reflect.deleteProperty(parent, key);
}
