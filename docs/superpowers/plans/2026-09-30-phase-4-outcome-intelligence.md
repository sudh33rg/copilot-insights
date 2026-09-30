# Phase 4: Outcome Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.
>
> **Git rule (overrides every skill):** work directly on `main`. Do not create branches, worktrees, or pull
> requests. Commit after each task. Do not push unless the user asks.

**Goal:** Answer "did the session actually work?" — lines changed, whether Copilot's edits survived, terminal and
test exit codes, diagnostics before/after, a deterministic task type and outcome sentence, and the commits a
session led to (with cost per commit) — without ever storing prompt, code, or command text.

**Architecture:** Two kinds of evidence. (1) _Retrospective_, from Copilot's own files, parsed in the scan worker
(edit keep/undo/modify events, salted line fingerprints of inserted text, salted command hashes of terminal tool
calls). (2) _Live_, observed by the extension host while VS Code is running (git snapshots, diagnostics,
terminal exit codes, later survival checks, commit lists). All live observation goes through small **ports**
(`GitPort`, `DiagnosticsPort`, `FilePort`) so the logic lives in `src/core` and is unit-tested with fakes;
`src/extension` only implements the ports on top of `vscode`. Observations are stored in tables that
deliberately have **no foreign key to `sessions`** (a rescan deletes and re-inserts the session row) and are
cleaned up explicitly by clear/retention. Everything new surfaces as `Measured<T>` with honest provenance.

**Tech Stack:** unchanged (TypeScript 6.0 strict, React 19, TanStack Query, zod 4, `node:sqlite`, Vitest,
`vscode.git` API).

**Spec:** `docs/PRODUCT_VISION.md` §2 (coding outcome summaries), §7 (provenance); `docs/ROADMAP.md` Phase 4
table (tasks 4.1–4.6); `docs/copilot-data-formats.md` (`editedFileEvents`, `textEditGroup`); `CLAUDE.md`.
Interfaces come from the Phase 0–3 code on `main` (HEAD `49ed1f3`).

**Dry-run status:** not dry-run. Written against the real Phase 0–3 sources. Where execution proves a block
wrong, fold the fix back into this file.

## Design decisions (made here; flag to the owner if any is wrong)

- **D-P4-1 Live-only evidence is honest about gaps.** Git/diagnostics/terminal evidence exists only if VS Code was
  running with this extension while the session happened. Otherwise the field is `unavailable` — never zero.
- **D-P4-2 Line counts are `derived`, not `exact`.** They are the change in the git working-tree diff between the
  first and latest observation of the session. User edits made meanwhile are included, and a HEAD change between
  snapshots makes the value `unavailable` (commit linking covers that case).
- **D-P4-3 Later survival needs content-derived fingerprints.** To check "is Copilot's inserted text still
  there?" without storing code, the worker stores **salted SHA-256 fingerprints (truncated to 16 hex chars) of
  inserted lines** ≥ 20 non-space characters (max 200 per edit). The salt is random per install
  (`meta` key `privacy.salt`), never leaves the machine, and the fingerprints are dropped at capture level
  `metrics`, on content clear, and on "clear everything". Terminal commands are likewise stored only as a
  salted hash of the _redacted_, whitespace-collapsed command. **This is the one place Phase 4 touches
  content-derived data; document it in `docs/copilot-data-formats.md` and the README privacy section.**
- **D-P4-4 Cost per commit is an even split.** A session's exact credits are divided evenly across the commits it
  links to and labelled `derived` (this is a per-session allocation of _Copilot's own per-request credits_, not a
  division of GitHub daily/account credits, so it does not break the CLAUDE.md rule). Sessions with unavailable
  credits make the commit total a `≥` lower bound.
- **D-P4-5 No new network calls, no AI calls, no CLI spawning.** Git access is only through the built-in
  `vscode.git` extension API.

## Global Constraints

- Work on `main` only; one Conventional Commit per task; never push without being asked.
- Before every commit: `pnpm format && pnpm verify` must pass. Run `pnpm test:integration` after Tasks 4.1 and
  4.7, and `pnpm smoke:real` after Tasks 4.0 and 4.7.
- Layering (ESLint-enforced): `shared` → nothing environment-specific; `core` → `node:*`, `zod`, `shared`;
  `extension` → `vscode`, `core`, `shared`; `webview` → `react`, browser, `shared`.
- TDD: failing test first, watch it fail, implement, watch it pass, commit.
- Never log, print, or store prompt/response/code/command text. Only counts, paths, hashes and timestamps are
  stored. Test fixtures are synthetic; use `SECRET-…` sentinels in any content field a test feeds through and
  assert the sentinel never appears in the database (`SELECT * FROM <table>` JSON-stringified).
- Every user-visible number is a `Measured<T>` (`src/shared/provenance.ts`); update `ALLOWED` in
  `src/shared/dto.provenance.test.ts` only for genuine index facts (ordinals, timestamps, counts of rows).
- Migrations are append-only: add index 5 (→ `user_version` 6); never edit shipped ones.
- Bump `INGEST_VERSION` (Task 4.0) so existing indexes are re-parsed once.

## Review Focus

Failure modes the roadmap implies but no single task's happy path exercises (each has a test in its owning task):

1. Session with **no git repo / git extension unavailable** → outcome fields `unavailable`, never `0` (Task 4.1).
2. **HEAD moved between snapshots** (user committed mid-session) → lines `unavailable`, not a wrong number (4.1).
3. **File deleted or renamed** when a survival check runs → present = 0 of total, not an exception (4.2).
4. **Terminal shell integration missing** (`exitCode` undefined) and command lines containing secrets → exit code
   `null`, hash computed on the redacted command, nothing readable stored (4.3).
5. **Rescan of a session** (`replaceSession`) must not lose live observations, and **clear/retention/`metrics`
   downgrade** must remove them (4.0).

---

## File Structure

| File                                                                                       | Responsibility                                                       |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `src/core/storage/migrations.ts` (modify)                                                  | Migration index 5: observation tables, `command_hash`, `observed_at` |
| `src/core/privacy/fingerprint.ts` (+test)                                                  | Salt, salted hashes, line fingerprints, command normalization        |
| `src/core/storage/observationStore.ts` (+test)                                             | CRUD for snapshots, terminal runs, survival checks, session commits  |
| `src/core/git/types.ts`                                                                    | `GitPort`, `GitRepo`, `FileNumstat`, `GitCommit`                     |
| `src/core/git/numstat.ts` (+test)                                                          | Count added/removed lines in a unified patch                         |
| `src/core/git/snapshots.ts` (+test)                                                        | `takeSnapshot`, `diffSnapshots`                                      |
| `src/core/outcomes/editOutcomes.ts` (+test)                                                | Attribute keep/undo/user-modified events to the editing turn's model |
| `src/core/outcomes/survival.ts` (+test)                                                    | `SurvivalChecker`: fingerprint presence at +1h / +1d / next commit   |
| `src/core/outcomes/commandKind.ts` (+test)                                                 | `classifyCommand` (test/build/lint/other)                            |
| `src/core/outcomes/terminalMatch.ts` (+test)                                               | Match terminal runs to tool calls / system-initiated turns           |
| `src/core/outcomes/diagnosticsDelta.ts` (+test)                                            | Error/warning delta for edited files                                 |
| `src/core/outcomes/taskType.ts` (+test)                                                    | Deterministic task taxonomy                                          |
| `src/core/outcomes/outcomeSentence.ts` (+test)                                             | Outcome sentence v2 (golden tests)                                   |
| `src/core/outcomes/commitLink.ts` (+test)                                                  | Link sessions to commits; cost per commit                            |
| `src/core/query/sessionOutcomes.ts` (+test)                                                | Build the `outcomes` DTO from stored observations                    |
| `src/core/query/commitCosts.ts`, `survivalByModel.ts` (+tests)                             | Overview-level queries                                               |
| `src/extension/observers/{gitAdapter,diagnosticsAdapter,terminalObserver,liveObserver}.ts` | vscode glue                                                          |
| `test/integration/outcomes.test.ts`                                                        | Real VS Code + temp git repo                                         |

Modified: `src/core/ingest/{chatSession,types,scanner,ingestService}.ts`, `src/core/storage/sessionStore.ts`,
`src/core/clear/clearService.ts`, `src/core/analysis/{analyzeSession,analysisStore,changes}.ts`,
`src/core/query/{sessionDetail,insightsQueries}.ts`, `src/shared/{dto,protocol}.ts`,
`src/extension/extension.ts`, webview views, docs.

---

### Task 4.0: Foundations — schema, salt, fingerprints, worker extraction, cleanup

**Files:**

- Modify: `src/core/storage/migrations.ts`, `src/core/ingest/types.ts`, `src/core/ingest/chatSession.ts`,
  `src/core/ingest/scanner.ts`, `src/core/ingest/ingestService.ts`, `src/core/ingest/runScan.ts` (only if it
  builds `ScanInput`), `src/core/storage/sessionStore.ts`, `src/core/clear/clearService.ts`,
  `src/core/analysis/analysisStore.ts`, `src/core/privacy/captureLevel.ts`
- Create: `src/core/privacy/fingerprint.ts`, `src/core/privacy/fingerprint.test.ts`,
  `src/core/storage/observationStore.ts`, `src/core/storage/observationStore.test.ts`
- Test: also `src/core/ingest/chatSession.test.ts`, `src/core/storage/sessionStore.test.ts`,
  `src/core/clear/clearService.test.ts`, `src/core/analysis/analysisStore.test.ts`

**Interfaces:**

- Produces (`fingerprint.ts`):
  `newSalt(): string`, `saltedHash(salt: string, text: string): string`,
  `normalizeCommand(command: string): string`, `commandHash(salt: string, command: string): string`,
  `lineFingerprints(salt: string, text: string): string[]`,
  constants `MIN_LINE_CHARS = 20`, `MAX_FINGERPRINTS_PER_EDIT = 200`.
- Produces (types): `ToolCall.commandHash: string | null`;
  `NormalizedTurn.editFingerprints: { path: string; hashes: string[] }[]`; `ScanInput.salt?: string`;
  `NormalizeContext.salt?: string`.
- Produces (`ObservationStore`, constructor `(database: Database)`):
  - `touch(now: number): void` / `lastChangeAt(): number` (meta key `observation.lastChangeAt`)
  - `saveSnapshot(s: SnapshotInput): void`, `getSnapshots(sessionId: string, kind: 'start' | 'latest'): StoredSnapshot[]`
  - `saveDiagnostics(sessionId, kind, entries: DiagEntry[]): void`, `getDiagnostics(sessionId, kind): DiagEntry[]`
  - `addTerminalRun(run: TerminalRun): void`, `terminalRunsBetween(fromMs: number, toMs: number): TerminalRun[]`
  - `saveSurvivalCheck(c: SurvivalCheck): void`, `survivalChecks(sessionId: string): SurvivalCheck[]`
  - `replaceSessionCommits(sessionId: string, links: SessionCommit[]): void`, `sessionCommits(sessionId): SessionCommit[]`
  - `deleteSessions(ids: readonly string[]): void`, `deleteAll(): void`, `pruneBefore(ms: number): void`
  - types: `SnapshotInput = { sessionId; kind; repoRoot: string; head: string | null; takenAt: number; files: { path; added; removed }[] }`,
    `StoredSnapshot = Omit<SnapshotInput,'sessionId'|'kind'>`, `DiagEntry = { path; errors; warnings }`,
    `TerminalRun = { startedAt: number | null; endedAt: number; exitCode: number | null; kind: 'test'|'build'|'lint'|'other'; commandHash: string }`,
    `SurvivalCheck = { sessionId; turnIdx; path; checkKind: '1h'|'1d'|'commit'; checkedAt; present; total }`,
    `SessionCommit = { hash; committedAt; overlapFiles; editedFiles; linkedAt }`.

- [ ] **Step 1: Failing tests for fingerprints**

`src/core/privacy/fingerprint.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_FINGERPRINTS_PER_EDIT,
  commandHash,
  lineFingerprints,
  newSalt,
  normalizeCommand,
  saltedHash,
} from './fingerprint';

describe('fingerprint', () => {
  it('produces distinct salts', () => {
    expect(newSalt()).not.toEqual(newSalt());
    expect(newSalt()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('hashes deterministically per salt and never contains the input', () => {
    const hash = saltedHash('s1', 'const answer = computeTheAnswer();');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(saltedHash('s1', 'const answer = computeTheAnswer();')).toBe(hash);
    expect(saltedHash('s2', 'const answer = computeTheAnswer();')).not.toBe(hash);
  });

  it('fingerprints only substantial, unique, trimmed lines', () => {
    const text = [
      '  short  ',
      '    const value = computeSomethingLong();  ',
      'const value = computeSomethingLong();',
      '',
    ].join('\n');
    const prints = lineFingerprints('s', text);
    expect(prints).toEqual([saltedHash('s', 'const value = computeSomethingLong();')]);
  });

  it('caps the number of fingerprints per edit', () => {
    const text = Array.from(
      { length: 500 },
      (_, i) => `const generated_${String(i)} = something_long_enough;`,
    ).join('\n');
    expect(lineFingerprints('s', text)).toHaveLength(MAX_FINGERPRINTS_PER_EDIT);
  });

  it('normalizes commands (redacts secrets, collapses whitespace) before hashing', () => {
    const a = normalizeCommand('  curl   -H "token=ghp_' + 'a'.repeat(36) + '"  https://x  ');
    expect(a).not.toContain('ghp_');
    expect(commandHash('s', 'pnpm   test')).toBe(commandHash('s', ' pnpm test '));
    expect(commandHash('s', 'pnpm test')).not.toBe(commandHash('s', 'pnpm build'));
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run src/core/privacy/fingerprint.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/core/privacy/fingerprint.ts`**

```ts
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
```

- [ ] **Step 4: Run** — same command → PASS.

- [ ] **Step 5: Append migration** to `MIGRATIONS` in `src/core/storage/migrations.ts` (new last element):

```sql
ALTER TABLE tool_calls ADD COLUMN command_hash TEXT;
ALTER TABLE session_analysis ADD COLUMN observed_at INTEGER NOT NULL DEFAULT 0;

CREATE TABLE edit_fingerprints (
  session_id TEXT NOT NULL,
  turn_idx INTEGER NOT NULL,
  path TEXT NOT NULL,
  hashes TEXT NOT NULL,
  PRIMARY KEY (session_id, turn_idx, path),
  FOREIGN KEY (session_id, turn_idx) REFERENCES turns(session_id, idx) ON DELETE CASCADE
);

-- Live observations. No foreign key to sessions: a rescan deletes and re-inserts the session row.
CREATE TABLE git_snapshots (
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('start', 'latest')),
  repo_root TEXT NOT NULL,
  head TEXT,
  taken_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, kind, repo_root)
);
CREATE TABLE git_snapshot_files (
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  added INTEGER NOT NULL,
  removed INTEGER NOT NULL,
  PRIMARY KEY (session_id, kind, path)
);
CREATE TABLE diag_snapshots (
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('start', 'latest')),
  path TEXT NOT NULL,
  errors INTEGER NOT NULL,
  warnings INTEGER NOT NULL,
  PRIMARY KEY (session_id, kind, path)
);
CREATE TABLE terminal_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER,
  ended_at INTEGER NOT NULL,
  exit_code INTEGER,
  kind TEXT NOT NULL,
  command_hash TEXT NOT NULL
);
CREATE INDEX idx_terminal_runs_ended ON terminal_runs(ended_at);
CREATE TABLE survival_checks (
  session_id TEXT NOT NULL,
  turn_idx INTEGER NOT NULL,
  path TEXT NOT NULL,
  check_kind TEXT NOT NULL CHECK (check_kind IN ('1h', '1d', 'commit')),
  checked_at INTEGER NOT NULL,
  present INTEGER NOT NULL,
  total INTEGER NOT NULL,
  PRIMARY KEY (session_id, turn_idx, path, check_kind)
);
CREATE TABLE session_commits (
  session_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  committed_at INTEGER NOT NULL,
  overlap_files INTEGER NOT NULL,
  edited_files INTEGER NOT NULL,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, hash)
);
CREATE INDEX idx_session_commits_hash ON session_commits(hash);
```

- [ ] **Step 6: Failing test for `ObservationStore`** (`observationStore.test.ts`; use the same in-memory/temp
      `Database` helper as `sessionStore.test.ts` — read its first 20 lines and copy the setup). Cases: (a) snapshot
      round-trip incl. files, replacing `latest` overwrites but `start` is untouched; (b) `terminalRunsBetween`
      is inclusive and ordered; (c) `deleteSessions(['a'])` removes snapshot/diag/survival/commit rows of `a` only;
      (d) `deleteAll()` also empties `terminal_runs`; (e) `pruneBefore(ms)` drops terminal runs older than `ms`;
      (f) `touch(5)` then `lastChangeAt()` → `5`, default `0`; (g) every mutating method calls `touch` (call
      `saveSnapshot`, expect `lastChangeAt() > 0` with an injected `now`). Constructor: `(database, now = Date.now)`.

- [ ] **Step 7: Run → FAIL. Step 8: implement `observationStore.ts`** with prepared statements
      using named parameters and `this.database.transaction` for multi-row writes; `deleteSessions` uses the
      existing `SELECT value FROM json_each(:ids)` idiom from `sessionStore.ts`. `getSnapshots` reads
      `git_snapshots` joined to `git_snapshot_files` by `(session_id, kind)` and groups files under the repo whose
      `repo_root` is a path prefix of the file path (longest root wins). **Step 9: Run → PASS.**

- [ ] **Step 10: Worker extraction — failing tests** in `chatSession.test.ts`:

```ts
import { readFileSync } from 'node:fs';
// reuse `fixturePath`, `replayMutationLog`, `normalizeChatSession` already imported in this file

function stateWith(parts: unknown[], toolCalls: unknown[] = []) {
  const { state } = replayMutationLog(readFileSync(fixturePath('auto-agent-session.jsonl'), 'utf8'));
  const clone = structuredClone(state) as {
    requests: { response: unknown[]; result?: { metadata?: { toolCallRounds?: unknown[] } } }[];
  };
  clone.requests[0]!.response.push(...parts);
  if (toolCalls.length > 0) {
    const metadata = (clone.requests[0]!.result ??= {}).metadata ?? {};
    clone.requests[0]!.result.metadata = { ...metadata, toolCallRounds: [{ id: 'r-extra', toolCalls }] };
  }
  return clone;
}

describe('content-derived fingerprints', () => {
  const SECRET = 'SECRET-CODE-LINE-do-not-store-me';
  it('stores salted line fingerprints of inserted text and no text', () => {
    const state = stateWith([
      { kind: 'textEditGroup', uri: { fsPath: '/repo/a.ts' }, edits: [[{ text: `${SECRET}\nshort\n` }]] },
    ]);
    const session = normalizeChatSession(state, { file: 'x.jsonl', workspace: 'w', salt: 'salt1' });
    const prints = session?.turns[0]?.editFingerprints;
    expect(prints).toEqual([{ path: '/repo/a.ts', hashes: [saltedHash('salt1', SECRET)] }]);
    expect(JSON.stringify(session?.turns[0]?.editFingerprints)).not.toContain('SECRET');
  });

  it('hashes terminal tool-call commands after redaction', () => {
    const state = stateWith(
      [],
      [{ id: 'c1', name: 'run_in_terminal', arguments: JSON.stringify({ command: 'pnpm   test' }) }],
    );
    const session = normalizeChatSession(state, { file: 'x.jsonl', workspace: 'w', salt: 'salt1' });
    const call = session?.turns[0]?.toolCalls.find((c) => c.callId === 'c1');
    expect(call?.commandHash).toBe(commandHash('salt1', 'pnpm test'));
  });

  it('produces no fingerprints or command hashes without a salt', () => {
    const state = stateWith([
      { kind: 'textEditGroup', uri: { fsPath: '/repo/a.ts' }, edits: [[{ text: 'x'.repeat(40) }]] },
    ]);
    const session = normalizeChatSession(state, { file: 'x.jsonl', workspace: 'w' });
    expect(session?.turns[0]?.editFingerprints).toEqual([]);
  });
});
```

If the fixture's `result.metadata` shape differs, adapt `stateWith` after reading the fixture; the assertions
stay the same.

- [ ] **Step 11: Run → FAIL. Step 12: Implement.**
  - `types.ts`: add fields above (`ToolCall.commandHash`, `NormalizedTurn.editFingerprints`).
  - `chatSession.ts`: add `salt?: string` to `NormalizeContext`; thread it into `normalizeTurn` (add a
    parameter). In `normalizeTurn`, `editFingerprints = salt === undefined ? [] : collectEditFingerprints(parts, salt)`.
    `collectEditFingerprints`: for each `textEditGroup` part with a path (same `uriPartSchema` logic as
    `collectFileEvents`), read `edits` defensively (`Array.isArray`, each entry array of records with string
    `text`), join texts with `\n`, `lineFingerprints(salt, joined)`; merge by path; skip empty. In
    `collectToolCalls`, set `commandHash` = `salt !== undefined && TERMINAL_TOOL.test(name) && typeof args.command === 'string' ? commandHash(salt, args.command) : null` (export `TERMINAL_TOOL` from `analysis/changes.ts`? No — that would invert layering inside `core`; define `const TERMINAL_TOOL = /terminal|run_?command|execute_?command/i` once in `src/core/ingest/toolNames.ts` and import it from both `chatSession.ts` and `analysis/changes.ts`). Every existing `ToolCall` literal gets `commandHash: null`.
  - `scanner.ts`: `ScanInput.salt?: string`; pass `salt: input.salt` into `normalizeChatSession`.
  - `captureLevel.ts` `captureTurn`: at `metrics` set `editFingerprints: []` and each call's `commandHash: null`.
  - `sessionStore.ts`: `TOOL_COLUMNS` gains `'command_hash'` (row value `call.commandHash`); after file events,
    insert one `edit_fingerprints` row per `turn.editFingerprints` entry (`hashes` = `JSON.stringify`).
    `clearContent` and `downgradeStoredContent('summaries'|'metrics')` (metrics goes through `clearContent`):
    `DELETE FROM edit_fingerprints WHERE session_id IN (…)` and `UPDATE tool_calls SET command_hash = NULL …`.
    `getSession` row mapping must tolerate the new column (`StoredSession` types: add `commandHash`,
    `editFingerprints` if the mapper is exhaustive; otherwise leave).
  - `ingestService.ts`: `INGEST_VERSION = 2`; a private `salt()` reads `state.getMeta('privacy.salt')` or creates
    it with `newSalt()`; pass `salt` into `runScan(...)` input. `META` gains `salt: 'privacy.salt'`.
  - `clearService.ts`: in the deletes-sessions branch call `new ObservationStore(this.database).deleteSessions(ids)`;
    for `scope.kind === 'everything'` also `observations.deleteAll()` and `DELETE FROM meta WHERE key = 'privacy.salt'`
    (via `IngestStateStore`'s meta API — add `deleteMeta(key)` if absent). For `sessionContent`/`allContent`
    (content-cleared) also delete that scope's `survival_checks` **and** nothing else (they hold no text).
  - `sessions.purgeBefore` (`sessionStore.ts`): before deleting sessions also delete their observation rows
    (same three statements pattern as `llm_calls`), plus `ObservationStore.pruneBefore(cutoffMs)` is called by
    `IngestService` with `Date.parse(cutoffDay)` when `cutoff !== null`.
  - `analysisStore.ts`: `readCache` additionally returns `null` (stale) when `a.observed_at <
ObservationStore.lastChangeAt()`; `compute` writes `observed_at = lastChangeAt()` at compute time. Add a test:
    compute analysis → `obs.touch(now+1)` → next `get` recomputes (spy on `analyzeSession` via a count of
    `session_analysis` rewrite, or assert `observed_at` column updated).

- [ ] **Step 13: Tests for cleanup** (`sessionStore.test.ts`, `clearService.test.ts`):
  1. `replaceSession` twice for the same id keeps `git_snapshots` rows saved in between.
  2. `clear({kind:'session'})` removes that session's snapshot/diag/survival/commit rows, keeps another's.
  3. `clear({kind:'everything'})` empties `terminal_runs` and removes `privacy.salt`.
  4. `downgradeStoredContent('metrics')` empties `edit_fingerprints` and NULLs `command_hash`.
  5. After ingesting the SECRET fixture at `metrics`, JSON of `edit_fingerprints`/`tool_calls.command_hash` has no `SECRET`.

- [ ] **Step 14: Run everything** — `pnpm format && pnpm verify` → PASS; `pnpm smoke:real` → still
      "all … requests became turns".

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat(outcomes): add observation schema, salted fingerprints and worker extraction"
```

---

### Task 4.1: Git snapshots and lines changed

**Files:**

- Create: `src/core/git/types.ts`, `src/core/git/numstat.ts`, `src/core/git/numstat.test.ts`,
  `src/core/git/snapshots.ts`, `src/core/git/snapshots.test.ts`,
  `src/core/query/sessionOutcomes.ts` (git part), `src/core/query/sessionOutcomes.test.ts`,
  `src/extension/observers/gitAdapter.ts`, `src/extension/observers/liveObserver.ts`,
  `test/integration/outcomes.test.ts`
- Modify: `src/extension/extension.ts`, `src/core/ingest/ingestService.ts` (nothing — observer hooks
  `onChanged`, see Step 9)

**Interfaces:**

- Consumes: `ObservationStore` (4.0).
- Produces (`git/types.ts`):

```ts
export interface FileNumstat {
  path: string;
  added: number;
  removed: number;
} // absolute path
export interface GitCommit {
  hash: string;
  committedAt: number;
  files: string[];
} // absolute paths
export interface GitRepo {
  readonly root: string;
  head(): Promise<string | null>;
  workingTreeNumstat(): Promise<FileNumstat[]>;
  commitsSince(sinceMs: number): Promise<GitCommit[]>;
  fileAtCommit(hash: string, path: string): Promise<string | null>;
}
export interface GitPort {
  repos(): Promise<GitRepo[]>;
}
```

- Produces (`snapshots.ts`):
  `takeSnapshot(repo: GitRepo, now: number): Promise<{ repoRoot; head; takenAt; files: FileNumstat[] }>`;
  `diffSnapshots(start: StoredSnapshot[], latest: StoredSnapshot[]): { added: number; removed: number } | null`
  (null = not computable);
  `LIVE_START_MS = 180_000`, `LIVE_WINDOW_MS = 600_000`;
  `shouldBaseline(input: { hasStart: boolean; firstTurnStartedAt: number | null; now: number }): boolean`.
- Produces (`numstat.ts`): `countPatchLines(patch: string): { added: number; removed: number }`.

- [ ] **Step 1: Failing tests** `numstat.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { countPatchLines } from './numstat';

const PATCH = [
  'diff --git a/x.ts b/x.ts',
  'index 1..2 100644',
  '--- a/x.ts',
  '+++ b/x.ts',
  '@@ -1,2 +1,3 @@',
  ' keep',
  '-old line',
  '+new line',
  '+another',
  '',
].join('\n');

describe('countPatchLines', () => {
  it('counts +/- lines and ignores file headers', () => {
    expect(countPatchLines(PATCH)).toEqual({ added: 2, removed: 1 });
  });
  it('counts a line that starts with ++ or -- inside a hunk', () => {
    expect(countPatchLines('@@ -1 +1 @@\n-- old\n+++ new\n')).toEqual({ added: 1, removed: 1 });
  });
  it('returns zeros for empty or binary patches', () => {
    expect(countPatchLines('')).toEqual({ added: 0, removed: 0 });
    expect(countPatchLines('Binary files a/x and b/x differ\n')).toEqual({ added: 0, removed: 0 });
  });
});
```

`snapshots.test.ts` (use a fake `GitRepo`):

```ts
import { describe, expect, it } from 'vitest';
import { LIVE_START_MS, diffSnapshots, shouldBaseline, takeSnapshot } from './snapshots';
import type { GitRepo } from './types';

const snap = (head: string | null, files: [string, number, number][], root = '/r') => ({
  repoRoot: root,
  head,
  takenAt: 1,
  files: files.map(([path, added, removed]) => ({ path, added, removed })),
});

describe('diffSnapshots', () => {
  it('sums positive per-file growth of the working-tree diff', () => {
    const start = [snap('h1', [['/r/a.ts', 5, 1]])];
    const latest = [
      snap('h1', [
        ['/r/a.ts', 12, 3],
        ['/r/b.ts', 4, 0],
      ]),
    ];
    expect(diffSnapshots(start, latest)).toEqual({ added: 11, removed: 2 });
  });
  it('never goes negative when the user reverted changes', () => {
    expect(diffSnapshots([snap('h1', [['/r/a.ts', 9, 9]])], [snap('h1', [])])).toEqual({
      added: 0,
      removed: 0,
    });
  });
  it('is not computable when HEAD moved', () => {
    expect(diffSnapshots([snap('h1', [])], [snap('h2', [])])).toBeNull();
  });
  it('is not computable without a baseline or without a matching repo', () => {
    expect(diffSnapshots([], [snap('h1', [])])).toBeNull();
    expect(diffSnapshots([snap('h1', [], '/a')], [snap('h1', [], '/b')])).toBeNull();
  });
});

describe('shouldBaseline', () => {
  it('baselines only when the first turn just started and no start exists', () => {
    const now = 1_000_000;
    expect(shouldBaseline({ hasStart: false, firstTurnStartedAt: now - 1000, now })).toBe(true);
    expect(shouldBaseline({ hasStart: true, firstTurnStartedAt: now - 1000, now })).toBe(false);
    expect(shouldBaseline({ hasStart: false, firstTurnStartedAt: now - LIVE_START_MS - 1, now })).toBe(false);
    expect(shouldBaseline({ hasStart: false, firstTurnStartedAt: null, now })).toBe(false);
  });
});

describe('takeSnapshot', () => {
  it('captures head and numstat', async () => {
    const repo: GitRepo = {
      root: '/r',
      head: () => Promise.resolve('abc'),
      workingTreeNumstat: () => Promise.resolve([{ path: '/r/a.ts', added: 1, removed: 0 }]),
      commitsSince: () => Promise.resolve([]),
      fileAtCommit: () => Promise.resolve(null),
    };
    expect(await takeSnapshot(repo, 7)).toEqual({
      repoRoot: '/r',
      head: 'abc',
      takenAt: 7,
      files: [{ path: '/r/a.ts', added: 1, removed: 0 }],
    });
  });
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement.**

`numstat.ts`:

```ts
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
```

`snapshots.ts`:

```ts
import type { StoredSnapshot } from '../storage/observationStore';
import type { FileNumstat, GitRepo } from './types';

export const LIVE_START_MS = 180_000;
export const LIVE_WINDOW_MS = 600_000;

export async function takeSnapshot(repo: GitRepo, now: number) {
  const [head, files] = await Promise.all([repo.head(), repo.workingTreeNumstat()]);
  return { repoRoot: repo.root, head, takenAt: now, files: files as FileNumstat[] };
}

export function shouldBaseline(input: {
  hasStart: boolean;
  firstTurnStartedAt: number | null;
  now: number;
}): boolean {
  return (
    !input.hasStart &&
    input.firstTurnStartedAt !== null &&
    input.now - input.firstTurnStartedAt <= LIVE_START_MS
  );
}

/** Net working-tree growth between two observations, per repo, clamped at 0 per file. Null when not computable. */
export function diffSnapshots(
  start: readonly StoredSnapshot[],
  latest: readonly StoredSnapshot[],
): { added: number; removed: number } | null {
  let added = 0;
  let removed = 0;
  let matched = false;
  for (const from of start) {
    const to = latest.find((candidate) => candidate.repoRoot === from.repoRoot);
    if (to === undefined) continue;
    if (from.head !== to.head) return null;
    matched = true;
    const before = new Map(from.files.map((file) => [file.path, file]));
    for (const file of to.files) {
      const old = before.get(file.path);
      added += Math.max(0, file.added - (old?.added ?? 0));
      removed += Math.max(0, file.removed - (old?.removed ?? 0));
    }
  }
  return matched ? { added, removed } : null;
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: `sessionOutcomes.ts` git part — failing test.** Define in `sessionOutcomes.ts`:
      `export function getSessionOutcomes(database: Pick<Database,'db'>, id: string): Outcomes` (the `Outcomes` DTO is
      added in Step 6). Test seeds two snapshots via `ObservationStore` and expects
      `outcomes.linesAdded` = `derived(n, 'git working-tree diff between first and latest observation while VS Code was open')`;
      no snapshots → `unavailable('no git snapshot: VS Code was not observing this session')`; HEAD moved →
      `unavailable('HEAD changed during the session; see linked commits')`.

- [ ] **Step 6: DTO.** In `src/shared/dto.ts` add (exact):

```ts
export const outcomesSchema = z.object({
  linesAdded: measuredNumber,
  linesRemoved: measuredNumber,
});
export type Outcomes = z.infer<typeof outcomesSchema>;
```

and `outcomes: outcomesSchema` in `sessionDetailSchema`. (Later tasks extend `outcomesSchema`.) Update
`getSessionDetail` to `outcomes: getSessionOutcomes(database, id)`; update every fixture/`dtoFixtures.ts`
literal that builds a `SessionDetail` (`pnpm typecheck` lists them) with `unavailable('test')` values.

- [ ] **Step 7: Run tests → PASS.**

- [ ] **Step 8: Extension adapter** `src/extension/observers/gitAdapter.ts` — implements `GitPort` over the
      built-in git extension:

```ts
import * as vscode from 'vscode';
import { countPatchLines } from '../../core/git/numstat';
import type { GitCommit, GitPort, GitRepo } from '../../core/git/types';

// Minimal typings of the parts of vscode.git's API v1 that we use.
interface ApiRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD?: { commit?: string };
    workingTreeChanges: { uri: vscode.Uri }[];
    indexChanges: { uri: vscode.Uri }[];
  };
  diffWithHEAD(path: string): Promise<string>;
  log(options: {
    maxEntries?: number;
    since?: Date;
  }): Promise<{ hash: string; commitDate?: Date; authorDate?: Date; parents: string[] }[]>;
  diffBetween(ref1: string, ref2: string): Promise<{ uri: vscode.Uri }[]>;
  show(ref: string, path: string): Promise<string>;
}
interface GitApi {
  repositories: ApiRepository[];
}
interface GitExtension {
  getAPI(version: 1): GitApi;
}

const MAX_FILES = 200;
const MAX_COMMITS = 50;

export class VscodeGit implements GitPort {
  async repos(): Promise<GitRepo[]> {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (extension === undefined) return [];
    const exports = extension.isActive ? extension.exports : await extension.activate();
    const api = exports.getAPI(1);
    return api.repositories.slice(0, 5).map((repository) => adapt(repository));
  }
}

function adapt(repository: ApiRepository): GitRepo {
  return {
    root: repository.rootUri.fsPath,
    head: () => Promise.resolve(repository.state.HEAD?.commit ?? null),
    workingTreeNumstat: async () => {
      const changed = [...repository.state.workingTreeChanges, ...repository.state.indexChanges];
      const paths = [...new Set(changed.map((change) => change.uri.fsPath))].slice(0, MAX_FILES);
      const result = [];
      for (const path of paths) {
        try {
          result.push({ path, ...countPatchLines(await repository.diffWithHEAD(path)) });
        } catch {
          // Untracked or unreadable file: skip rather than guess.
        }
      }
      return result;
    },
    commitsSince: async (sinceMs) => {
      const commits = await repository.log({ maxEntries: MAX_COMMITS, since: new Date(sinceMs) });
      const out: GitCommit[] = [];
      for (const commit of commits) {
        const parent = commit.parents[0];
        if (parent === undefined) continue;
        const changes = await repository.diffBetween(parent, commit.hash);
        out.push({
          hash: commit.hash,
          committedAt: (commit.commitDate ?? commit.authorDate ?? new Date(0)).getTime(),
          files: changes.map((change) => change.uri.fsPath),
        });
      }
      return out;
    },
    fileAtCommit: async (hash, path) => {
      try {
        return await repository.show(hash, path);
      } catch {
        return null;
      }
    },
  };
}
```

Note: patch text is read into memory only to count lines and is discarded; never log it. Untracked new files
are not in `diffWithHEAD`; they are skipped (D-P4-2 already makes line counts a `derived` estimate — note this
in the provenance source string of Task 4.1's `linesAdded`: "tracked files only").

- [ ] **Step 9: `LiveObserver`** (`src/extension/observers/liveObserver.ts`). Deps and behaviour for this task
      (later tasks add methods; keep the class open for that):

```ts
export interface LiveObserverDeps {
  database: Database;
  observations: ObservationStore;
  git: GitPort;
  now?: () => number;
  log: { warn(message: string): void };
}

export class LiveObserver {
  private running = false;
  constructor(private readonly deps: LiveObserverDeps) {}

  /** Idempotent and re-entrancy safe; called after every sync and on a 60 s timer. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.observeGit();
    } catch (error) {
      this.deps.log.warn(
        `Live observation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private liveSessions(now: number): { id: string; firstTurnStartedAt: number | null }[] {
    return this.deps.database.db
      .prepare(
        `SELECT s.id, (SELECT MIN(started_at) FROM turns t WHERE t.session_id = s.id) AS firstTurnStartedAt
           FROM sessions s WHERE s.ended_at >= :since`,
      )
      .all({ since: now - LIVE_WINDOW_MS }) as unknown as { id: string; firstTurnStartedAt: number | null }[];
  }

  private async observeGit(): Promise<void> {
    const now = (this.deps.now ?? Date.now)();
    const sessions = this.liveSessions(now);
    if (sessions.length === 0) return;
    const repos = await this.deps.git.repos();
    if (repos.length === 0) return;
    for (const session of sessions) {
      const hasStart = this.deps.observations.getSnapshots(session.id, 'start').length > 0;
      const kind = hasStart
        ? 'latest'
        : shouldBaseline({ hasStart, firstTurnStartedAt: session.firstTurnStartedAt, now })
          ? 'start'
          : null;
      if (kind === null) continue;
      for (const repo of repos) {
        this.deps.observations.saveSnapshot({
          sessionId: session.id,
          kind,
          ...(await takeSnapshot(repo, now)),
        });
      }
    }
  }
}
```

Unit-test `LiveObserver.tick` in `src/extension/observers/liveObserver.test.ts`? `src/extension` may import
`vscode`, so the test must not import the vscode adapter — `liveObserver.ts` itself imports only core types, so
it _is_ unit-testable with Vitest (`node` project). Test: seed a live session (ended just now, first turn 1 s
ago) and a fake `GitPort` → `tick()` writes `start`; advance fake `now`, change fake numstat → `tick()` writes
`latest`; a session whose first turn started 1 h ago and has no start gets **no** snapshot (Review Focus 1);
a `GitPort` returning `[]` writes nothing and does not throw; a throwing port is caught and logged.
(Vitest's `node` project already includes `src/extension/**/*.test.ts`? Check `vitest.config` and follow how
`rpcHost.test.ts` is included.)

- [ ] **Step 10: Wire up** in `extension.ts`: create `observations = new ObservationStore(database)`,
      `liveObserver = new LiveObserver({ database, observations, git: new VscodeGit(), log })`; in the existing
      `onChanged` closure passed to `IngestService` also call `void liveObserver.tick()`; add
      `setInterval(() => void liveObserver.tick(), 60_000)` disposed in the final `dispose`. Also call `tick()` once
      after the first sync (`controller.start()` already schedules sync).

- [ ] **Step 11: Integration test** `test/integration/outcomes.test.ts` — real VS Code, temp git repo:

```ts
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { VscodeGit } from '../../src/extension/observers/gitAdapter';

describe('vscode.git adapter', function () {
  this.timeout(60_000);
  it('reports head, numstat and commits for a temp repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-git-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\nfour\n');
    // Make the repo known to the built-in git extension.
    const api = (
      (await vscode.extensions.getExtension('vscode.git')!.activate()) as {
        getAPI(v: 1): { openRepository(u: vscode.Uri): Promise<unknown> };
      }
    ).getAPI(1);
    await api.openRepository(vscode.Uri.file(dir));
    const repos = await new VscodeGit().repos();
    const repo = repos.find((candidate) => candidate.root === vscode.Uri.file(dir).fsPath);
    assert.ok(repo, 'repo opened');
    assert.match((await repo.head()) ?? '', /^[0-9a-f]{40}$/);
    assert.deepEqual(await repo.workingTreeNumstat(), [{ path: join(dir, 'a.txt'), added: 2, removed: 0 }]);
    git('commit', '-qam', 'second');
    const commits = await repo.commitsSince(Date.now() - 60_000);
    assert.equal(commits.length >= 1, true);
    assert.deepEqual(commits[0]!.files, [join(dir, 'a.txt')]);
  });
});
```

Known risk: `launchArgs: ['--disable-extensions']` in `.vscode-test.mjs` may disable the built-in git
extension. Run once first; if `getExtension('vscode.git')` is undefined or inactive, replace the flag with
`'--disable-extension=GitHub.copilot-chat'` (the goal is only to keep third-party extensions out) and re-run
_all_ integration tests on both `stable` and `1.105.0`. Compare paths with `fs.realpathSync` if macOS `/var`
vs `/private/var` differs. Because the test imports `src/extension/observers/gitAdapter` (which imports
`vscode`), check `esbuild.mjs --integration` bundles it (it bundles `test/integration/*.test.ts`; `vscode` is
external).

- [ ] **Step 12: Run** `pnpm format && pnpm verify && pnpm test:integration && pnpm smoke:real` → all PASS.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(outcomes): snapshot git working tree during live sessions and derive lines changed"
```

---

### Task 4.2: Edit survival

**Files:**

- Create: `src/core/outcomes/editOutcomes.ts`, `editOutcomes.test.ts`, `src/core/outcomes/survival.ts`,
  `survival.test.ts`, `src/core/query/survivalByModel.ts`, `survivalByModel.test.ts`
- Modify: `src/core/query/sessionOutcomes.ts`, `src/shared/dto.ts`, `src/extension/observers/liveObserver.ts`

**Interfaces:**

- Consumes: `ObservationStore.saveSurvivalCheck/survivalChecks`, `edit_fingerprints` (4.0), `GitPort` (4.1).
- Produces:
  - `attributeEditOutcomes(turns: readonly { index: number; model: string | null; fileEvents: { path: string; action: string }[] }[]): AttributedOutcome[]`
    where `AttributedOutcome = { model: string | null; path: string; outcome: 'kept' | 'undone' | 'user-modified'; editTurn: number }`
  - `presentFraction(hashes: readonly string[], fileText: string | null, salt: string): { present: number; total: number }`
  - `class SurvivalChecker` `constructor(deps: { database; observations; git: GitPort; readFile(path: string): Promise<string | null>; salt(): string; now(): number })`,
    `run(): Promise<number>` returns checks written.
  - `DUE = { '1h': 3_600_000, '1d': 86_400_000 }`, `GRACE = { '1h': 86_400_000, '1d': 604_800_000 }`
  - Outcomes DTO additions: `editsKept`, `editsUndone`, `editsUserModified`, `editKeepRate` (all `measuredNumber`),
    `laterSurvival: measuredNumber` (fraction 0–1 of inserted lines still present at the latest check).
  - `getSurvivalByModel(database): SurvivalByModelRow[]` with
    `{ model: string; edits: number; keepRate: MeasuredNumber; laterSurvival: MeasuredNumber; sampleSize: number }`.

- [ ] **Step 1: Failing tests** `editOutcomes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { attributeEditOutcomes } from './editOutcomes';

const turn = (index: number, model: string | null, ...events: [string, string][]) => ({
  index,
  model,
  fileEvents: events.map(([path, action]) => ({ path, action })),
});

describe('attributeEditOutcomes', () => {
  it('credits a keep/undo/user-modified event to the model that made the latest earlier edit of that file', () => {
    const result = attributeEditOutcomes([
      turn(1, 'gpt-a', ['/r/a.ts', 'edited']),
      turn(2, 'gpt-b', ['/r/a.ts', 'edited']),
      turn(3, 'gpt-c', ['/r/a.ts', 'kept']),
    ]);
    expect(result).toEqual([{ model: 'gpt-b', path: '/r/a.ts', outcome: 'kept', editTurn: 2 }]);
  });
  it('ignores outcome events with no earlier edit in this session', () => {
    expect(attributeEditOutcomes([turn(1, 'gpt-a', ['/r/a.ts', 'undone'])])).toEqual([]);
  });
  it('supports created files and all three outcomes', () => {
    const result = attributeEditOutcomes([
      turn(1, 'm', ['/r/n.ts', 'created'], ['/r/o.ts', 'edited']),
      turn(2, 'm', ['/r/n.ts', 'user-modified'], ['/r/o.ts', 'undone']),
    ]);
    expect(result.map((r) => r.outcome).sort()).toEqual(['undone', 'user-modified']);
  });
});
```

`survival.test.ts`: `presentFraction(['h1','h2'], text, salt)` where `text` contains a line hashing to `h1`
(build with `saltedHash`) → `{present:1,total:2}`; `fileText === null` → `{present:0,total:2}` (**Review Focus 3**);
empty hashes → `{present:0,total:0}`. `SurvivalChecker.run()` cases (seed a session with one turn ended at
`T`, one `edit_fingerprints` row, fake `readFile`, `now`):
(a) `now = T+30min` → 0 checks; (b) `T+2h` → one `1h` check with the measured fraction; running again → 0 new
(idempotent); (c) `T+3d` → a `1d` check but **no** `1h` (past its grace); (d) `T+10d` → none; (e) a
`session_commits` row (committed after `T`, touching the path) → a `commit` check using `git.fileAtCommit`
once; (f) `readFile` rejecting → caught per file, other files still checked.

- [ ] **Step 2: Run → FAIL. Step 3: Implement.**

`editOutcomes.ts`:

```ts
export interface AttributedOutcome {
  model: string | null;
  path: string;
  outcome: 'kept' | 'undone' | 'user-modified';
  editTurn: number;
}
const OUTCOMES = new Set(['kept', 'undone', 'user-modified']);
const EDITS = new Set(['edited', 'created']);

/** Copilot reports what happened to an edit on a *later* request; credit it to the model that made the edit. */
export function attributeEditOutcomes(
  turns: readonly {
    index: number;
    model: string | null;
    fileEvents: readonly { path: string; action: string }[];
  }[],
): AttributedOutcome[] {
  const lastEdit = new Map<string, { model: string | null; turn: number }>();
  const result: AttributedOutcome[] = [];
  for (const turn of [...turns].sort((a, b) => a.index - b.index)) {
    for (const event of turn.fileEvents) {
      if (OUTCOMES.has(event.action)) {
        const edit = lastEdit.get(event.path);
        if (edit !== undefined && edit.turn < turn.index) {
          result.push({
            model: edit.model,
            path: event.path,
            outcome: event.action as AttributedOutcome['outcome'],
            editTurn: edit.turn,
          });
        }
      }
    }
    for (const event of turn.fileEvents) {
      if (EDITS.has(event.action)) lastEdit.set(event.path, { model: turn.model, turn: turn.index });
    }
  }
  return result;
}
```

`survival.ts`: `presentFraction` builds a `Set` of `saltedHash(salt, line.trim())` for every line of the file
text; counts hashes in the set. `SurvivalChecker.run()`:

1. Query candidates:
   `SELECT f.session_id, f.turn_idx, f.path, f.hashes, COALESCE(t.ended_at, t.started_at) AS edited_at FROM edit_fingerprints f JOIN turns t ON t.session_id = f.session_id AND t.idx = f.turn_idx WHERE edited_at IS NOT NULL AND edited_at >= :since` (`since = now - 8d`).
2. For each candidate and each `kind` in `['1h','1d']`: due when `now - edited_at >= DUE[kind]` and `< GRACE[kind]` and no
   existing check row; read the file with `readFile` (try/catch → `null`), compute, `saveSurvivalCheck`.
3. Commit check: for each `session_commits` row for the session with `committed_at > edited_at` whose stored
   files include the path — the store keeps only counts, so re-derive: call `git.repos()`, find the repo whose
   root prefixes the path, `commitsSince(edited_at)`, take the **first** commit (by `committedAt`) whose `files`
   include the path; if there is no `commit` check yet, `git.fileAtCommit(hash, relativeToRoot)` → compute → save.
   Guard: skip if `git.repos()` is empty.
4. `observations.touch(now)` when any check was written. Return the count.

`survivalByModel.ts`: SQL joins `turns`-derived attribution in JS: load every session's turn model + file events
(for sessions with any outcome event) using `SELECT` on `turns`/`file_events`; run `attributeEditOutcomes` per
session; `keepRate` = kept ÷ (kept+undone+user-modified) → `derived(rate, 'Copilot editedFileEvents, attributed to the model that made the edit')`,
`unavailable` when the denominator is 0; `laterSurvival` = Σpresent ÷ Σtotal over each (session, turn, path)'s
**latest** check, attributed to that turn's model → `derived(…, 'fingerprints of inserted lines still present at the latest check')`
or `unavailable`. Test with two models and a mix.

- [ ] **Step 4: DTO + query.** Extend `outcomesSchema` (Task 4.1) with the five measures and
      `survivalByModelSchema`; `getSessionOutcomes` computes `editsKept/Undone/UserModified` from the session's
      file events via `attributeEditOutcomes` (counts are `exact`, source `chatSessions.editedFileEvents`; a session
      with no outcome events → `unavailable('Copilot reported no keep/undo events for this session')` — **not**
      zero, because Copilot only emits them when the user acted), `editKeepRate` `derived`, `laterSurvival` from the
      session's latest checks. Add `getSurvivalByModel` to `InsightsQueries`, protocol
      (`getSurvivalByModel: { params: z.object({}), result: z.object({ rows: z.array(survivalByModelRowSchema) }) }`),
      the handler in `extension.ts`, and `ALLOWED` entries `survivalByModel.rows[].edits` and `…sampleSize`.

- [ ] **Step 5: Wire `SurvivalChecker`** into `LiveObserver.tick()` (`await this.survival.run()` after
      `observeGit`); `LiveObserverDeps` gains `readFile` (extension: `fs.promises.readFile(path, 'utf8')`, files > 2 MB → `null`) and `salt: () => string`. Extend the `liveObserver.test.ts` fake deps accordingly.

- [ ] **Step 6:** `pnpm format && pnpm verify` → PASS. **Step 7: Commit**

```bash
git add -A
git commit -m "feat(outcomes): measure edit survival from Copilot events and later fingerprint checks"
```

---

### Task 4.3: Terminal and test results

**Files:**

- Create: `src/core/outcomes/commandKind.ts`, `commandKind.test.ts`, `src/core/outcomes/terminalMatch.ts`,
  `terminalMatch.test.ts`, `src/extension/observers/terminalObserver.ts`
- Modify: `src/core/query/sessionOutcomes.ts`, `src/shared/dto.ts`, `src/extension/extension.ts`

**Interfaces:**

- Consumes: `tool_calls.command_hash` (4.0), `ObservationStore.addTerminalRun/terminalRunsBetween`.
- Produces:
  - `classifyCommand(command: string): 'test' | 'build' | 'lint' | 'other'`
  - `matchTerminalRuns(turns: MatchTurn[], runs: StoredRun[]): TerminalMatch` with
    `MatchTurn = { index: number; startedAt: number | null; endedAt: number | null; systemInitiated: boolean; terminalCalls: { commandHash: string | null }[] }`,
    `StoredRun = TerminalRun` (4.0), `TerminalMatch = { matched: { run: TerminalRun; turnIdx: number; via: 'command-hash' | 'system-turn-time' }[]; terminalCallCount: number }`
  - Outcomes DTO additions: `terminalRuns`, `terminalFailures`, `testRuns`, `testFailures` (`measuredNumber`),
    `lastTestPassed: measured(z.boolean())`.
  - `terminalObserver.ts`: `registerTerminalObserver(observations: ObservationStore, salt: () => string): vscode.Disposable`.

- [ ] **Step 1: Failing tests** `commandKind.test.ts`: `pnpm test` / `npm run test` / `npx vitest run` /
      `pytest -q` / `go test ./...` / `cargo test` → `test`; `pnpm build` / `tsc -p .` / `vite build` → `build`;
      `eslint .` / `pnpm lint` / `ruff check` → `lint`; `ls -la` / `git status` → `other`; a test command with a
      secret in it still classifies as `test`.

`terminalMatch.test.ts` (times in ms):

```ts
const T0 = 1_000_000;
const turns = [
  {
    index: 1,
    startedAt: T0,
    endedAt: T0 + 60_000,
    systemInitiated: false,
    terminalCalls: [{ commandHash: 'hTest' }, { commandHash: 'hBuild' }],
  },
  { index: 2, startedAt: T0 + 300_000, endedAt: T0 + 310_000, systemInitiated: true, terminalCalls: [] },
];
const run = (endedAt: number, commandHash: string, exitCode: number | null = 0) => ({
  startedAt: endedAt - 1000,
  endedAt,
  exitCode,
  kind: 'test' as const,
  commandHash,
});

it('matches by command hash inside the turn window', () => {
  const r = matchTerminalRuns(turns, [run(T0 + 30_000, 'hTest', 1)]);
  expect(r.matched).toEqual([expect.objectContaining({ turnIdx: 1, via: 'command-hash' })]);
});
it('does not match the same hash outside the window plus slack', () => {
  expect(matchTerminalRuns(turns, [run(T0 + 500_000, 'hTest')]).matched).toEqual([]);
});
it('uses each run and each tool call at most once', () => {
  const r = matchTerminalRuns(turns, [run(T0 + 10_000, 'hTest'), run(T0 + 20_000, 'hTest')]);
  expect(r.matched).toHaveLength(1);
});
it('attributes an unmatched run that ended shortly before a system-initiated turn to that turn', () => {
  const r = matchTerminalRuns(turns, [run(T0 + 290_000, 'hDev')]);
  expect(r.matched).toEqual([expect.objectContaining({ turnIdx: 2, via: 'system-turn-time' })]);
});
it('counts terminal tool calls so callers can tell when observation was partial', () => {
  expect(matchTerminalRuns(turns, []).terminalCallCount).toBe(2);
});
it('keeps a null exit code (no shell integration) as null', () => {
  expect(matchTerminalRuns(turns, [run(T0 + 30_000, 'hTest', null)]).matched[0]!.run.exitCode).toBeNull();
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement.**

`commandKind.ts`:

```ts
const TEST =
  /\b(vitest|jest|pytest|mocha|rspec|phpunit)\b|\b(go|cargo|dotnet|mvn|gradle)\s+test\b|\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/i;
const LINT = /\b(eslint|ruff|flake8|pylint|prettier|stylelint)\b|\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?lint\b/i;
const BUILD =
  /\b(tsc|webpack|vite\s+build|esbuild|make|cargo\s+build|go\s+build)\b|\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b/i;
export type CommandKind = 'test' | 'build' | 'lint' | 'other';
export function classifyCommand(command: string): CommandKind {
  if (TEST.test(command)) return 'test';
  if (LINT.test(command)) return 'lint';
  if (BUILD.test(command)) return 'build';
  return 'other';
}
```

`terminalMatch.ts`: constants `SLACK_AFTER_MS = 60_000`, `SLACK_BEFORE_MS = 5_000`, `SYSTEM_LEAD_MS = 120_000`.
Pass 1: for each non-system-or-any turn with `startedAt`/`endedAt`, for each terminal call with a non-null
hash, pick the earliest unused run with the same hash and `endedAt ∈ [startedAt − SLACK_BEFORE, endedAt + SLACK_AFTER]`.
Pass 2: for each system-initiated turn with `startedAt`, each still-unused run with
`endedAt ∈ [startedAt − SYSTEM_LEAD, startedAt + SLACK_BEFORE]` matches (`via: 'system-turn-time'`), each run once.
`terminalCallCount` = total `terminalCalls.length`.

`terminalObserver.ts`:

```ts
import * as vscode from 'vscode';
import { classifyCommand } from '../../core/outcomes/commandKind';
import { commandHash } from '../../core/privacy/fingerprint';
import type { ObservationStore } from '../../core/storage/observationStore';

export function registerTerminalObserver(
  observations: ObservationStore,
  salt: () => string,
): vscode.Disposable {
  const started = new WeakMap<vscode.TerminalShellExecution, number>();
  return vscode.Disposable.from(
    vscode.window.onDidStartTerminalShellExecution((event) => {
      started.set(event.execution, Date.now());
    }),
    vscode.window.onDidEndTerminalShellExecution((event) => {
      const command = event.execution.commandLine.value;
      if (command.trim() === '') return;
      // Only kind, exit code, timing and a salted hash of the redacted command are stored; never the text.
      observations.addTerminalRun({
        startedAt: started.get(event.execution) ?? null,
        endedAt: Date.now(),
        exitCode: event.exitCode ?? null,
        kind: classifyCommand(command),
        commandHash: commandHash(salt(), command),
      });
    }),
  );
}
```

Register in `extension.ts` (`context.subscriptions.push(registerTerminalObserver(observations, () => getSalt()))`)
where `getSalt` reads/creates `privacy.salt` — expose `getOrCreateSalt(state: IngestStateStore): string` from
`fingerprint.ts`-adjacent code in `ingestService.ts` (reuse the same function inside `IngestService`).

- [ ] **Step 4: Outcomes query.** In `getSessionOutcomes`: load the session's turns
      (`idx, started_at, ended_at, system_initiated`) and terminal tool calls
      (`SELECT turn_idx, command_hash FROM tool_calls WHERE session_id = :id AND name` matching `TERMINAL_TOOL`
      — filter in JS with the shared regex), fetch
      `terminalRunsBetween(min(startedAt) − 120 s, max(endedAt) + 60 s)`, run `matchTerminalRuns`.
      Results: if `terminalCallCount === 0 && matched.length === 0` → all five `unavailable('no terminal activity observed')`.
      If matched is empty but calls exist → `unavailable('terminal exit codes are only recorded while VS Code is open with shell integration')`.
      Otherwise counts are `derived`; when `matched.length < terminalCallCount` the source contains
      `lower bound` so `Measure` renders `≥`. `terminalFailures` counts matched runs with `exitCode !== null && exitCode !== 0`;
      runs with `exitCode === null` count toward `terminalRuns` but never toward failures (mention in source string).
      `testRuns/testFailures` filter `kind === 'test'`; `lastTestPassed` = last test run with a non-null exit code
      (`derived`, `unavailable` if none). Add `sessionOutcomes.test.ts` cases for each branch.

- [ ] **Step 5:** `pnpm format && pnpm verify` → PASS. **Step 6: Commit**

```bash
git add -A
git commit -m "feat(outcomes): record terminal exit codes and match them to Copilot tool calls"
```

---

### Task 4.4: Diagnostics delta

**Files:**

- Create: `src/core/outcomes/diagnosticsDelta.ts`, `diagnosticsDelta.test.ts`,
  `src/extension/observers/diagnosticsAdapter.ts`
- Modify: `src/extension/observers/liveObserver.ts` (+test), `src/core/query/sessionOutcomes.ts`, `src/shared/dto.ts`

**Interfaces:**

- Consumes: `ObservationStore.saveDiagnostics/getDiagnostics`.
- Produces: `diagnosticsDelta(before: DiagEntry[], after: DiagEntry[], editedPaths: readonly string[]): { errors: number; warnings: number; errorsBefore: number; errorsAfter: number } | null`
  (null when `before` or `after` snapshot is missing entirely — pass `null` arrays as `undefined`? use
  signature `(before: DiagEntry[] | null, after: DiagEntry[] | null, editedPaths)`);
  `DiagnosticsPort { snapshot(): DiagEntry[] }` in `src/core/outcomes/diagnosticsDelta.ts`;
  Outcomes DTO: `errorsDelta`, `warningsDelta` (`measuredNumber`, may be negative).

- [ ] **Step 1: Failing tests:**

```ts
import { describe, expect, it } from 'vitest';
import { diagnosticsDelta } from './diagnosticsDelta';

const d = (path: string, errors: number, warnings = 0) => ({ path, errors, warnings });

describe('diagnosticsDelta', () => {
  it('sums the change over edited files only; absent entries mean zero', () => {
    const before = [d('/r/a.ts', 3, 1), d('/r/other.ts', 9)];
    const after = [d('/r/a.ts', 1, 1), d('/r/b.ts', 2, 4), d('/r/other.ts', 50)];
    expect(diagnosticsDelta(before, after, ['/r/a.ts', '/r/b.ts'])).toEqual({
      errors: 0,
      warnings: 4,
      errorsBefore: 3,
      errorsAfter: 3,
    });
  });
  it('is null when either snapshot is missing', () => {
    expect(diagnosticsDelta(null, [], ['/r/a.ts'])).toBeNull();
    expect(diagnosticsDelta([], null, ['/r/a.ts'])).toBeNull();
  });
  it('is null when nothing was edited (a delta over no files would read as "no change")', () => {
    expect(diagnosticsDelta([], [], [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement** the pure function (sum `after − before` per edited path with
      `?? 0` defaults; error/warning totals for before/after).

- [ ] **Step 4: Adapter** `diagnosticsAdapter.ts`:

```ts
import * as vscode from 'vscode';
import type { DiagEntry } from '../../core/storage/observationStore';

const MAX_FILES = 500;

/** Counts only: message text is never read. Files with no errors or warnings are omitted (absent means zero). */
export function snapshotDiagnostics(): DiagEntry[] {
  const entries: DiagEntry[] = [];
  for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
    if (uri.scheme !== 'file') continue;
    const errors = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
    const warnings = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).length;
    if (errors + warnings > 0) entries.push({ path: uri.fsPath, errors, warnings });
    if (entries.length >= MAX_FILES) break;
  }
  return entries;
}
```

- [ ] **Step 5: `LiveObserver`** gains dep `diagnostics: () => DiagEntry[]` and, inside `observeGit`'s loop
      (rename the method `observeSession`), the same start/latest decision saves diagnostics under the same
      `kind`. Add a unit test: baseline saves `start` diagnostics; a later tick saves `latest`; a session without a
      baseline gets none (**Review Focus 1**). The diagnostics snapshot is taken even when no git repo exists
      (move the `repos.length === 0` early return so it only skips git).
- [ ] **Step 6: Outcomes query:** compute `diagnosticsDelta(start, latest, editedPaths)` where `editedPaths` are the
      session's `edited`/`created` file events; `null` → `unavailable('diagnostics were not observed before and after this session')`;
      else `derived(delta, 'VS Code diagnostics for edited files at first vs latest observation')`. Test in
      `sessionOutcomes.test.ts`.
- [ ] **Step 7:** `pnpm format && pnpm verify` → PASS. **Step 8: Commit**

```bash
git add -A
git commit -m "feat(outcomes): derive diagnostics delta for edited files"
```

---

### Task 4.5: Task taxonomy and outcome sentence

**Files:**

- Create: `src/core/outcomes/taskType.ts`, `taskType.test.ts`, `src/core/outcomes/outcomeSentence.ts`,
  `outcomeSentence.test.ts`
- Modify: `src/core/analysis/analyzeSession.ts` (+test), `src/shared/dto.ts` (`analysisSchema.taskType`),
  `src/core/analysis/changes.ts` (import shared `TERMINAL_TOOL`, already moved in 4.0)

**Interfaces:**

- Consumes: `classifyIntent` (existing), `summarizeChanges`, `Outcomes` (4.1–4.4) via `SessionDetail.outcomes`.
- Produces:
  - `type TaskType = 'bugfix' | 'feature' | 'refactor' | 'test' | 'docs' | 'explain' | 'debug' | 'config' | 'other'`
  - `classifyTask(input: { intent: Intent; changed: { path: string; action: string }[]; commandCount: number }): { type: TaskType; rule: string }`
  - `buildOutcomeSentence(input: OutcomeInput): string` where
    `OutcomeInput = { taskType: TaskType; changed: {path;action}[]; areas: string[]; linesAdded: number | null; linesRemoved: number | null; testFilesCreated: number; testsPassed: boolean | null; testFailures: number | null; errorsDelta: number | null; undone: number; failedTurns: number; userTurns: number }`
  - `analysisSchema` gains `taskType: measured(z.string())`; `ANALYZER_VERSION = 2`.

- [ ] **Step 1: Failing tests** `taskType.test.ts` (rules, in order):
  1. Prompt intent wins when it is not `other` (`bugfix` → `bugfix`; rule string `"prompt keyword: bugfix"`).
  2. Intent `other` or missing and every changed path matches `/(^|[\\/])(tests?|__tests__)[\\/]|\.(test|spec)\.[a-z]+$/i` → `test`.
  3. …every changed path is `.md`/`.mdx`/`.rst`/`docs/` → `docs`.
  4. …every changed path is config (`.json|.ya?ml|.toml|.lock|.ini`, `Dockerfile`, `.github/`, `.eslintrc*`, `tsconfig*`) → `config`.
  5. No changes and no terminal commands → `explain`; no changes but commands → `debug`.
  6. Otherwise changes exist → `feature` if any file was created, else `refactor`… **No** — an edit without a
     prompt cue is not knowable; return `other` with rule `"no deterministic signal"`.
     Test each rule plus an ordering case (prompt says `docs` but files are tests → `docs`).

`outcomeSentence.test.ts` **golden** cases (write these exact strings):

```ts
const base = {
  taskType: 'bugfix' as const,
  changed: [],
  areas: [],
  linesAdded: null,
  linesRemoved: null,
  testFilesCreated: 0,
  testsPassed: null,
  testFailures: null,
  errorsDelta: null,
  undone: 0,
  failedTurns: 0,
  userTurns: 1,
};

it('full evidence', () => {
  expect(
    buildOutcomeSentence({
      ...base,
      taskType: 'bugfix',
      changed: [
        { path: '/r/src/execution/a.ts', action: 'edited' },
        { path: '/r/src/persistence/b.ts', action: 'edited' },
        { path: '/r/src/execution/a.test.ts', action: 'created' },
        { path: '/r/src/persistence/b.test.ts', action: 'created' },
      ],
      areas: ['execution', 'persistence'],
      linesAdded: 120,
      linesRemoved: 30,
      testFilesCreated: 2,
      testsPassed: true,
      errorsDelta: -2,
    }),
  ).toBe(
    'Bug fix: changed 4 files (2 edited, 2 created; +120 −30 lines), added 2 test files, tests passed on the last run, 2 fewer diagnostics errors — in execution, persistence.',
  );
});
it('no changes', () => {
  expect(buildOutcomeSentence({ ...base, taskType: 'explain' })).toBe('Explanation: no files changed.');
});
it('failures and undo are stated plainly', () => {
  expect(
    buildOutcomeSentence({
      ...base,
      taskType: 'feature',
      changed: [{ path: '/r/x.ts', action: 'created' }],
      areas: ['r'],
      testsPassed: false,
      testFailures: 3,
      undone: 1,
      failedTurns: 1,
      userTurns: 4,
    }),
  ).toBe(
    'Feature: changed 1 file (1 created), tests failed on the last run (3 failing runs), 1 edit undone, 1 of 4 turns failed — in r.',
  );
});
it('omits every clause it has no evidence for', () => {
  expect(
    buildOutcomeSentence({ ...base, taskType: 'other', changed: [{ path: '/r/x.ts', action: 'edited' }] }),
  ).toBe('Session: changed 1 file (1 edited).');
});
```

Labels: bugfix→`Bug fix`, feature→`Feature`, refactor→`Refactor`, test→`Tests`, docs→`Docs`, explain→`Explanation`,
debug→`Debugging`, config→`Config change`, other→`Session`. Clause order: changed files
(`changed N file(s) (a edited, b created, c deleted[; +X −Y lines])`, lines only when non-null, minus sign is
`−` U+2212), `added N test file(s)`, tests (`tests passed on the last run` / `tests failed on the last run (N failing runs)`),
diagnostics (`N fewer diagnostics errors` / `N more diagnostics errors`, only when ≠ 0), `N edit(s) undone`,
`K of M turns failed`; joined with `, `; areas suffix ` — in a, b`; ends with `.`. If no files changed the
first clause is `no files changed` and the sentence is `${Label}: no files changed.` when nothing else applies.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** both modules (pure, no imports beyond types/`Intent`).
- [ ] **Step 4: Wire into `analyzeSession`.** `analysis.taskType = inferred(type, rule)` (source = rule string;
      `unavailable('no prompt text and no file evidence')` never — `other` is a valid value). `outcome` becomes
      `derived(buildOutcomeSentence(...), 'file events, git snapshots, terminal runs, diagnostics and turn state')`
      **downgraded to `inferred` when `taskType.provenance.kind` is inferred** — the sentence contains the
      keyword-classified label, so use `weakest(...)` from `provenance.ts`. Update `analyzeSession.test.ts`:
      the existing outcome expectations change to the new sentences (recompute them from the new rules; do not
      loosen assertions). `testFilesCreated` = created paths matching the test regex. Bump `ANALYZER_VERSION` to 2.
- [ ] **Step 5:** update `analysisSchema` + `dtoFixtures.ts` + any `Analysis` literal; SessionsView shows the
      outcome sentence already via `outcome` — verify a view test still passes.
- [ ] **Step 6:** `pnpm format && pnpm verify` → PASS. **Step 7: Commit**

```bash
git add -A
git commit -m "feat(analysis): add deterministic task taxonomy and outcome sentence with evidence"
```

---

### Task 4.6: Commit linking and cost per commit

**Files:**

- Create: `src/core/outcomes/commitLink.ts`, `commitLink.test.ts`, `src/core/query/commitCosts.ts`,
  `commitCosts.test.ts`
- Modify: `src/extension/observers/liveObserver.ts` (+test), `src/core/query/sessionOutcomes.ts`,
  `src/core/query/insightsQueries.ts`, `src/shared/{dto,protocol}.ts`, `src/extension/extension.ts`,
  `src/shared/dto.provenance.test.ts` (`ALLOWED`)

**Interfaces:**

- Consumes: `GitCommit` (4.1), `ObservationStore.replaceSessionCommits/sessionCommits` (4.0).
- Produces:
  - `linkCommits(session: { startedAt: number; endedAt: number; editedPaths: readonly string[] }, commits: readonly GitCommit[], windowMs?: number): { hash: string; committedAt: number; overlapFiles: number; editedFiles: number }[]`
    with `COMMIT_WINDOW_MS = 86_400_000`.
  - `getCommitCosts(database: Pick<Database,'db'>): CommitCostRow[]`,
    `CommitCostRow = { hash: string; committedAt: number; sessions: number; credits: MeasuredNumber }`.
  - DTO: `outcomes.commits: z.array(z.object({ hash: z.string(), committedAt: z.number(), overlapFiles: z.number(), editedFiles: z.number(), credits: measuredNumber }))`;
    protocol `getCommitCosts: { params: z.object({}), result: z.object({ rows: z.array(commitCostRowSchema) }) }`.
    `ALLOWED` additions: `sessionDetail: 'outcomes.commits[].committedAt' | '…overlapFiles' | '…editedFiles'`,
    `commitCosts: 'rows[].committedAt' | 'rows[].sessions'`.

- [ ] **Step 1: Failing tests** `commitLink.test.ts`:

```ts
const session = { startedAt: 1000, endedAt: 5000, editedPaths: ['/r/a.ts', '/r/b.ts'] };
const commit = (hash: string, committedAt: number, ...files: string[]) => ({ hash, committedAt, files });

it('links commits after the session start that touch an edited file', () => {
  const links = linkCommits(session, [
    commit('c1', 6000, '/r/a.ts', '/r/z.ts'),
    commit('c2', 7000, '/r/z.ts'),
  ]);
  expect(links).toEqual([{ hash: 'c1', committedAt: 6000, overlapFiles: 1, editedFiles: 2 }]);
});
it('ignores commits before the session started or after the window', () => {
  expect(
    linkCommits(session, [commit('old', 500, '/r/a.ts'), commit('late', 5000 + 86_400_001, '/r/a.ts')]),
  ).toEqual([]);
});
it('links nothing for a session that edited no files', () => {
  expect(linkCommits({ ...session, editedPaths: [] }, [commit('c', 6000, '/r/a.ts')])).toEqual([]);
});
```

`commitCosts.test.ts`: seed sessions with credits (via `seededStore` helper from `test/fixtures/sessions.ts`
or direct inserts — copy the approach from `overview.test.ts`) and `session_commits`:
session S1 (credits 6, links c1,c2) and S2 (credits 3, links c2) → c1 = 3 (derived), c2 = 3 + 3 = 6 (derived,
`sessions: 2`); a linked session with unavailable credits → that commit's value is a `derived` lower bound
whose source contains `lower bound`; commit whose sessions all lack credits → `unavailable`. Source string:
`session credits split evenly across the commits each session links to`.

- [ ] **Step 2: Run → FAIL. Step 3: Implement.**
      `linkCommits`: `edited = new Set(paths)`; for each commit with `committedAt ≥ session.startedAt` and
      `≤ session.endedAt + windowMs`, `overlap = commit.files.filter(f => edited.has(f)).length`; keep when `> 0`;
      sort by `committedAt`.
      `getCommitCosts`: SQL
      `SELECT c.hash, c.committed_at, c.session_id, s_credit.credits, (SELECT COUNT(*) FROM session_commits x WHERE x.session_id = c.session_id) AS n FROM session_commits c LEFT JOIN (SELECT session_id, SUM(credits) AS credits, COUNT(credits) AS with_credit, COUNT(*) AS turns FROM turns WHERE model_host != 'byok' GROUP BY session_id) s_credit ON s_credit.session_id = c.session_id`
      then group by hash in JS: share = `credits / n` for sessions whose credits are non-null; `lowerBound` when any
      linked session lacks credits **or** a session's `with_credit < turns` (`summed`-style). Return `derived`.
- [ ] **Step 4: `LiveObserver.linkCommits()`** — for sessions with `ended_at ≥ now − 7 d` and at least one
      `edited/created` path: `repos = await git.repos()`, pick repos whose root prefixes any edited path,
      `commitsSince(session.startedAt)`, `linkCommits(...)`, `observations.replaceSessionCommits(id, links.map(l => ({...l, linkedAt: now})))`.
      Throttle: skip a session when its stored `linked_at` is < 5 min old and its `ended_at` hasn't changed. Unit-test
      with a fake `GitPort`: links stored; second tick within throttle doesn't call `commitsSince`; no repo → nothing
      stored and no throw; throwing `commitsSince` is caught per session.
- [ ] **Step 5: Outcomes query:** `outcomes.commits` = stored links, each with
      `credits` = session credits ÷ number of links (`derived`, `unavailable` if session credits are unavailable).
      Wire `getCommitCosts` through `InsightsQueries`, protocol, and the `extension.ts` handlers map. Update
      `ALLOWED`.
- [ ] **Step 6:** `pnpm format && pnpm verify` → PASS. **Step 7: Commit**

```bash
git add -A
git commit -m "feat(outcomes): link sessions to commits and attribute credits per commit"
```

---

### Task 4.7: UI, docs, release 0.6.0

**Files:**

- Create: `src/webview/views/OutcomeCard.tsx`, `OutcomeCard.test.tsx`
- Modify: `src/webview/views/SessionDetailView.tsx`, `OverviewView.tsx` (+tests), `src/webview/test/dtoFixtures.ts`,
  `src/webview/test/fakeHost.tsx`, `docs/copilot-data-formats.md`, `docs/ROADMAP.md`, `README.md`,
  `package.json` (version `0.6.0`), `CHANGELOG` if one exists

**Interfaces:**

- Consumes: `SessionDetail.outcomes`, `getSurvivalByModel`, `getCommitCosts` RPCs, `Measure`, `ProvenanceBadge`.
- Produces: `<OutcomeCard outcomes={Outcomes} />`; Overview sections "Edit survival by model" and "Commits".

- [ ] **Step 1: Failing test** `OutcomeCard.test.tsx` (style of `GithubUsageCard.test.tsx`; read it first):
  - With full evidence renders rows **Lines changed** (`+120 −30`), **Copilot edits kept/undone/modified**,
    **Later survival** (`82%`), **Terminal runs** / **Failed** / **Test runs** / **Last test run** (`Passed`|`Failed`),
    **Diagnostics errors** (`−2`), **Commits** (short hash `abc1234` + credits) — each value inside a `Measure`
    (provenance badge present: `getAllByText(/derived|exact/i)` — copy the query style from existing tests).
  - With everything `unavailable` renders `—` placeholders plus one explanatory line
    `Outcome evidence is collected only while VS Code is open with this extension.` and **no** `0`s
    (`expect(screen.queryByText('0')).toBeNull()`).
  - A `lower bound` measure renders with `≥ `.
- [ ] **Step 2: Run → FAIL. Step 3: Implement** `OutcomeCard` (`<section className="card" aria-label="Outcome">`,
      `<dl className="facts">` like `AnalysisCard`); format helpers: percent `Math.round(v*100)+'%'`, signed delta with
      `−`/`+`. Add `taskType` row to `AnalysisCard`. Render `<OutcomeCard>` in `SessionDetailView` after
      `AnalysisCard`. No `dangerouslySetInnerHTML`; commit hashes are plain text.
- [ ] **Step 4: Overview** — two `useQuery` calls via the existing `rpcContext` pattern (copy how
      `GithubUsageCard`/diagnostics fetch); tables use `DataTable`. Keep-rate and survival are `Measure`s;
      commit hash shown as first 7 chars. Add tests with `fakeHost` responses (`getSurvivalByModel`,
      `getCommitCosts`) — update `fakeHost.tsx` to answer them.
- [ ] **Step 5: Docs.**
  - `docs/copilot-data-formats.md`: document `textEditGroup.edits` shape as used, that only salted line
    fingerprints are derived from it, and the live-observation tables (git snapshots, diagnostics, terminal runs,
    survival checks, session commits) with the rule "no text, only counts/paths/salted hashes".
  - `README.md` privacy section: describe fingerprints (D-P4-3), what "clear" removes, and that git/terminal/
    diagnostics evidence exists only while VS Code is open.
  - `docs/ROADMAP.md`: mark Phase 4 done with the shipped version and note D-P4-1…5.
- [ ] **Step 6: Version** `package.json` → `0.6.0`.
- [ ] **Step 7: Full verification** — `pnpm format && pnpm verify`, `pnpm test:integration` (stable and
      1.105.0), `pnpm smoke:real` (aggregate only; confirm it still reports all requests became turns and that the
      new tables exist/empty without error).
- [ ] **Step 8: Update project memory** (`copilot-insights-status.md`): Phase 4 done, HEAD hash, test counts,
      "Next: write Phase 5 plan".
- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(outcomes): show outcome evidence in the dashboard; document data; release 0.6.0"
```

---

## Self-Review

- **Spec coverage:** 4.1 → Task 4.1 (lines, HEAD; integration test with temp repo). 4.2 → Task 4.2 (keep/undo/
  modified per session and per model; +1h/+1d/next-commit fingerprint checks). 4.3 → Task 4.3 (exit codes matched
  to tool calls and system-initiated turns; provenance). 4.4 → Task 4.4 (pure delta tests). 4.5 → Task 4.5
  (taxonomy + golden sentences). 4.6 → Task 4.6 (temp-repo adapter covered by 4.1's integration test; pure
  linking tests; cost per commit). Schema/privacy/cleanup → Task 4.0. UI/docs/release → Task 4.7.
- **Placeholder scan:** none intentionally left; the two places that say "read the existing test file and copy
  its setup" (Tasks 4.0 Step 6, 4.7 Step 1) name the exact file to copy from because those helper signatures were
  not re-read while writing this plan.
- **Type consistency:** `ObservationStore` names in 4.0 are the ones used in 4.1–4.6 (`saveSnapshot`,
  `getSnapshots`, `saveDiagnostics`, `getDiagnostics`, `addTerminalRun`, `terminalRunsBetween`,
  `saveSurvivalCheck`, `survivalChecks`, `replaceSessionCommits`, `sessionCommits`, `touch`, `lastChangeAt`).
  `StoredSnapshot` has `repoRoot` (used by `diffSnapshots`). `TERMINAL_TOOL` lives in
  `src/core/ingest/toolNames.ts` from 4.0 onward.
- **Known risks to watch during execution:** (1) `--disable-extensions` may hide `vscode.git` in integration
  tests (Task 4.1 Step 11 has the fallback); (2) `vscode.git` `log({ since })` and `diffBetween` behaviour on
  the 1.105.0 floor — if unavailable there, degrade the adapter to `[]` and keep the integration test on stable
  only, recording the difference in the plan; (3) `getDiagnostics()` cost on very large workspaces — capped at
  500 files.
