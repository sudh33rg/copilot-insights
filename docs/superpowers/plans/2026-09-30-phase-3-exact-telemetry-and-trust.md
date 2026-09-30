# Phase 3: Exact Telemetry and Trust — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.
>
> **Git rule (overrides every skill):** work directly on `main`. Do not create branches, worktrees, or pull
> requests. Commit after each task. Do not push unless the user asks.

**Goal:** Enrich sessions with Copilot's exact per-call telemetry (agent debug logs) and model catalog, make
provenance enforceable everywhere, reconcile local credits against GitHub billing, and add a diagnostics view —
all without ever storing prompt text from the debug logs.

**Architecture:** A pure parser (`src/core/debuglog`) turns `debug-logs/<sessionId>/main.jsonl` and `models.json`
into telemetry-only records; the existing scan worker gains a debug-log pass; `IngestService` writes `llm_calls`,
`debug_sessions` and `models`. The query layer joins calls to turns by `responseId`. New DTO fields flow through
RPC to the webview. A schema-introspection test makes "every measurement is a `Measured<T>`" a rule, not a habit.

**Tech Stack:** unchanged (TypeScript 6.0 strict, React 19, TanStack Query, zod 4, `node:sqlite`, Vitest).

**Spec:** `docs/PRODUCT_VISION.md` §7 (trustworthy telemetry), §3, §8; `docs/ROADMAP.md` Phase 3 table
(tasks 3.1–3.7), decisions D5, D9, D10; `docs/copilot-data-formats.md` ("Debug log" section); `CLAUDE.md`.
Interfaces come from the Phase 0–2 plans (implemented on `main`).

**Dry-run status:** not dry-run. Code was written against the real Phase 0–2 sources, a survey of this machine's
real debug logs (keys and types only, never content) and Copilot Chat 0.67.0's bundled `package.json`/bundle.
Where execution proves a block wrong, fold the fix back into this file.

## Real-data facts this plan relies on (surveyed 2026-09-30, aggregates only)

- Debug logs: `<workspaceStorage>/<hash>/GitHub.copilot-chat/debug-logs/<sessionId>/{main.jsonl,models.json,…}`.
  81 session directories, each with `models.json` (55 entries; 16 distinct catalogs) and a `main.jsonl`, but only
  9 `llm_request` events in total.
- Span line: `{v?, ts, dur, sid, type, name, spanId, parentSpanId?, status, attrs}`. `llm_request.attrs` has
  `model, debugName, inputTokens, outputTokens, cachedTokens, ttft, responseId, copilotUsageNanoAiu, maxTokens,
requestOptions, requestShape, userRequest, inputMessages, systemPromptFile, toolsFile`. **`userRequest`,
  `inputMessages`, `requestOptions`, `requestShape` and every `tool_call`/`user_message`/`agent_response` payload
  contain conversation content and must never be read into a stored value.**
- `session_start.attrs` has `copilotVersion` and `vscodeVersion` (several per file).
- Copilot Chat's own `debugName` literals (from its bundle): `title, summarize, summarizeConversationHistory,
progressMessages, contextualProgressMessage, promptCategorization, git-branch, healStringReplace,
healApplyPatch, modelList, contentExclusion, testSetupAutomaticFrameworkID, setupTestDeriveName,
backgroundTodoAgent, nes.nextCursorPosition`; agent requests are named `panel/<agent>` (observed
  `panel/editAgent`) and inline ones `inline/…`.
- `models.json` entry: `id, name, vendor, version, capabilities.family, capabilities.limits.{max_context_window_tokens,
max_output_tokens,max_prompt_tokens}, billing.token_prices.{batch_size, default.{input_price,output_price,
cache_read_price,cache_write_price,max_prompt_tokens}, long_context.…}, model_picker_category,
model_picker_price_category, is_chat_default, policy.state`.
- The setting that turns debug logging on is `github.copilot.chat.agentDebugLog.fileLogging.enabled`
  (default `false`; Copilot Chat 0.67.0).
- The relation between `copilotUsageNanoAiu` and "Copilot credits" is not documented: **never convert or compare
  them**. Show nano-AIU as its own exact field.

## Global Constraints

- Work on `main` only; one Conventional Commit per task; never push without being asked.
- Before every commit: `pnpm format && pnpm verify` must pass. Run `pnpm test:integration` after Tasks 3.1,
  3.4 and 3.7 and `pnpm smoke:real` after Tasks 3.1 and 3.7.
- Layering (ESLint-enforced): `shared` → nothing environment-specific; `core` → `node:*`, `zod`, `shared`;
  `extension` → `vscode`, `core`, `shared`; `webview` → `react`, browser, `shared`.
- **Debug-log content is never stored, logged or sent to the webview**: parsers read named numeric/identifier
  fields only; tests plant sentinel strings (`SECRET-…`) in every content field and assert they never appear in
  parsed output, the database file, or any DTO.
- Every measurement is a `Measured<T>`; sums over partial data are at most `derived` (`summed()`); estimates are
  never mixed into exact totals; `unavailable` is never shown as zero.
- Debug logging is enabled only after an explicit confirmation modal; never silently, never by a background task.
- Never modify or delete Copilot's own files (including `debug-logs`); never divide GitHub credits across sessions.
- No network in this phase. SQL uses named parameters only.
- Migrations are append-only (`MIGRATIONS` array; index + 1 = `PRAGMA user_version`).

## Review Focus

1. **Debug logs contain the user's prompts.** Sentinel text in `userRequest`/`inputMessages`/`user_message`/
   `tool_call` must not survive parsing, storage or any DTO. Tests: Tasks 3.1 and 3.7.
2. **Copilot is writing the log while we read it** (truncated last line, growing file) → parse the complete
   lines, re-parse on the next change; never throw. Tests: Task 3.1.
3. **A log for a deleted or never-indexed session** must not resurrect data: deleted sessions' calls are removed,
   tombstoned sessions' logs are skipped, retention purges calls with their session. Tests: Tasks 3.1 and 3.6.
4. **Unknown `debugName`s are not guessed.** They classify as `UNKNOWN` and are surfaced in diagnostics so the
   table can be extended from data. Tests: Tasks 3.1 and 3.7.
5. **Reconciliation must not mislead.** Coverage above 100 %, days with billed credits but no local data, and
   billed = 0 each render an explicit, honest state (never a division by zero or a negative remainder). Test: 3.6.

## File Structure

```
src/core/debuglog/types.ts            DebugRole, LlmCall, DebugSessionLog
src/core/debuglog/debugNames.ts       classifyDebugName (data-derived table)
src/core/debuglog/parseDebugLog.ts    main.jsonl → telemetry-only records (no content)
src/core/debuglog/parseModels.ts      models.json → CatalogModel[]
src/core/debuglog/scanner.ts          find + fingerprint + parse debug files (worker-safe)
src/core/storage/llmCallStore.ts      llm_calls / debug_sessions persistence
src/core/storage/catalogStore.ts      models persistence
src/core/storage/migrations.ts        (modified) v4 llm_calls+debug_sessions, v5 models
src/core/ingest/scanAll.ts            chat sessions + debug logs in one worker pass
src/core/query/internalUsage.ts       utility-call totals from debug logs
src/core/query/coverage.ts            local vs GitHub-billed credits per day
src/core/query/diagnostics.ts         drift, debug-log and catalog diagnostics
src/core/telemetry/consent.ts         enable-debug-logging flow (injected ask/enable)
src/shared/dto.ts                     (modified) telemetry fields, internal usage, coverage, diagnostics
src/extension/telemetry.ts            setting access + confirmation modal
src/webview/views/DiagnosticsView.tsx diagnostics tab
test/fixtures/debugLogs/…             synthetic debug logs and models.json
```

---

## Task 3.1: Debug-log parsing, storage and the join to turns

**Files:**

- Create: `test/fixtures/debugLogs/fx-auto-1/main.jsonl`, `src/core/debuglog/types.ts`, `debugNames.ts`,
  `debugNames.test.ts`, `parseDebugLog.ts`, `parseDebugLog.test.ts`, `scanner.ts`, `scanner.test.ts`,
  `src/core/storage/llmCallStore.ts`, `llmCallStore.test.ts`, `src/core/ingest/scanAll.ts`
- Modify: `test/fixtures/fixtures.ts`, `src/core/ingest/scanner.ts` (export two helpers),
  `src/core/ingest/runScan.ts`, `src/core/ingest/scanWorker.ts`, `src/core/ingest/ingestService.ts` (+test),
  `src/core/storage/migrations.ts` (v4), `src/core/storage/sessionStore.ts` (`purgeBefore`),
  `src/core/clear/clearService.ts` (+test), `src/shared/dto.ts`, `src/core/query/measure.ts`,
  `src/core/query/sessionDetail.ts` (+test), `test/fixtures/turns.ts`, `src/webview/test/dtoFixtures.ts`,
  `src/webview/views/SessionDetailView.tsx` (+test)

**Interfaces:**

- Consumes: `isRecord`, `StorageRoot`, `safeReaddir`/`fileFingerprint` (exported here), `IngestService`,
  `SessionStore`, `IngestStateStore` (fingerprints, tombstones), `getSessionDetail`, `known`/`SOURCES`.
- Produces (`types.ts`): `DebugRole = 'USER_FACING' | 'COPILOT_INTERNAL' | 'UNKNOWN'`, `LlmCall`, `DebugSessionLog`.
- Produces: `classifyDebugName(name: string | null): DebugRole`, `parseDebugLog(sessionId, text): DebugSessionLog`,
  `scanDebugLogs(input: DebugScanInput): DebugScanOutput`, `LlmCallStore { replaceSession(log, file, now);
deleteSessions(ids) }`, `scanAll(input: ScanInput): FullScanOutput`.
- Produces (DTO): `TurnDetail.{cachedTokens, ttftMs, nanoAiu}: MeasuredNumber` (exact when the turn's
  `responseId` matches a logged `llm_request`, else `unavailable`), `SessionDetail.debug:
{ calls, internalCalls, unmatchedCalls } | null`.
- Rule: telemetry fields only; `role` comes from `debugName`, never from any prompt text.

- [ ] **Step 1: Add the synthetic debug-log fixture**

Every line is one line. It mirrors the real format and plants `SECRET-…` sentinels in all content fields.
`test/fixtures/debugLogs/fx-auto-1/main.jsonl`:

```jsonl
{"v":1,"ts":1790000000000,"dur":0,"sid":"fx-auto-1","type":"session_start","name":"session_start","spanId":"s0","status":"ok","attrs":{"copilotVersion":"0.99.0","vscodeVersion":"1.99.0"}}
{"v":1,"ts":1790000000100,"dur":0,"sid":"fx-auto-1","type":"session_start","name":"session_start","spanId":"s0b","status":"ok","attrs":{"copilotVersion":"0.98.0","vscodeVersion":"1.98.0"}}
{"ts":1790000001500,"dur":0,"sid":"fx-auto-1","type":"user_message","name":"user_message","spanId":"u1","status":"ok","attrs":{"content":"SECRET-PROMPT-TEXT"}}
{"ts":1790000002000,"dur":8000,"sid":"fx-auto-1","type":"llm_request","name":"llm_request","spanId":"l1","parentSpanId":"t1","status":"ok","attrs":{"model":"gpt-5.6-luna","debugName":"panel/editAgent","inputTokens":24000,"outputTokens":1700,"cachedTokens":18000,"ttft":2100,"responseId":"llm-resp-1","copilotUsageNanoAiu":1126141000,"maxTokens":128000,"requestOptions":"SECRET-OPTIONS","requestShape":"SECRET-SHAPE","userRequest":"SECRET-USER-REQUEST","inputMessages":"SECRET-MESSAGES","systemPromptFile":"system_prompt_0.json","toolsFile":"tools_0.json"}}
{"ts":1790000030000,"dur":0,"sid":"fx-auto-1","type":"tool_call","name":"read_file","spanId":"tc1","parentSpanId":"t1","status":"ok","attrs":{"args":"SECRET-ARGS","result":"SECRET-RESULT"}}
{"ts":1790000061000,"dur":9000,"sid":"fx-auto-1","type":"llm_request","name":"llm_request","spanId":"l2","parentSpanId":"t2","status":"ok","attrs":{"model":"gpt-5.6-luna","debugName":"panel/editAgent","inputTokens":30000,"outputTokens":900,"cachedTokens":25000,"ttft":1800,"responseId":"llm-resp-2","copilotUsageNanoAiu":500000000,"userRequest":"SECRET-USER-REQUEST-2","inputMessages":"SECRET-MESSAGES-2"}}
{"ts":1790000003000,"dur":400,"sid":"fx-auto-1","type":"llm_request","name":"llm_request","spanId":"l3","status":"ok","attrs":{"model":"gpt-4o-mini","debugName":"title","inputTokens":300,"outputTokens":12,"cachedTokens":0,"ttft":300,"responseId":"llm-resp-title","copilotUsageNanoAiu":2000000,"inputMessages":"SECRET-TITLE-MESSAGES"}}
{"ts":1790000004000,"dur":100,"sid":"fx-auto-1","type":"llm_request","name":"llm_request","spanId":"l4","status":"ok","attrs":{"model":"gpt-4o-mini","debugName":"mystery-thing","inputTokens":10,"outputTokens":1,"responseId":"llm-resp-x"}}
{"ts":1790000090000,"dur":0,"sid":"fx-auto-1","type":"agent_response","name":"agent_response","spanId":"a1","status":"ok","attrs":{"response":"SECRET-RESPONSE","reasoning":"[encrypted]"}}
{"ts":1790000095000,"dur":10,"sid":"fx-auto-1","type":"llm_req
```

Register it in `test/fixtures/fixtures.ts`: inside `createFixtureUserDir`, after the chat-session copies, add

```ts
const debugDir = join(workspaceDir, 'GitHub.copilot-chat', 'debug-logs', 'fx-auto-1');
mkdirSync(debugDir, { recursive: true });
copyFileSync(join(DEBUG_LOG_FIXTURES, 'fx-auto-1', 'main.jsonl'), join(debugDir, 'main.jsonl'));
```

and export `DEBUG_LOG_FIXTURES = fileURLToPath(new URL('./debugLogs/', import.meta.url))` next to
`CHAT_SESSION_FIXTURES`. Add a line to `test/fixtures/README.md`: "debug-log fixtures contain `SECRET-*`
sentinels; tests assert these never reach storage."

- [ ] **Step 2: Write the failing classification and parser tests**

`src/core/debuglog/debugNames.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifyDebugName } from './debugNames';

describe('classifyDebugName', () => {
  it.each(['panel/editAgent', 'panel/ask', 'inline/chat'])('%s is user-facing', (name) => {
    expect(classifyDebugName(name)).toBe('USER_FACING');
  });

  it.each([
    'title',
    'summarize',
    'summarizeConversationHistory',
    'progressMessages',
    'contextualProgressMessage',
    'promptCategorization',
    'git-branch',
    'healStringReplace',
    'healApplyPatch',
    'modelList',
    'contentExclusion',
    'backgroundTodoAgent',
  ])('%s is a Copilot-internal utility call', (name) => {
    expect(classifyDebugName(name)).toBe('COPILOT_INTERNAL');
  });

  it('does not guess for names it has not seen', () => {
    expect(classifyDebugName('mystery-thing')).toBe('UNKNOWN');
    expect(classifyDebugName('retry-')).toBe('UNKNOWN');
    expect(classifyDebugName('')).toBe('UNKNOWN');
    expect(classifyDebugName(null)).toBe('UNKNOWN');
  });

  it('classifies by name only, never by lookalike prefixes or case', () => {
    expect(classifyDebugName('titleX')).toBe('UNKNOWN');
    expect(classifyDebugName('Title')).toBe('UNKNOWN');
    expect(classifyDebugName('notpanel/x')).toBe('UNKNOWN');
  });
});
```

`src/core/debuglog/parseDebugLog.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEBUG_LOG_FIXTURES } from '../../../test/fixtures/fixtures';
import { parseDebugLog } from './parseDebugLog';

const fixture = readFileSync(join(DEBUG_LOG_FIXTURES, 'fx-auto-1', 'main.jsonl'), 'utf8');

describe('parseDebugLog', () => {
  it('extracts one call per llm_request with exact numeric telemetry', () => {
    const log = parseDebugLog('fx-auto-1', fixture);
    expect(log.calls.map((call) => call.spanId)).toEqual(['l1', 'l2', 'l3', 'l4']);
    expect(log.calls[0]).toEqual({
      sessionId: 'fx-auto-1',
      spanId: 'l1',
      responseId: 'llm-resp-1',
      startedAt: 1790000002000,
      durationMs: 8000,
      model: 'gpt-5.6-luna',
      debugName: 'panel/editAgent',
      role: 'USER_FACING',
      inputTokens: 24000,
      outputTokens: 1700,
      cachedTokens: 18000,
      ttftMs: 2100,
      nanoAiu: 1126141000,
    });
  });

  it('classifies utility and unknown calls from debugName and leaves missing numbers null', () => {
    const calls = parseDebugLog('fx-auto-1', fixture).calls;
    expect(calls[2]).toMatchObject({ role: 'COPILOT_INTERNAL', debugName: 'title' });
    expect(calls[3]).toMatchObject({ role: 'UNKNOWN', cachedTokens: null, ttftMs: null, nanoAiu: null });
  });

  it('takes the first Copilot and VS Code versions it sees', () => {
    const log = parseDebugLog('fx-auto-1', fixture);
    expect(log.copilotVersion).toBe('0.99.0');
    expect(log.vscodeVersion).toBe('1.99.0');
  });

  it('never keeps any conversation content', () => {
    expect(JSON.stringify(parseDebugLog('fx-auto-1', fixture))).not.toContain('SECRET');
  });

  it('counts a truncated last line and keeps everything before it', () => {
    const log = parseDebugLog('fx-auto-1', fixture);
    expect(log.badLines).toBe(1);
    expect(log.calls).toHaveLength(4);
  });

  it('ignores duplicate spans, unknown event types and malformed events', () => {
    const text = [
      '{"type":"llm_request","spanId":"a","ts":1,"attrs":{"model":"m"}}',
      '{"type":"llm_request","spanId":"a","ts":2,"attrs":{"model":"other"}}',
      '{"type":"llm_request","ts":3,"attrs":{}}',
      '{"type":"something_new","spanId":"z"}',
      '[1,2,3]',
      '"text"',
      '{"type":"llm_request","spanId":"b","ts":"not-a-number","attrs":{"inputTokens":"12","outputTokens":NaN}}',
    ].join('\n');
    const log = parseDebugLog('s', text);
    expect(log.calls.map((call) => call.spanId)).toEqual(['a']);
    expect(log.calls[0]?.model).toBe('m');
    expect(log.badLines).toBe(1);
  });

  it('is safe against prototype-polluting keys', () => {
    const log = parseDebugLog(
      's',
      '{"type":"llm_request","spanId":"a","ts":1,"attrs":{"__proto__":{"polluted":true},"model":"m"}}',
    );
    expect(log.calls[0]?.model).toBe('m');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
```

Run: `pnpm vitest run src/core/debuglog` — Expected: FAIL (modules not found).

- [ ] **Step 3: Implement classification and the parser**

`src/core/debuglog/types.ts`:

```ts
/** Who asked for a request, decided from Copilot's own `debugName` — never from prompt text. */
export type DebugRole = 'USER_FACING' | 'COPILOT_INTERNAL' | 'UNKNOWN';

/** One `llm_request` span. Numbers are exact Copilot telemetry; there is deliberately no text field. */
export interface LlmCall {
  sessionId: string;
  spanId: string;
  responseId: string | null;
  startedAt: number;
  durationMs: number | null;
  model: string | null;
  debugName: string | null;
  role: DebugRole;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  ttftMs: number | null;
  nanoAiu: number | null;
}

export interface DebugSessionLog {
  sessionId: string;
  copilotVersion: string | null;
  vscodeVersion: string | null;
  calls: LlmCall[];
  badLines: number;
}
```

`src/core/debuglog/debugNames.ts`:

```ts
import type { DebugRole } from './types';

// Seed table: the `debugName` literals Copilot Chat 0.67.0 passes for its own utility requests. Extend it from
// data (Diagnostics lists every unclassified name) — never from heuristics on prompt content.
const INTERNAL = new Set([
  'title',
  'summarize',
  'summarizeConversationHistory',
  'progressMessages',
  'contextualProgressMessage',
  'promptCategorization',
  'git-branch',
  'healStringReplace',
  'healApplyPatch',
  'modelList',
  'contentExclusion',
  'testSetupAutomaticFrameworkID',
  'setupTestDeriveName',
  'backgroundTodoAgent',
  'nes.nextCursorPosition',
]);

// Agent/chat requests are named `<surface>/<agent>` (observed: `panel/editAgent`).
const USER_FACING = /^(panel|inline)\/.+/;

export function classifyDebugName(name: string | null): DebugRole {
  if (name === null) return 'UNKNOWN';
  if (USER_FACING.test(name)) return 'USER_FACING';
  return INTERNAL.has(name) ? 'COPILOT_INTERNAL' : 'UNKNOWN';
}
```

`src/core/debuglog/parseDebugLog.ts`:

```ts
import { isRecord } from '../json';
import { classifyDebugName } from './debugNames';
import type { DebugSessionLog, LlmCall } from './types';

const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/**
 * Reads only named identifier/numeric fields. `userRequest`, `inputMessages`, tool arguments and results and
 * message content are never read, so they cannot leak into storage.
 */
export function parseDebugLog(sessionId: string, content: string): DebugSessionLog {
  const log: DebugSessionLog = {
    sessionId,
    copilotVersion: null,
    vscodeVersion: null,
    calls: [],
    badLines: 0,
  };
  const seen = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      log.badLines++;
      continue;
    }
    if (!isRecord(event) || typeof event.type !== 'string') continue;
    const attrs = isRecord(event.attrs) ? event.attrs : {};
    if (event.type === 'session_start') {
      log.copilotVersion ??= text(attrs.copilotVersion);
      log.vscodeVersion ??= text(attrs.vscodeVersion);
      continue;
    }
    if (event.type !== 'llm_request') continue;
    const spanId = text(event.spanId);
    const startedAt = number(event.ts);
    if (spanId === null || startedAt === null || seen.has(spanId)) continue;
    seen.add(spanId);
    const debugName = text(attrs.debugName);
    const call: LlmCall = {
      sessionId,
      spanId,
      responseId: text(attrs.responseId),
      startedAt,
      durationMs: number(event.dur),
      model: text(attrs.model),
      debugName,
      role: classifyDebugName(debugName),
      inputTokens: number(attrs.inputTokens),
      outputTokens: number(attrs.outputTokens),
      cachedTokens: number(attrs.cachedTokens),
      ttftMs: number(attrs.ttft),
      nanoAiu: number(attrs.copilotUsageNanoAiu),
    };
    log.calls.push(call);
  }
  return log;
}
```

Note on the malformed-events test: the line with `NaN` is invalid JSON, so it counts as a bad line (1) and the
line with `"ts":"not-a-number"` is skipped without counting; adjust nothing.

Run: `pnpm vitest run src/core/debuglog` — Expected: PASS.

- [ ] **Step 4: Migration v4 and the store (test first)**

`src/core/storage/llmCallStore.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEBUG_LOG_FIXTURES } from '../../../test/fixtures/fixtures';
import { parseDebugLog } from '../debuglog/parseDebugLog';
import { Database } from './database';
import { LlmCallStore } from './llmCallStore';

const log = () =>
  parseDebugLog('fx-auto-1', readFileSync(join(DEBUG_LOG_FIXTURES, 'fx-auto-1', 'main.jsonl'), 'utf8'));
const count = (database: Database, table: string): number =>
  (database.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('LlmCallStore', () => {
  it('stores calls and session metadata, and replaces a session on re-parse', () => {
    const database = new Database(':memory:');
    const store = new LlmCallStore(database);
    store.replaceSession(log(), '/x/main.jsonl', 5);
    store.replaceSession(log(), '/x/main.jsonl', 6);
    expect(count(database, 'llm_calls')).toBe(4);
    expect(database.db.prepare('SELECT * FROM debug_sessions').get()).toMatchObject({
      session_id: 'fx-auto-1',
      copilot_version: '0.99.0',
      calls: 4,
    });
    expect(database.db.prepare("SELECT role FROM llm_calls WHERE span_id = 'l3'").get()).toEqual({
      role: 'COPILOT_INTERNAL',
    });
  });

  it('stores no conversation text anywhere in the database', () => {
    const database = new Database(':memory:');
    new LlmCallStore(database).replaceSession(log(), '/x/main.jsonl', 5);
    const dump = JSON.stringify([
      database.db.prepare('SELECT * FROM llm_calls').all(),
      database.db.prepare('SELECT * FROM debug_sessions').all(),
    ]);
    expect(dump).not.toContain('SECRET');
  });

  it('deletes by session id', () => {
    const database = new Database(':memory:');
    const store = new LlmCallStore(database);
    store.replaceSession(log(), '/x/main.jsonl', 5);
    store.deleteSessions(['fx-auto-1']);
    expect(count(database, 'llm_calls')).toBe(0);
    expect(count(database, 'debug_sessions')).toBe(0);
  });
});
```

Run: `pnpm vitest run src/core/storage/llmCallStore.test.ts` — Expected: FAIL (module not found).

Append migration v4 to `MIGRATIONS`:

```ts
  `
  CREATE TABLE llm_calls (
    session_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    response_id TEXT,
    started_at INTEGER NOT NULL,
    duration_ms INTEGER,
    model TEXT,
    debug_name TEXT,
    role TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cached_tokens INTEGER,
    ttft_ms INTEGER,
    nano_aiu INTEGER,
    PRIMARY KEY (session_id, span_id)
  );
  CREATE INDEX idx_llm_calls_response ON llm_calls(response_id);
  CREATE INDEX idx_llm_calls_started ON llm_calls(started_at);

  CREATE TABLE debug_sessions (
    session_id TEXT PRIMARY KEY,
    copilot_version TEXT,
    vscode_version TEXT,
    file TEXT NOT NULL,
    calls INTEGER NOT NULL,
    bad_lines INTEGER NOT NULL DEFAULT 0,
    ingested_at INTEGER NOT NULL
  );
  `,
```

(Deliberately no foreign key to `sessions`: a debug log can be read before its chat file, and must survive that.)

`src/core/storage/llmCallStore.ts`:

```ts
import type { DebugSessionLog } from '../debuglog/types';
import type { Database } from './database';

const IDS = 'SELECT value FROM json_each(:ids)';

export class LlmCallStore {
  constructor(private readonly database: Database) {}

  replaceSession(log: DebugSessionLog, file: string, now: number): void {
    const { db } = this.database;
    this.database.transaction(() => {
      db.prepare('DELETE FROM llm_calls WHERE session_id = :id').run({ id: log.sessionId });
      const insert = db.prepare(
        `INSERT INTO llm_calls (session_id, span_id, response_id, started_at, duration_ms, model, debug_name, role,
           input_tokens, output_tokens, cached_tokens, ttft_ms, nano_aiu)
         VALUES (:sessionId, :spanId, :responseId, :startedAt, :durationMs, :model, :debugName, :role,
           :inputTokens, :outputTokens, :cachedTokens, :ttftMs, :nanoAiu)`,
      );
      for (const call of log.calls) insert.run({ ...call });
      db.prepare(
        `INSERT INTO debug_sessions (session_id, copilot_version, vscode_version, file, calls, bad_lines, ingested_at)
         VALUES (:id, :copilot, :vscode, :file, :calls, :bad, :now)
         ON CONFLICT(session_id) DO UPDATE SET copilot_version = excluded.copilot_version,
           vscode_version = excluded.vscode_version, file = excluded.file, calls = excluded.calls,
           bad_lines = excluded.bad_lines, ingested_at = excluded.ingested_at`,
      ).run({
        id: log.sessionId,
        copilot: log.copilotVersion,
        vscode: log.vscodeVersion,
        file,
        calls: log.calls.length,
        bad: log.badLines,
        now,
      });
    });
  }

  deleteSessions(ids: readonly string[]): void {
    const params = { ids: JSON.stringify(ids) };
    this.database.transaction(() => {
      this.database.db.prepare(`DELETE FROM llm_calls WHERE session_id IN (${IDS})`).run(params);
      this.database.db.prepare(`DELETE FROM debug_sessions WHERE session_id IN (${IDS})`).run(params);
    });
  }
}
```

Run: `pnpm vitest run src/core/storage` — Expected: PASS.

- [ ] **Step 5: Scan the debug logs (test first)**

Export the two helpers: in `src/core/ingest/scanner.ts` change `function safeReaddir` and
`function fileFingerprint` to `export function …` (read their current signatures first).

`src/core/debuglog/scanner.test.ts`:

```ts
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixtureUserDir } from '../../../test/fixtures/fixtures';
import { resolveStorageRoots } from '../ingest/roots';
import { scanDebugLogs, type DebugScanInput } from './scanner';

function setup(overrides: Partial<DebugScanInput> = {}) {
  const { userDir } = createFixtureUserDir();
  const input: DebugScanInput = {
    roots: resolveStorageRoots({ userDirs: [userDir] }),
    known: {},
    tombstones: {},
    ...overrides,
  };
  return { userDir, input };
}

describe('scanDebugLogs', () => {
  it('finds and parses debug logs under each workspace', () => {
    const { input } = setup();
    const { results, stats } = scanDebugLogs(input);
    expect(stats).toMatchObject({ files: 1, parsed: 1, unchanged: 0, skippedDeleted: 0, errors: [] });
    expect(results[0]?.log?.sessionId).toBe('fx-auto-1');
    expect(results[0]?.log?.calls).toHaveLength(4);
  });

  it('skips files whose fingerprint is unchanged and re-parses a grown file', () => {
    const { input, userDir } = setup();
    const first = scanDebugLogs(input);
    const known = Object.fromEntries(first.results.map((result) => [result.file, result.fingerprint]));
    expect(scanDebugLogs({ ...input, known }).stats).toMatchObject({ unchanged: 1, parsed: 0 });
    appendFileSync(
      join(
        userDir,
        'workspaceStorage',
        'ws1',
        'GitHub.copilot-chat',
        'debug-logs',
        'fx-auto-1',
        'main.jsonl',
      ),
      '\n{"ts":1790000099000,"dur":1,"type":"llm_request","spanId":"l9","attrs":{"model":"m","inputTokens":5}}\n',
    );
    const again = scanDebugLogs({ ...input, known });
    expect(again.stats.parsed).toBe(1);
    expect(again.results[0]?.log?.calls.map((call) => call.spanId)).toContain('l9');
  });

  it('skips logs of tombstoned (deleted) sessions but still records their fingerprint', () => {
    const { input } = setup({ tombstones: { 'fx-auto-1': 'deleted' } });
    const { results, stats } = scanDebugLogs(input);
    expect(stats.skippedDeleted).toBe(1);
    expect(results[0]?.log).toBeNull();
    expect(results[0]?.fingerprint).not.toBe('');
  });

  it('ignores directories without a main.jsonl and survives unreadable entries', () => {
    const { input, userDir } = setup();
    const base = join(userDir, 'workspaceStorage', 'ws1', 'GitHub.copilot-chat', 'debug-logs');
    mkdirSync(join(base, 'empty-dir'), { recursive: true });
    writeFileSync(join(base, 'stray-file.txt'), 'x');
    mkdirSync(join(base, 'bad'), { recursive: true });
    writeFileSync(join(base, 'bad', 'main.jsonl'), '\u0000\u0001 not json at all');
    const { stats } = scanDebugLogs(input);
    expect(stats.files).toBe(2);
    expect(stats.errors).toEqual([]);
    rmSync(join(base, 'bad'), { recursive: true });
  });
});
```

Run — Expected: FAIL (module not found).

`src/core/debuglog/scanner.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileFingerprint, safeReaddir } from '../ingest/scanner';
import type { StorageRoot } from '../ingest/roots';
import type { TombstoneKind } from '../ingest/types';
import { parseDebugLog } from './parseDebugLog';
import type { DebugSessionLog } from './types';

export interface DebugFile {
  file: string;
  sessionId: string;
}

export interface DebugScanInput {
  roots: StorageRoot[];
  /** file path → fingerprint from the previous scan. */
  known: Record<string, string>;
  tombstones: Record<string, TombstoneKind>;
}

export interface DebugScanResult {
  file: string;
  fingerprint: string;
  /** null when the session was deleted (tombstone). */
  log: DebugSessionLog | null;
}

export interface DebugScanStats {
  files: number;
  parsed: number;
  unchanged: number;
  skippedDeleted: number;
  errors: { file: string; message: string }[];
}

export interface DebugScanOutput {
  results: DebugScanResult[];
  stats: DebugScanStats;
}

/** `<workspaceStorage>/<hash>/GitHub.copilot-chat/debug-logs/<sessionId>/main.jsonl`. */
export function listDebugLogFiles(roots: readonly StorageRoot[]): DebugFile[] {
  const files: DebugFile[] = [];
  for (const root of roots) {
    if (root.kind !== 'workspaceStorage') continue;
    for (const workspace of safeReaddir(root.dir)) {
      const logs = join(root.dir, workspace, 'GitHub.copilot-chat', 'debug-logs');
      for (const sessionId of safeReaddir(logs)) {
        const file = join(logs, sessionId, 'main.jsonl');
        if (existsSync(file)) files.push({ file, sessionId });
      }
    }
  }
  return files;
}

/** Synchronous and worker-safe. Never throws for one bad file. */
export function scanDebugLogs(input: DebugScanInput): DebugScanOutput {
  const stats: DebugScanStats = { files: 0, parsed: 0, unchanged: 0, skippedDeleted: 0, errors: [] };
  const results: DebugScanResult[] = [];
  for (const { file, sessionId } of listDebugLogFiles(input.roots)) {
    stats.files++;
    const fingerprint = fileFingerprint(file);
    if (fingerprint === null) continue;
    if (input.known[file] === fingerprint) {
      stats.unchanged++;
      continue;
    }
    if (input.tombstones[sessionId] === 'deleted') {
      stats.skippedDeleted++;
      results.push({ file, fingerprint, log: null });
      continue;
    }
    try {
      results.push({ file, fingerprint, log: parseDebugLog(sessionId, readFileSync(file, 'utf8')) });
      stats.parsed++;
    } catch (error) {
      stats.errors.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { results, stats };
}
```

Run: `pnpm vitest run src/core/debuglog` — Expected: PASS. (The last test's `stats.files` of 2 counts
`fx-auto-1` and `bad`; `empty-dir` has no `main.jsonl`.)

- [ ] **Step 6: One worker pass, and ingest writes the calls (test first)**

`src/core/ingest/scanAll.ts`:

```ts
import { scanDebugLogs, type DebugScanOutput } from '../debuglog/scanner';
import { scanChatSessions, type ScanInput, type ScanOutput } from './scanner';

export interface FullScanOutput extends ScanOutput {
  debug: DebugScanOutput;
}

/** Chat sessions and debug logs in one pass, so the extension host still spawns a single worker. */
export function scanAll(input: ScanInput): FullScanOutput {
  return {
    ...scanChatSessions(input),
    debug: scanDebugLogs({ roots: input.roots, known: input.known, tombstones: input.tombstones }),
  };
}
```

Change `runScan.ts` and `scanWorker.ts` to call `scanAll` and to use `FullScanOutput` (`ScanOutput` in the
`WorkerReply` type and the return type), and change `IngestDeps.runScan` in `ingestService.ts` to return
`Promise<FullScanOutput>`. Read each file first; the edits are mechanical.

Append to `src/core/ingest/ingestService.test.ts` (inside the describe; reuse that file's existing setup helper
for `createFixtureUserDir` + `IngestService` — read it to see the helper's name and shape):

```ts
it('stores telemetry from debug logs and keeps no conversation content', async () => {
  const { service, database } = setup();
  await service.sync();
  const calls = database.db.prepare('SELECT * FROM llm_calls').all();
  expect(calls).toHaveLength(4);
  expect(JSON.stringify(calls)).not.toContain('SECRET');
});

it('purges debug-log calls together with their session at the retention cutoff', async () => {
  const { service, database, sessions } = setup({ retentionDays: 1, now: 1_800_000_000_000 });
  await service.sync();
  expect(sessions.counts().sessions).toBe(0);
  expect((database.db.prepare('SELECT count(*) AS n FROM llm_calls').get() as { n: number }).n).toBe(0);
});
```

If the existing harness's retention setting is `0` (keep everything), set it to `30` for this test via the
harness's `retentionDays` dependency. Run: `pnpm vitest run src/core/ingest` — Expected: FAIL.

In `IngestService`: add `private readonly llmCalls: LlmCallStore;` created in the constructor from
`deps.database` (change the `database` dep type from `Pick<Database, 'transaction'>` to `Database`; update the
tests that pass a partial object, if any). In `run`, inside the transaction after the session loop:

```ts
for (const debug of output.debug.results) {
  if (debug.log !== null) {
    this.llmCalls.replaceSession(debug.log, debug.file, now);
    written++;
  }
  state.setFingerprint(debug.file, debug.fingerprint, debug.log?.sessionId ?? null, now);
}
```

and surface `output.debug.stats.errors` in the warning loop (`log.warn`). In
`SessionStore.purgeBefore(day)`, before the `DELETE FROM sessions` statement, run:

```ts
const params = { day };
this.database.db
  .prepare('DELETE FROM llm_calls WHERE session_id IN (SELECT id FROM sessions WHERE day < :day)')
  .run(params);
this.database.db
  .prepare('DELETE FROM debug_sessions WHERE session_id IN (SELECT id FROM sessions WHERE day < :day)')
  .run(params);
```

In `ClearService.clear` delete branch, add `new LlmCallStore(this.database).deleteSessions(ids);` (append a test to
`clearService.test.ts`: seed a debug log for `fx-auto-1` via `LlmCallStore`, delete the session, expect
`llm_calls` empty — write the test first and watch it fail).

Run: `pnpm vitest run src/core` — Expected: PASS.

- [ ] **Step 7: Join calls to turns in the query layer and DTOs (test first)**

In `test/fixtures/sessions.ts`, extend `seededStore` so the store also holds the fixture's calls:

```ts
new LlmCallStore(database).replaceSession(
  parseDebugLog('fx-auto-1', readFileSync(join(DEBUG_LOG_FIXTURES, 'fx-auto-1', 'main.jsonl'), 'utf8')),
  'fixture',
  1,
);
```

(add the imports; `seededStore(level)` keeps its signature. Consequence: the existing Phase 2 query tests still
pass because they do not look at telemetry; new assertions below cover it.)

Append to `src/core/query/sessionDetail.test.ts`:

```ts
it('joins debug-log telemetry to turns by responseId, exact and only when matched', () => {
  const detail = getSessionDetail(seededStore().database, 'fx-auto-1');
  const [first, second] = detail?.turns ?? [];
  expect(first?.cachedTokens).toEqual({
    value: 18000,
    provenance: { kind: 'exact', source: 'agent debug log: llm_request.cachedTokens' },
  });
  expect(first?.ttftMs.value).toBe(2100);
  expect(first?.nanoAiu.value).toBe(1126141000);
  expect(second?.cachedTokens.value).toBe(25000);
  expect(detail?.debug).toEqual({ calls: 4, internalCalls: 1, unmatchedCalls: 1 });
});

it('marks telemetry unavailable, with the reason, when there is no matching log', () => {
  const detail = getSessionDetail(seededStore().database, 'fx-byok-1');
  expect(detail?.debug).toBeNull();
  expect(detail?.turns[0]?.cachedTokens).toEqual({
    value: null,
    provenance: { kind: 'unavailable', source: 'agent debug log has no request for this turn' },
  });
});
```

Run — Expected: FAIL. In `src/core/query/measure.ts` extend `SOURCES`:

```ts
  cachedTokens: 'agent debug log: llm_request.cachedTokens',
  ttftMs: 'agent debug log: llm_request.ttft',
  nanoAiu: 'agent debug log: llm_request.copilotUsageNanoAiu',
  noDebugLog: 'agent debug log has no request for this turn',
```

In `src/shared/dto.ts`: add to `turnDetailSchema` `cachedTokens: measuredNumber, ttftMs: measuredNumber,
nanoAiu: measuredNumber,` and to `sessionDetailSchema`
`debug: z.object({ calls: z.number(), internalCalls: z.number(), unmatchedCalls: z.number() }).nullable(),`.

In `sessionDetail.ts`: add `response_id` to the turns `SELECT` and `TurnRow`; load the session's calls:

```ts
const callRows = db
  .prepare('SELECT response_id, role, cached_tokens, ttft_ms, nano_aiu FROM llm_calls WHERE session_id = :id')
  .all({ id }) as unknown as {
  response_id: string | null;
  role: string;
  cached_tokens: number | null;
  ttft_ms: number | null;
  nano_aiu: number | null;
}[];
const byResponse = new Map(
  callRows.flatMap((call) => (call.response_id === null ? [] : [[call.response_id, call] as const])),
);
const matchedResponses = new Set<string>();
```

in the turn mapper: `const call = row.response_id === null ? undefined : byResponse.get(row.response_id);
if (call !== undefined && row.response_id !== null) matchedResponses.add(row.response_id);` then

```ts
        cachedTokens: call ? known(call.cached_tokens, SOURCES.cachedTokens) : unavailable(SOURCES.noDebugLog),
        ttftMs: call ? known(call.ttft_ms, SOURCES.ttftMs) : unavailable(SOURCES.noDebugLog),
        nanoAiu: call ? known(call.nano_aiu, SOURCES.nanoAiu) : unavailable(SOURCES.noDebugLog),
```

and in the returned object:

```ts
    debug:
      callRows.length === 0
        ? null
        : {
            calls: callRows.length,
            internalCalls: callRows.filter((call) => call.role === 'COPILOT_INTERNAL').length,
            unmatchedCalls: callRows.filter(
              (call) =>
                call.role !== 'COPILOT_INTERNAL' && (call.response_id === null || !matchedResponses.has(call.response_id)),
            ).length,
          },
```

(`unavailable` is imported from `../../shared/provenance`.) Because `turns` is built before `matchedResponses`
is complete, compute `debug` after the `turns` map. Update `test/fixtures/turns.ts` `makeTurn` defaults with
`cachedTokens: unavailable('test'), ttftMs: unavailable('test'), nanoAiu: unavailable('test')`, and the webview
`turnDetail`/`sessionDetail` fixtures (`cachedTokens: exactNumber(18000)`, `ttftMs: exactNumber(2100)`,
`nanoAiu: exactNumber(1126141000)` on turn 1, `missing()` on turn 2; `debug: { calls: 4, internalCalls: 1,
unmatchedCalls: 1 }`).

Run: `pnpm vitest run src/core` — Expected: PASS.

- [ ] **Step 8: Show telemetry in the detail view (test first)**

Add to `SessionDetailView.test.tsx`:

```tsx
it('shows exact debug-log telemetry when a turn has it and a hint when the session has none', async () => {
  view({ getSession: sessionDetail() });
  const first = await screen.findByRole('article', { name: 'Turn 1' });
  expect(within(first).getByText('18,000')).toBeInTheDocument();
  expect(within(first).getByText('2.1 s')).toBeInTheDocument();
  expect(within(first).getByText('1,126,141,000')).toBeInTheDocument();
  expect(screen.queryByText(/Agent debug logging is off/)).not.toBeInTheDocument();
});

it('explains how to get exact telemetry when the session has no debug log', async () => {
  view({
    getSession: sessionDetail({
      debug: null,
      turns: [turnDetail({ cachedTokens: missing('x'), ttftMs: missing('x'), nanoAiu: missing('x') })],
    }),
  });
  expect(await screen.findByText(/Agent debug logging is off/)).toBeInTheDocument();
  const turn = screen.getByRole('article', { name: 'Turn 1' });
  expect(within(turn).queryByText('Cached')).not.toBeInTheDocument();
});
```

Run — Expected: FAIL. In `TurnCard`, after the input/output/credits `dl`, add a second row rendered only when any
of the three has a value:

```tsx
{
  [turn.cachedTokens, turn.ttftMs, turn.nanoAiu].some((measure) => measure.value !== null) && (
    <dl className="facts facts--row" aria-label="Exact telemetry">
      <dt>Cached</dt>
      <dd>
        <Measure measure={turn.cachedTokens} format={(value) => formatInt(Number(value))} />
      </dd>
      <dt>First token</dt>
      <dd>
        <Measure measure={turn.ttftMs} format={(value) => formatDuration(Number(value))} />
      </dd>
      <dt>Usage (nano-AIU)</dt>
      <dd>
        <Measure measure={turn.nanoAiu} format={(value) => formatInt(Number(value))} />
      </dd>
    </dl>
  );
}
```

and in `Detail`, under the facts, when `session.debug === null`:

```tsx
{
  session.debug === null && (
    <p className="muted">
      Agent debug logging is off for this session, so cached tokens, per-call latency and usage are not
      available. Run “Copilot Insights: Enable Exact Telemetry…” to turn it on for future sessions.
    </p>
  );
}
```

Run: `pnpm vitest run src/webview` — Expected: PASS.

- [ ] **Step 9: Verify, real-data check and commit**

Extend `scripts/smokeReal.ts`: after the existing checks, call `scanDebugLogs` on the same roots (no known
fingerprints) and print aggregates only: files, parsed, calls, calls by role, count of distinct unclassified
`debugName`s (names themselves are Copilot identifiers, not user content — print them), and how many calls join
a parsed turn's `responseId` (`OK: debug logs joined N/M calls` — informational, no failure threshold; fail only
if any parsed log has `bad_lines` greater than one per file or the parser throws).

```bash
pnpm format && pnpm verify
pnpm test:integration
pnpm smoke:real
git add -A
git commit -m "feat(debuglog): ingest exact per-call telemetry from Copilot debug logs and join it to turns"
```

Expected on this machine: 9 calls in 81 logs, all classified `USER_FACING` (`panel/editAgent`), no content in
the output.

---

## Task 3.2: Internal Copilot calls made visible

**Files:**

- Create: `src/core/query/internalUsage.ts`, `internalUsage.test.ts`
- Modify: `src/shared/dto.ts` (`overviewSchema.internal`), `src/core/query/overview.ts` (+test),
  `src/webview/test/dtoFixtures.ts`, `src/webview/views/OverviewView.tsx` (+test),
  `src/extension/webviewHost/rpcHost.test.ts`

**Interfaces:**

- Consumes: `llm_calls`, `debug_sessions` (3.1), `derived`, `unavailable`, `getOverview`.
- Produces: `getInternalUsage(database, fromDay, toDay): InternalUsage` and `Overview.internal`:
  `{ sessionsWithLogs: number; calls: number; inputTokens, outputTokens, nanoAiu: MeasuredNumber;
byName: { name: string; role: 'USER_FACING' | 'COPILOT_INTERNAL' | 'UNKNOWN'; calls: number; inputTokens:
MeasuredNumber }[] }`.
- Rule: only sessions that have a debug log are observable, so every total here is a **derived lower bound**
  (source says so); with no logs at all the totals are `unavailable`.

- [ ] **Step 1: Write the failing test** — `src/core/query/internalUsage.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { localDay } from '../time';
import { getInternalUsage } from './internalUsage';

const CALL_DAY = localDay(1790000002000);

describe('getInternalUsage', () => {
  it('totals utility calls as a derived lower bound and lists calls by debugName', () => {
    const usage = getInternalUsage(seededStore().database, CALL_DAY, CALL_DAY);
    expect(usage.sessionsWithLogs).toBe(1);
    expect(usage.calls).toBe(1);
    expect(usage.inputTokens.value).toBe(300);
    expect(usage.inputTokens.provenance.kind).toBe('derived');
    expect(usage.inputTokens.provenance.source).toContain('only sessions with agent debug logging');
    expect(usage.outputTokens.value).toBe(12);
    expect(usage.nanoAiu.value).toBe(2000000);
  });

  it('lists every role by name so unclassified names are visible', () => {
    const usage = getInternalUsage(seededStore().database, CALL_DAY, CALL_DAY);
    expect(usage.byName.map((row) => [row.name, row.role, row.calls])).toEqual([
      ['panel/editAgent', 'USER_FACING', 2],
      ['mystery-thing', 'UNKNOWN', 1],
      ['title', 'COPILOT_INTERNAL', 1],
    ]);
  });

  it('is unavailable, not zero, when no debug log exists or nothing falls in the period', () => {
    const { database } = seededStore();
    database.db.exec('DELETE FROM llm_calls; DELETE FROM debug_sessions');
    const none = getInternalUsage(database, CALL_DAY, CALL_DAY);
    expect(none.sessionsWithLogs).toBe(0);
    expect(none.inputTokens.provenance.kind).toBe('unavailable');
    expect(none.byName).toEqual([]);
  });

  it('respects the day range', () => {
    const usage = getInternalUsage(seededStore().database, '2000-01-01', '2000-01-02');
    expect(usage.calls).toBe(0);
    expect(usage.byName).toEqual([]);
  });
});
```

Run: `pnpm vitest run src/core/query/internalUsage.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 2: Implement `src/core/query/internalUsage.ts`**

```ts
import type { Overview } from '../../shared/dto';
import { derived, unavailable } from '../../shared/provenance';
import type { Database } from '../storage/database';

export type InternalUsage = Overview['internal'];

const SOURCE = 'agent debug log (lower bound: only sessions with agent debug logging are observable)';
const LOCAL_DAY = "date(started_at / 1000, 'unixepoch', 'localtime')";

export function getInternalUsage(
  database: Pick<Database, 'db'>,
  fromDay: string,
  toDay: string,
): InternalUsage {
  const { db } = database;
  const logged = (db.prepare('SELECT count(*) AS n FROM debug_sessions').get() as unknown as { n: number }).n;
  const totals = db
    .prepare(
      `SELECT count(*) AS calls, sum(input_tokens) AS input, sum(output_tokens) AS output, sum(nano_aiu) AS aiu
         FROM llm_calls WHERE role = 'COPILOT_INTERNAL' AND ${LOCAL_DAY} >= :fromDay AND ${LOCAL_DAY} <= :toDay`,
    )
    .get({ fromDay, toDay }) as unknown as {
    calls: number;
    input: number | null;
    output: number | null;
    aiu: number | null;
  };
  const byName = db
    .prepare(
      `SELECT coalesce(debug_name, '(unnamed)') AS name, role, count(*) AS calls, sum(input_tokens) AS input,
              count(input_tokens) AS input_known
         FROM llm_calls WHERE ${LOCAL_DAY} >= :fromDay AND ${LOCAL_DAY} <= :toDay
        GROUP BY name, role ORDER BY calls DESC, name`,
    )
    .all({ fromDay, toDay }) as unknown as {
    name: string;
    role: 'USER_FACING' | 'COPILOT_INTERNAL' | 'UNKNOWN';
    calls: number;
    input: number | null;
    input_known: number;
  }[];
  const measure = (value: number | null) =>
    logged === 0 || value === null ? unavailable<number>(SOURCE) : derived(value, SOURCE);
  return {
    sessionsWithLogs: logged,
    calls: totals.calls,
    inputTokens: measure(totals.input),
    outputTokens: measure(totals.output),
    nanoAiu: measure(totals.aiu),
    byName: byName.map((row) => ({
      name: row.name,
      role: row.role,
      calls: row.calls,
      inputTokens: measure(row.input_known === 0 ? null : row.input),
    })),
  };
}
```

In `src/shared/dto.ts` add to `overviewSchema`:

```ts
  internal: z.object({
    sessionsWithLogs: z.number(),
    calls: z.number(),
    inputTokens: measuredNumber,
    outputTokens: measuredNumber,
    nanoAiu: measuredNumber,
    byName: z.array(
      z.object({
        name: z.string(),
        role: z.enum(['USER_FACING', 'COPILOT_INTERNAL', 'UNKNOWN']),
        calls: z.number(),
        inputTokens: measuredNumber,
      }),
    ),
  }),
```

In `getOverview` add `internal: getInternalUsage(database, monthStart, today),` (import it). Append to
`overview.test.ts`: `expect(getOverview(seededStore().database, localDay(1790100000000)).internal.sessionsWithLogs).toBe(1)`
in a new test ("includes internal usage for the month"), and update the RPC-host test stub and the webview
`overview()` fixture with an `internal` object (fixture: `sessionsWithLogs: 1, calls: 2, inputTokens/outputTokens/nanoAiu` derived, `byName` two rows).

Run: `pnpm vitest run src/core src/extension` — Expected: PASS.

- [ ] **Step 3: Show it in the Overview (test first)**

Add to `OverviewView.test.tsx`:

```tsx
it('shows utility calls Copilot made on its own, as a lower bound, with names', async () => {
  renderWithHost(<OverviewView />, { getOverview: overview() });
  const card = await screen.findByRole('region', { name: 'Copilot internal calls' });
  expect(within(card).getByText(/only sessions with agent debug logging/i)).toBeInTheDocument();
  expect(within(card).getByRole('table', { name: 'Requests by name' })).toBeInTheDocument();
  expect(within(card).getByText('title')).toBeInTheDocument();
  expect(within(card).getByText('Not classified')).toBeInTheDocument();
});

it('says so when no debug logs exist', async () => {
  renderWithHost(<OverviewView />, {
    getOverview: overview({
      internal: {
        sessionsWithLogs: 0,
        calls: 0,
        inputTokens: missing('agent debug log'),
        outputTokens: missing('agent debug log'),
        nanoAiu: missing('agent debug log'),
        byName: [],
      },
    }),
  });
  expect(await screen.findByText(/No agent debug logs found/)).toBeInTheDocument();
});
```

(fixture `byName` in `overview()`: `{ name: 'title', role: 'COPILOT_INTERNAL', calls: 1, inputTokens }`,
`{ name: 'mystery-thing', role: 'UNKNOWN', calls: 1, inputTokens }`.) Run — Expected: FAIL. Add
`InternalCard` to `OverviewView.tsx`, rendered after the by-host table (inside the non-empty branch's parent so
it shows even with no model rows — place it just before `<GithubUsageCard />`):

```tsx
const ROLE_LABEL = {
  USER_FACING: 'Your requests',
  COPILOT_INTERNAL: 'Copilot internal',
  UNKNOWN: 'Not classified',
} as const;

function InternalCard({ internal }: { internal: Overview['internal'] }) {
  return (
    <section className="card" aria-label="Copilot internal calls">
      <h3>Copilot internal calls</h3>
      {internal.sessionsWithLogs === 0 ? (
        <p className="muted">
          No agent debug logs found. Enable “Copilot Insights: Enable Exact Telemetry…” to see the utility
          requests (titles, summaries, …) Copilot makes on its own.
        </p>
      ) : (
        <>
          <p className="muted">
            Utility requests Copilot made itself, this month. Totals cover only sessions with agent debug
            logging, so they are lower bounds.
          </p>
          <dl className="facts">
            <dt>Calls</dt>
            <dd>{formatInt(internal.calls)}</dd>
            <dt>Input tokens</dt>
            <dd>
              <Measure measure={internal.inputTokens} format={int} />
            </dd>
            <dt>Output tokens</dt>
            <dd>
              <Measure measure={internal.outputTokens} format={int} />
            </dd>
            <dt>Usage (nano-AIU)</dt>
            <dd>
              <Measure measure={internal.nanoAiu} format={int} />
            </dd>
          </dl>
          <DataTable
            caption="Requests by name"
            columns={[
              { id: 'name', header: 'debugName', cell: (row) => row.name },
              { id: 'role', header: 'Kind', cell: (row) => ROLE_LABEL[row.role] },
              { id: 'calls', header: 'Calls', align: 'end', cell: (row) => formatInt(row.calls) },
              {
                id: 'input',
                header: 'Input',
                align: 'end',
                cell: (row) => <Measure measure={row.inputTokens} format={int} />,
              },
            ]}
            rows={internal.byName}
            rowKey={(row) => `${row.name}|${row.role}`}
            empty="No calls this month."
          />
        </>
      )}
    </section>
  );
}
```

Run: `pnpm vitest run src/webview` — Expected: PASS.

- [ ] **Step 4: Verify and commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(query): surface Copilot's internal utility calls from debug logs as a derived lower bound"
```

---

## Task 3.3: Model catalog from `models.json`

**Files:**

- Create: `test/fixtures/debugLogs/fx-auto-1/models.json`, `src/core/debuglog/parseModels.ts`,
  `parseModels.test.ts`, `src/core/debuglog/catalogScanner.ts`, `catalogScanner.test.ts`,
  `src/core/storage/catalogStore.ts`, `catalogStore.test.ts`
- Modify: `src/core/storage/migrations.ts` (v5), `src/core/ingest/scanAll.ts`, `src/core/ingest/ingestService.ts`
  (+test), `src/core/query/overview.ts` (+test), `src/shared/dto.ts`, `src/webview/test/dtoFixtures.ts`,
  `src/webview/views/OverviewView.tsx` (+test), `test/fixtures/sessions.ts`, `test/fixtures/fixtures.ts`

**Interfaces:**

- Consumes: `safeReaddir`, `fileFingerprint` (3.1), `StorageRoot`, `IngestService`, `getOverview`, `modelNameFromId`.
- Produces: `CatalogModel { id; name; vendor; family; pickerCategory; priceCategory; maxContextTokens;
maxOutputTokens; inputPrice; outputPrice; cacheReadPrice; priceBatchSize }` (all but `id` nullable),
  `parseModelsJson(text): CatalogModel[]`, `scanCatalogs(input): CatalogScanOutput`,
  `CatalogStore { upsertAll(models, seenAt); tiers(): Map<string, { pickerCategory; priceCategory }>; stats() }`,
  `FullScanOutput.catalogs`, `BreakdownRow.tier: MeasuredNumber-like measured string | null`.
- Rule (decision, ROADMAP 3.3): tiers come from the catalog's own fields (`model_picker_category`,
  `model_picker_price_category`), never from name regexes. Prices are stored as recorded with their
  `batch_size`; their currency/unit is not documented, so they are **not converted or displayed as money**
  (consumed by Phase 5.4). `vscode.lm.selectChatModels` metadata is deferred until a feature needs it.

- [ ] **Step 1: Add the catalog fixture and write the failing parser tests**

`test/fixtures/debugLogs/fx-auto-1/models.json` (synthetic; prices are made-up numbers):

```json
[
  {
    "id": "gpt-5.6-luna",
    "name": "GPT-5.6 Luna",
    "vendor": "OpenAI",
    "version": "5.6",
    "capabilities": {
      "family": "gpt-5.6",
      "limits": {
        "max_context_window_tokens": 400000,
        "max_output_tokens": 128000,
        "max_prompt_tokens": 272000
      }
    },
    "billing": {
      "token_prices": {
        "batch_size": 1000000,
        "default": {
          "input_price": 5,
          "output_price": 30,
          "cache_read_price": 0.5,
          "max_prompt_tokens": 272000
        }
      }
    },
    "model_picker_category": "powerful",
    "model_picker_price_category": "high",
    "is_chat_default": false
  },
  {
    "id": "gpt-4o-mini",
    "name": "GPT-4o mini",
    "vendor": "OpenAI",
    "capabilities": { "family": "gpt-4o-mini", "limits": {} },
    "model_picker_category": "lightweight"
  },
  { "name": "entry without an id" },
  { "id": "weird", "name": 42, "capabilities": "oops", "billing": null, "model_picker_category": ["x"] }
]
```

`src/core/debuglog/parseModels.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEBUG_LOG_FIXTURES } from '../../../test/fixtures/fixtures';
import { parseModelsJson } from './parseModels';

const fixture = readFileSync(join(DEBUG_LOG_FIXTURES, 'fx-auto-1', 'models.json'), 'utf8');

describe('parseModelsJson', () => {
  it('reads identity, tier, limits and the price table exactly as recorded', () => {
    const [luna] = parseModelsJson(fixture);
    expect(luna).toEqual({
      id: 'gpt-5.6-luna',
      name: 'GPT-5.6 Luna',
      vendor: 'OpenAI',
      family: 'gpt-5.6',
      pickerCategory: 'powerful',
      priceCategory: 'high',
      maxContextTokens: 400000,
      maxOutputTokens: 128000,
      inputPrice: 5,
      outputPrice: 30,
      cacheReadPrice: 0.5,
      priceBatchSize: 1000000,
    });
  });

  it('leaves missing fields null and skips entries without an id', () => {
    const models = parseModelsJson(fixture);
    expect(models.map((model) => model.id)).toEqual(['gpt-5.6-luna', 'gpt-4o-mini', 'weird']);
    expect(models[1]).toMatchObject({ pickerCategory: 'lightweight', priceCategory: null, inputPrice: null });
  });

  it('survives wrong types without throwing', () => {
    expect(parseModelsJson(fixture)[2]).toEqual({
      id: 'weird',
      name: null,
      vendor: null,
      family: null,
      pickerCategory: null,
      priceCategory: null,
      maxContextTokens: null,
      maxOutputTokens: null,
      inputPrice: null,
      outputPrice: null,
      cacheReadPrice: null,
      priceBatchSize: null,
    });
    expect(parseModelsJson('not json')).toEqual([]);
    expect(parseModelsJson('{"a":1}')).toEqual([]);
    expect(parseModelsJson('[]')).toEqual([]);
  });
});
```

Run: `pnpm vitest run src/core/debuglog/parseModels.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 2: Implement `src/core/debuglog/parseModels.ts`**

```ts
import { z } from 'zod';

export interface CatalogModel {
  id: string;
  name: string | null;
  vendor: string | null;
  family: string | null;
  pickerCategory: string | null;
  priceCategory: string | null;
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  priceBatchSize: number | null;
}

// Lenient by construction: a field of the wrong type becomes undefined instead of dropping the whole entry.
const optionalNumber = z.number().optional().catch(undefined);
const optionalString = z.string().optional().catch(undefined);
const prices = z
  .looseObject({
    input_price: optionalNumber,
    output_price: optionalNumber,
    cache_read_price: optionalNumber,
  })
  .optional()
  .catch(undefined);
const entry = z.looseObject({
  id: z.string().min(1),
  name: optionalString,
  vendor: optionalString,
  model_picker_category: optionalString,
  model_picker_price_category: optionalString,
  capabilities: z
    .looseObject({
      family: optionalString,
      limits: z
        .looseObject({ max_context_window_tokens: optionalNumber, max_output_tokens: optionalNumber })
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
  billing: z
    .looseObject({
      token_prices: z
        .looseObject({ batch_size: optionalNumber, default: prices })
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
});

export function parseModelsJson(text: string): CatalogModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item: unknown): CatalogModel[] => {
    const result = entry.safeParse(item);
    if (!result.success) return [];
    const model = result.data;
    const price = model.billing?.token_prices?.default;
    return [
      {
        id: model.id,
        name: model.name ?? null,
        vendor: model.vendor ?? null,
        family: model.capabilities?.family ?? null,
        pickerCategory: model.model_picker_category ?? null,
        priceCategory: model.model_picker_price_category ?? null,
        maxContextTokens: model.capabilities?.limits?.max_context_window_tokens ?? null,
        maxOutputTokens: model.capabilities?.limits?.max_output_tokens ?? null,
        inputPrice: price?.input_price ?? null,
        outputPrice: price?.output_price ?? null,
        cacheReadPrice: price?.cache_read_price ?? null,
        priceBatchSize: model.billing?.token_prices?.batch_size ?? null,
      },
    ];
  });
}
```

Run: `pnpm vitest run src/core/debuglog/parseModels.test.ts` — Expected: PASS.

- [ ] **Step 3: Migration v5 and the store (test first)**

`src/core/storage/catalogStore.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CatalogModel } from '../debuglog/parseModels';
import { CatalogStore } from './catalogStore';
import { Database } from './database';

const model = (overrides: Partial<CatalogModel> = {}): CatalogModel => ({
  id: 'gpt-5.6-luna',
  name: 'GPT-5.6 Luna',
  vendor: 'OpenAI',
  family: 'gpt-5.6',
  pickerCategory: 'powerful',
  priceCategory: 'high',
  maxContextTokens: 400000,
  maxOutputTokens: 128000,
  inputPrice: 5,
  outputPrice: 30,
  cacheReadPrice: 0.5,
  priceBatchSize: 1000000,
  ...overrides,
});

describe('CatalogStore', () => {
  it('stores models and exposes tiers by lower-cased id', () => {
    const store = new CatalogStore(new Database(':memory:'));
    store.upsertAll([model(), model({ id: 'Weird-ID', pickerCategory: null })], 100);
    expect(store.tiers().get('gpt-5.6-luna')).toEqual({ pickerCategory: 'powerful', priceCategory: 'high' });
    expect(store.tiers().get('weird-id')).toEqual({ pickerCategory: null, priceCategory: 'high' });
    expect(store.stats()).toEqual({ models: 2, lastSeenAt: 100 });
  });

  it('lets the newest catalog win regardless of the order files are read in', () => {
    const store = new CatalogStore(new Database(':memory:'));
    store.upsertAll([model({ inputPrice: 7, pickerCategory: 'new' })], 200);
    store.upsertAll([model({ inputPrice: 5, pickerCategory: 'old' })], 100);
    expect(store.tiers().get('gpt-5.6-luna')?.pickerCategory).toBe('new');
    expect(store.stats().lastSeenAt).toBe(200);
  });

  it('reports an empty catalog', () => {
    expect(new CatalogStore(new Database(':memory:')).stats()).toEqual({ models: 0, lastSeenAt: null });
  });
});
```

Run — Expected: FAIL. Append migration v5:

```ts
  `
  CREATE TABLE models (
    id TEXT PRIMARY KEY,
    name TEXT,
    vendor TEXT,
    family TEXT,
    picker_category TEXT,
    price_category TEXT,
    max_context_tokens INTEGER,
    max_output_tokens INTEGER,
    input_price REAL,
    output_price REAL,
    cache_read_price REAL,
    price_batch_size INTEGER,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  `,
```

`src/core/storage/catalogStore.ts`:

```ts
import type { CatalogModel } from '../debuglog/parseModels';
import type { Database } from './database';

// Columns that follow "newest catalog wins".
const FIELDS = [
  ['name', 'name'],
  ['vendor', 'vendor'],
  ['family', 'family'],
  ['picker_category', 'pickerCategory'],
  ['price_category', 'priceCategory'],
  ['max_context_tokens', 'maxContextTokens'],
  ['max_output_tokens', 'maxOutputTokens'],
  ['input_price', 'inputPrice'],
  ['output_price', 'outputPrice'],
  ['cache_read_price', 'cacheReadPrice'],
  ['price_batch_size', 'priceBatchSize'],
] as const;

export class CatalogStore {
  constructor(private readonly database: Database) {}

  /** `seenAt` is the catalog file's mtime, so read order does not matter: the newest catalog wins. */
  upsertAll(models: readonly CatalogModel[], seenAt: number): void {
    const columns = FIELDS.map(([column]) => column);
    const update = FIELDS.map(
      ([column]) =>
        `${column} = CASE WHEN excluded.last_seen >= models.last_seen THEN excluded.${column} ELSE models.${column} END`,
    ).join(', ');
    const statement = this.database.db.prepare(
      `INSERT INTO models (id, ${columns.join(', ')}, first_seen, last_seen)
       VALUES (:id, ${FIELDS.map(([, key]) => `:${key}`).join(', ')}, :seenAt, :seenAt)
       ON CONFLICT(id) DO UPDATE SET ${update},
         first_seen = min(models.first_seen, excluded.first_seen), last_seen = max(models.last_seen, excluded.last_seen)`,
    );
    this.database.transaction(() => {
      for (const model of models) statement.run({ ...model, seenAt });
    });
  }

  /** Lower-cased model id → the catalog's own tier fields. */
  tiers(): Map<string, { pickerCategory: string | null; priceCategory: string | null }> {
    const rows = this.database.db
      .prepare('SELECT id, picker_category, price_category FROM models')
      .all() as unknown as { id: string; picker_category: string | null; price_category: string | null }[];
    return new Map(
      rows.map((row) => [
        row.id.toLowerCase(),
        { pickerCategory: row.picker_category, priceCategory: row.price_category },
      ]),
    );
  }

  stats(): { models: number; lastSeenAt: number | null } {
    const row = this.database.db
      .prepare('SELECT count(*) AS models, max(last_seen) AS last FROM models')
      .get() as unknown as { models: number; last: number | null };
    return { models: row.models, lastSeenAt: row.last };
  }
}
```

Run: `pnpm vitest run src/core/storage` — Expected: PASS.

- [ ] **Step 4: Scan catalogs and ingest them (test first)**

`src/core/debuglog/catalogScanner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createFixtureUserDir } from '../../../test/fixtures/fixtures';
import { resolveStorageRoots } from '../ingest/roots';
import { scanCatalogs } from './catalogScanner';

describe('scanCatalogs', () => {
  it('parses each models.json once and skips unchanged files', () => {
    const { userDir } = createFixtureUserDir();
    const roots = resolveStorageRoots({ userDirs: [userDir] });
    const first = scanCatalogs({ roots, known: {} });
    expect(first.stats).toMatchObject({ files: 1, parsed: 1, unchanged: 0, errors: [] });
    expect(first.results[0]?.models.map((model) => model.id)).toEqual([
      'gpt-5.6-luna',
      'gpt-4o-mini',
      'weird',
    ]);
    expect(first.results[0]?.seenAt).toBeGreaterThan(0);
    const known = Object.fromEntries(first.results.map((result) => [result.file, result.fingerprint]));
    expect(scanCatalogs({ roots, known }).stats).toMatchObject({ unchanged: 1, parsed: 0 });
  });
});
```

Run — Expected: FAIL. `createFixtureUserDir` must also copy `models.json` next to `main.jsonl` (extend the Step-1
copy in `fixtures.ts`).

`src/core/debuglog/catalogScanner.ts`:

```ts
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { StorageRoot } from '../ingest/roots';
import { fileFingerprint, safeReaddir } from '../ingest/scanner';
import { parseModelsJson, type CatalogModel } from './parseModels';

export interface CatalogScanInput {
  roots: StorageRoot[];
  known: Record<string, string>;
}
export interface CatalogScanResult {
  file: string;
  fingerprint: string;
  seenAt: number;
  models: CatalogModel[];
}
export interface CatalogScanOutput {
  results: CatalogScanResult[];
  stats: { files: number; parsed: number; unchanged: number; errors: { file: string; message: string }[] };
}

export function listCatalogFiles(roots: readonly StorageRoot[]): string[] {
  const files: string[] = [];
  for (const root of roots) {
    if (root.kind !== 'workspaceStorage') continue;
    for (const workspace of safeReaddir(root.dir)) {
      const logs = join(root.dir, workspace, 'GitHub.copilot-chat', 'debug-logs');
      for (const sessionId of safeReaddir(logs)) {
        const file = join(logs, sessionId, 'models.json');
        if (existsSync(file)) files.push(file);
      }
    }
  }
  return files;
}

export function scanCatalogs(input: CatalogScanInput): CatalogScanOutput {
  const stats: CatalogScanOutput['stats'] = { files: 0, parsed: 0, unchanged: 0, errors: [] };
  const results: CatalogScanResult[] = [];
  for (const file of listCatalogFiles(input.roots)) {
    stats.files++;
    const fingerprint = fileFingerprint(file);
    if (fingerprint === null) continue;
    if (input.known[file] === fingerprint) {
      stats.unchanged++;
      continue;
    }
    try {
      const seenAt = Math.floor(statSync(file).mtimeMs);
      results.push({ file, fingerprint, seenAt, models: parseModelsJson(readFileSync(file, 'utf8')) });
      stats.parsed++;
    } catch (error) {
      stats.errors.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { results, stats };
}
```

Run — Expected: PASS. In `scanAll.ts` add `catalogs: CatalogScanOutput` to `FullScanOutput` and
`catalogs: scanCatalogs({ roots: input.roots, known: input.known }),`. In `IngestService`: create
`private readonly catalog: CatalogStore` in the constructor and, in the transaction after the debug loop:

```ts
for (const catalog of output.catalogs.results) {
  this.catalog.upsertAll(catalog.models, catalog.seenAt);
  state.setFingerprint(catalog.file, catalog.fingerprint, null, now);
}
```

(and include `output.catalogs.stats.errors` in the warning loop). Append to `ingestService.test.ts`: after `sync()`
on the fixture dir, `new CatalogStore(database).stats().models` is 3 (write it first, watch it fail).

Run: `pnpm vitest run src/core` — Expected: PASS.

- [ ] **Step 5: Tier in the overview (test first)**

In `test/fixtures/sessions.ts` `seededStore`, also load the catalog:
`new CatalogStore(database).upsertAll(parseModelsJson(readFileSync(join(DEBUG_LOG_FIXTURES, 'fx-auto-1', 'models.json'), 'utf8')), 1)`.
Append to `overview.test.ts`:

```ts
it('adds the catalog tier to model rows, and says so when a model is not in any catalog', () => {
  const overview = getOverview(seededStore().database, localDay(BYOK_START));
  const luna = overview.byModel.find((row) => row.label === 'gpt-5.6-luna');
  expect(luna?.tier).toEqual({
    value: 'powerful',
    provenance: { kind: 'exact', source: 'models.json: model_picker_category' },
  });
  const qwen = overview.byModel.find((row) => row.label === 'qwen3.5:35b');
  expect(qwen?.tier?.value).toBeNull();
  expect(qwen?.tier?.provenance).toEqual({
    kind: 'unavailable',
    source: 'model not present in any captured models.json',
  });
  expect(overview.byWorkspace.every((row) => row.tier === null)).toBe(true);
});
```

Run — Expected: FAIL. In `dto.ts` `breakdownRowSchema` add `tier: measured(z.string()).nullable(),`. In
`overview.ts` `breakdown(...)`: load `const tiers = new CatalogStore(database as Database).tiers()` — change the
function parameters from `Pick<Database, 'db'>` to `Database` in `getOverview`/`breakdown` (callers pass a real
`Database`; update the tests that pass `seededStore().database`, which already is one) — and map:

```ts
    tier:
      by === 'model'
        ? tierFor(tiers, row.group_key)
        : null,
```

with

```ts
function tierFor(tiers: ReturnType<CatalogStore['tiers']>, key: string): BreakdownRow['tier'] {
  const found = key === 'unknown' ? undefined : tiers.get(modelNameFromId(key).toLowerCase());
  return found?.pickerCategory != null
    ? exact(found.pickerCategory, 'models.json: model_picker_category')
    : unavailable('model not present in any captured models.json');
}
```

(import `exact`, `unavailable`, `CatalogStore`). Update the webview `breakdownRow` fixture (`tier: exactString`
— add a local helper `{ value: 'powerful', provenance: { kind: 'exact', source: 'models.json' } }`; workspace
rows `tier: null`) and the RPC stub. Add a `Tier` column to `modelColumns` in `OverviewView.tsx`:

```tsx
  { id: 'tier', header: 'Tier', cell: (row) => (row.tier === null ? '' : <Measure measure={row.tier} />) },
```

(insert after `host`) and a test: "shows the catalog tier for each model" — `within(models).getByText('powerful')`.

Run: `pnpm vitest run` — Expected: PASS.

- [ ] **Step 6: Verify and commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(catalog): capture the model catalog from models.json and show catalog tiers"
```

---

## Task 3.4: Opt-in exact telemetry

**Files:**

- Create: `src/core/telemetry/consent.ts`, `consent.test.ts`, `src/extension/telemetry.ts`
- Modify: `src/shared/protocol.ts` (+test), `src/extension/webviewHost/rpcHost.test.ts`,
  `src/extension/extension.ts`, `package.json`, `test/integration/commands.test.ts`

**Interfaces:**

- Consumes: `vscode.workspace.getConfiguration`, `vscode.window.showWarningMessage`.
- Produces: `DEBUG_LOGGING_SETTING`, `debugLoggingExplanation()`, `enableDebugLogging(deps): Promise<'already-enabled'
| 'declined' | 'enabled'>`; RPC `enableDebugLogging({}) → { outcome }`; command
  `copilotInsights.enableDebugLogging`; `readDebugLoggingEnabled(): boolean` (extension).
- Rule (ROADMAP 3.4): Copilot's debug log stores **prompts, model messages and tool results on this machine**;
  Copilot Insights reads only telemetry from it and never stores that text. Logging is enabled only after an
  explicit modal confirmation, only on user action (command or button), never at startup or by a timer. It
  applies to new sessions only and can be turned off in Copilot's own setting.

- [ ] **Step 1: Write the failing consent-flow tests** — `src/core/telemetry/consent.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import { DEBUG_LOGGING_SETTING, debugLoggingExplanation, enableDebugLogging } from './consent';

const deps = (overrides: Partial<Parameters<typeof enableDebugLogging>[0]> = {}) => ({
  isEnabled: () => false,
  confirm: vi.fn(() => Promise.resolve(true)),
  enable: vi.fn(() => Promise.resolve()),
  ...overrides,
});

describe('enableDebugLogging', () => {
  it('does nothing when logging is already on', async () => {
    const d = deps({ isEnabled: () => true });
    expect(await enableDebugLogging(d)).toBe('already-enabled');
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.enable).not.toHaveBeenCalled();
  });

  it('never enables without an explicit yes', async () => {
    const d = deps({ confirm: vi.fn(() => Promise.resolve(false)) });
    expect(await enableDebugLogging(d)).toBe('declined');
    expect(d.enable).not.toHaveBeenCalled();
  });

  it('enables exactly once after a yes', async () => {
    const d = deps();
    expect(await enableDebugLogging(d)).toBe('enabled');
    expect(d.enable).toHaveBeenCalledTimes(1);
  });

  it('does not enable when the confirmation itself fails', async () => {
    const d = deps({ confirm: vi.fn(() => Promise.reject(new Error('dialog closed'))) });
    await expect(enableDebugLogging(d)).rejects.toThrow('dialog closed');
    expect(d.enable).not.toHaveBeenCalled();
  });
});

describe('debugLoggingExplanation', () => {
  it('states what it adds, what it exposes on disk, and what Copilot Insights does with it', () => {
    const text = debugLoggingExplanation();
    expect(text.title).toContain('exact telemetry');
    expect(text.detail).toContain('cached tokens');
    expect(text.detail).toContain('prompts');
    expect(text.detail).toContain('on this machine');
    expect(text.detail).toContain('never stores');
    expect(text.detail).toContain('new chat sessions');
    expect(text.confirmLabel).toBe('Enable');
  });

  it('targets Copilot Chat’s own setting', () => {
    expect(DEBUG_LOGGING_SETTING).toEqual({
      section: 'github.copilot.chat.agentDebugLog.fileLogging',
      key: 'enabled',
    });
  });
});
```

Run: `pnpm vitest run src/core/telemetry` — Expected: FAIL (module not found).

- [ ] **Step 2: Implement `src/core/telemetry/consent.ts`**

```ts
/** Copilot Chat 0.67.0: `github.copilot.chat.agentDebugLog.fileLogging.enabled` (default false). */
export const DEBUG_LOGGING_SETTING = {
  section: 'github.copilot.chat.agentDebugLog.fileLogging',
  key: 'enabled',
} as const;

export interface ConsentText {
  title: string;
  detail: string;
  confirmLabel: string;
}

export function debugLoggingExplanation(): ConsentText {
  return {
    title: 'Turn on Copilot’s agent debug log for exact telemetry?',
    detail:
      'With it on, Copilot Insights can show cached tokens, per-request latency and Copilot’s own usage figures, ' +
      'and can account for utility requests Copilot makes itself.\n\n' +
      'Copilot writes this log as files on this machine, and the files include your prompts, the messages sent to ' +
      'the model and tool results. Copilot Insights reads only numbers and identifiers from them and never stores ' +
      'or displays that text. It applies to new chat sessions only, and you can turn it off at any time in the ' +
      'setting github.copilot.chat.agentDebugLog.fileLogging.enabled.',
    confirmLabel: 'Enable',
  };
}

export type EnableOutcome = 'already-enabled' | 'declined' | 'enabled';

export interface EnableDeps {
  isEnabled(): boolean;
  confirm(text: ConsentText): Promise<boolean>;
  enable(): Promise<void>;
}

/** The only path that turns logging on: it asks first and never enables on a decline or a failure. */
export async function enableDebugLogging(deps: EnableDeps): Promise<EnableOutcome> {
  if (deps.isEnabled()) return 'already-enabled';
  if (!(await deps.confirm(debugLoggingExplanation()))) return 'declined';
  await deps.enable();
  return 'enabled';
}
```

Run: `pnpm vitest run src/core/telemetry` — Expected: PASS.

- [ ] **Step 3: RPC, extension glue, command (test first)**

Append to `protocol.test.ts`:

```ts
it('declares enableDebugLogging with no params', () => {
  expect(isRpcMethod('enableDebugLogging')).toBe(true);
  expect(rpcSchemas.enableDebugLogging.params.safeParse({}).success).toBe(true);
  expect(rpcSchemas.enableDebugLogging.result.safeParse({ outcome: 'sure' }).success).toBe(false);
});
```

Run — Expected: FAIL. Add to `rpcSchemas`:

```ts
  enableDebugLogging: {
    params: z.object({}),
    result: z.object({ outcome: z.enum(['already-enabled', 'declined', 'enabled']) }),
  },
```

and the stub `enableDebugLogging: () => ({ outcome: 'declined' as const }),` to the RPC-host test handlers.

`src/extension/telemetry.ts`:

```ts
import * as vscode from 'vscode';
import { DEBUG_LOGGING_SETTING, enableDebugLogging, type EnableOutcome } from '../core/telemetry/consent';

export function readDebugLoggingEnabled(): boolean {
  return vscode.workspace
    .getConfiguration(DEBUG_LOGGING_SETTING.section)
    .get<boolean>(DEBUG_LOGGING_SETTING.key, false);
}

/** Command and webview button both end here; the modal is the only way to a "yes". */
export async function runEnableDebugLogging(): Promise<EnableOutcome> {
  const outcome = await enableDebugLogging({
    isEnabled: readDebugLoggingEnabled,
    confirm: async (text) => {
      const choice = await vscode.window.showWarningMessage(
        text.title,
        { modal: true, detail: text.detail },
        text.confirmLabel,
      );
      return choice === text.confirmLabel;
    },
    enable: () =>
      Promise.resolve(
        vscode.workspace
          .getConfiguration(DEBUG_LOGGING_SETTING.section)
          .update(DEBUG_LOGGING_SETTING.key, true, vscode.ConfigurationTarget.Global),
      ),
  });
  if (outcome === 'enabled') {
    void vscode.window.showInformationMessage(
      'Agent debug logging is on. Exact telemetry will appear for new Copilot chat sessions.',
    );
  }
  return outcome;
}
```

In `extension.ts` add handler `enableDebugLogging: async () => ({ outcome: await runEnableDebugLogging() }),`,
register command `copilotInsights.enableDebugLogging` → `runEnableDebugLogging()`; in `package.json` add the
command ("Enable Exact Telemetry…", category _Copilot Insights_); add the id to the list in
`test/integration/commands.test.ts`.

Run: `pnpm typecheck && pnpm vitest run src/shared src/extension src/core/telemetry` — Expected: PASS.

- [ ] **Step 4: Verify and commit**

```bash
pnpm format && pnpm verify
pnpm test:integration
git add -A
git commit -m "feat(telemetry): add opt-in enabling of Copilot's agent debug log behind a confirmation"
```

---

## Task 3.5: Provenance everywhere, enforced

**Files:**

- Create: `src/shared/dto.provenance.test.ts`
- Modify: `src/webview/ui/Measure.tsx`, `src/webview/ui/ui.test.tsx`, `src/shared/dto.ts`,
  `src/core/query/measure.ts`, `src/core/query/sessionDetail.ts` (+test), `test/fixtures/turns.ts`,
  `src/webview/test/dtoFixtures.ts`, `src/webview/views/SessionDetailView.tsx` (+test),
  `src/webview/views/OverviewView.test.tsx`

**Interfaces:**

- Consumes: every DTO schema (2.2, 3.1–3.3).
- Produces: `numericLeaves(schema)` (test helper); `TurnDetail.{reasoningMs, toolRounds, compactions}` become
  `MeasuredNumber`; `Measure` renders `≥` before a `derived` value whose source says "lower bound".
- Rule: every numeric leaf in a DTO shown in a view is a `Measured` value **or** is on an explicit allow-list of
  local-index counts and timestamps. Adding a raw number to a DTO fails the test until it is measured or
  consciously allow-listed.

- [ ] **Step 1: Write the failing schema-introspection test** — `src/shared/dto.provenance.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { githubUsageSchema, overviewSchema, sessionDetailSchema, sessionListSchema } from './dto';

interface Def {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  options?: z.ZodType[];
}
const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** Dotted paths of every number in a schema (`[]` marks arrays). Measured values end in `.value`. */
export function numericLeaves(schema: z.ZodType, path = ''): string[] {
  const def = defOf(schema);
  switch (def.type) {
    case 'number':
      return [path];
    case 'object':
      return Object.entries(def.shape ?? {}).flatMap(([key, value]) =>
        numericLeaves(value, path === '' ? key : `${path}.${key}`),
      );
    case 'array':
      return def.element === undefined ? [] : numericLeaves(def.element, `${path}[]`);
    case 'nullable':
    case 'optional':
      return def.innerType === undefined ? [] : numericLeaves(def.innerType, path);
    case 'union':
      return (def.options ?? []).flatMap((option) => numericLeaves(option, path));
    default:
      return [];
  }
}

const unmeasured = (schema: z.ZodType): string[] =>
  numericLeaves(schema)
    .filter((path) => !path.endsWith('.value'))
    .sort();

// Counts of rows in this machine's own index, identifiers' ordinals and timestamps: facts about the index,
// not measurements. Everything else must be a Measured value.
const ALLOWED = {
  sessionList: ['total', 'rows[].failedTurns', 'rows[].startedAt', 'rows[].turns'],
  sessionDetail: [
    'activeMs',
    'debug.calls',
    'debug.internalCalls',
    'debug.unmatchedCalls',
    'endedAt',
    'startedAt',
    'turns[].index',
    'turns[].startedAt',
  ],
  overview: [
    'byModel[].sessions',
    'byModel[].turns',
    'byWorkspace[].sessions',
    'byWorkspace[].turns',
    'hostSplit[].sessions',
    'hostSplit[].turns',
    'internal.byName[].calls',
    'internal.calls',
    'internal.sessionsWithLogs',
    'month.sessions',
    'month.turns',
    'today.sessions',
    'today.turns',
  ],
  githubUsage: ['lastSyncedAt'],
} as const;

describe('provenance is enforced on every DTO', () => {
  it.each([
    ['session list', sessionListSchema, ALLOWED.sessionList],
    ['session detail', sessionDetailSchema, ALLOWED.sessionDetail],
    ['overview', overviewSchema, ALLOWED.overview],
    ['github usage', githubUsageSchema, ALLOWED.githubUsage],
  ])('%s has no raw measurement numbers', (_name, schema, allowed) => {
    expect(unmeasured(schema)).toEqual([...allowed].sort());
  });

  it('finds numbers through arrays, nullable and nested objects', () => {
    const schema = z.object({ a: z.number(), b: z.array(z.object({ c: z.number().nullable() })) });
    expect(numericLeaves(schema)).toEqual(['a', 'b[].c']);
  });
});
```

Run: `pnpm vitest run src/shared/dto.provenance.test.ts` — Expected: FAIL: `turns[].reasoningMs`,
`turns[].toolRounds`, `turns[].compactions` are unmeasured raw numbers (the failure message lists them; if it
lists others, fix or allow-list each deliberately).

- [ ] **Step 2: Measure the remaining measurements**

In `dto.ts` `turnDetailSchema`: `reasoningMs: measuredNumber, toolRounds: measuredNumber, compactions:
measuredNumber,`. In `query/measure.ts` add to `SOURCES`:

```ts
  reasoning: 'chatSessions reasoning blocks (summed duration)',
  toolRounds: 'chatSessions toolCallRounds',
  compactions: 'chatSessions compaction events',
```

In `sessionDetail.ts` select `reasoning_blocks` too (add to the `SELECT` and `TurnRow`) and map:

```ts
        reasoningMs:
          row.reasoning_blocks > 0
            ? exact(row.reasoning_ms, SOURCES.reasoning)
            : unavailable(`${SOURCES.reasoning}: no reasoning recorded for this turn`),
        toolRounds: exact(row.tool_rounds, SOURCES.toolRounds),
        compactions: exact(countJsonArray(row.compactions), SOURCES.compactions),
```

(import `exact`, `unavailable`). Update the Phase 2 detail test expectation `compactions: 1` →
`compactions: { value: 1, provenance: { kind: 'exact', source: 'chatSessions compaction events' } }` (use
`toMatchObject`), `makeTurn` defaults (`reasoningMs: unavailable('test'), toolRounds: exact(0, 'test'),
compactions: exact(0, 'test')`) and the `analysis` code that reads `turn.compactions`
(`analyzeSession.ts`, `findings.ts`: use `turn.compactions.value ?? 0`; update `findings.test.ts` inputs to pass
`compactions: exact(2, 'test')`). In the webview fixtures, wrap `reasoningMs`, `toolRounds`, `compactions`
with `exactNumber(...)` (`reasoningMs: exactNumber(4200)`, and `missing()` where the turn has none). In
`SessionDetailView.tsx` `TurnCard` compute `extras` from `.value`:

```tsx
const extras = [
  turn.reasoningMs.value !== null ? `reasoning ${formatDuration(turn.reasoningMs.value)}` : null,
  (turn.toolRounds.value ?? 0) > 0
    ? `${String(turn.toolRounds.value)} tool round${turn.toolRounds.value === 1 ? '' : 's'}`
    : null,
  (turn.compactions.value ?? 0) > 0
    ? `${String(turn.compactions.value)} compaction${turn.compactions.value === 1 ? '' : 's'}`
    : null,
].filter((item): item is string => item !== null);
```

Run: `pnpm vitest run` — Expected: PASS, including the introspection test.

- [ ] **Step 3: Lower-bound cue (test first)**

Append to `ui.test.tsx` inside `describe('Measure')`:

```tsx
it('marks a derived lower bound with ≥ so a partial sum cannot be mistaken for a total', () => {
  render(
    <Measure
      measure={{
        value: 59000,
        provenance: {
          kind: 'derived',
          source: 'chatSessions.promptTokens (lower bound: 3 of 4 turns reported it)',
        },
      }}
    />,
  );
  expect(screen.getByText('≥ 59,000')).toBeInTheDocument();
});

it('does not add ≥ to other derived values or to exact values', () => {
  render(
    <>
      <Measure
        measure={{ value: 0.33, provenance: { kind: 'derived', source: 'turns.state' } }}
        format={(v) => `${String(v)}!`}
      />
      <Measure measure={{ value: 5, provenance: { kind: 'exact', source: 'x lower bound' } }} />
    </>,
  );
  expect(screen.getByText('0.33!')).toBeInTheDocument();
  expect(screen.getByText('5')).toBeInTheDocument();
});
```

Run — Expected: FAIL. In `Measure.tsx` change the value span to

```tsx
<span className="measure__value">
  {measure.value === null ? '—' : `${isLowerBound(measure) ? '≥ ' : ''}${format(measure.value)}`}
</span>
```

with `const isLowerBound = (m: MeasureLike): boolean => m.provenance.kind === 'derived' && m.provenance.source.includes('lower bound');`.
Update the existing Overview test that looked for `'59,000'` to `'≥ 59,000'`, and any other test that matches a
derived lower-bound number (run the suite and fix each failing matcher — SessionsView's derived byok input tokens
are not in fixtures, so only Overview should change).

Run: `pnpm vitest run src/webview` — Expected: PASS.

- [ ] **Step 4: Verify and commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(provenance): enforce Measured values on every DTO and mark lower bounds with ≥"
```

---

## Task 3.6: Credit coverage reconciliation

**Files:**

- Create: `src/core/query/coverage.ts`, `coverage.test.ts`
- Modify: `src/shared/dto.ts` (`githubUsageSchema`), `src/shared/dto.provenance.test.ts`,
  `src/extension/extension.ts`, `src/webview/test/dtoFixtures.ts`, `src/webview/views/GithubUsageCard.tsx`
  (+test)

**Interfaces:**

- Consumes: `github_daily_usage` via `GithubUsageStore.list`, `turns`, `summed`, `derived`, `unavailable`.
- Produces: `getCoverage(database, billed: { day; credits }[]): CoverageDay[]` where
  `CoverageDay { day; billed; local; coverage; unexplained }` are all `MeasuredNumber`; `GithubUsage.days` becomes
  `CoverageDay[]`.
- Rules (ROADMAP 3.6): `local` = sum of exact per-request credits on Copilot-hosted turns of that local day
  (`summed`, so partial → derived lower bound); `coverage = local ÷ billed` (derived); `unexplained = max(0,
billed − local)` (derived; an upper bound when `local` is a lower bound). Never spread credits over sessions.
  Billed = 0 → coverage `unavailable` (no division by zero). Local > billed → coverage shows the ratio (> 100 %),
  unexplained 0, and the source says local exceeds billed.

- [ ] **Step 1: Write the failing tests** — `src/core/query/coverage.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { localDay } from '../time';
import { getCoverage } from './coverage';

const AUTO_DAY = localDay(1790000001000); // local exact credits that day: 1.126141 + 0.5 = 1.626141
const NO_TURNS_DAY = '2026-01-01';

describe('getCoverage', () => {
  it('reports coverage and the unexplained remainder as derived from exact local credits', () => {
    const [day] = getCoverage(seededStore().database, [{ day: AUTO_DAY, credits: 2 }]);
    expect(day?.billed).toMatchObject({ value: 2, provenance: { kind: 'exact' } });
    expect(day?.local).toMatchObject({ provenance: { kind: 'exact' } });
    expect(day?.local.value).toBeCloseTo(1.626141);
    expect(day?.coverage.value).toBeCloseTo(0.8130705);
    expect(day?.coverage.provenance.kind).toBe('derived');
    expect(day?.unexplained.value).toBeCloseTo(0.373859);
    expect(day?.unexplained.provenance.kind).toBe('derived');
  });

  it('treats a day with billed credits but no local turns as fully unexplained, never dividing by zero', () => {
    const [day] = getCoverage(seededStore().database, [{ day: NO_TURNS_DAY, credits: 3 }]);
    expect(day?.local.provenance.kind).toBe('unavailable');
    expect(day?.coverage.value).toBe(0);
    expect(day?.unexplained.value).toBe(3);
  });

  it('has no coverage when GitHub billed nothing', () => {
    const [day] = getCoverage(seededStore().database, [{ day: AUTO_DAY, credits: 0 }]);
    expect(day?.coverage.value).toBeNull();
    expect(day?.coverage.provenance.kind).toBe('unavailable');
    expect(day?.unexplained.value).toBe(0);
  });

  it('never reports a negative remainder when local credits exceed billed credits', () => {
    const [day] = getCoverage(seededStore().database, [{ day: AUTO_DAY, credits: 1 }]);
    expect(day?.coverage.value).toBeCloseTo(1.626141);
    expect(day?.unexplained.value).toBe(0);
    expect(day?.coverage.provenance.source).toContain('local credits exceed GitHub billed credits');
  });

  it('calls the remainder an upper bound when local credits are only a lower bound', () => {
    const { database } = seededStore();
    database.db.exec("UPDATE turns SET credits = NULL WHERE session_id = 'fx-auto-1' AND idx = 2");
    const [day] = getCoverage(database, [{ day: AUTO_DAY, credits: 2 }]);
    expect(day?.local.provenance.kind).toBe('derived');
    expect(day?.unexplained.provenance.source).toContain('upper bound');
  });

  it('returns rows in the order given and nothing for no days', () => {
    expect(getCoverage(seededStore().database, [])).toEqual([]);
  });
});
```

Run: `pnpm vitest run src/core/query/coverage.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 2: Implement `src/core/query/coverage.ts`**

```ts
import { z } from 'zod';
import { coverageDaySchema } from '../../shared/dto';
import { derived, exact, unavailable } from '../../shared/provenance';
import type { Database } from '../storage/database';
import { SOURCES, summed } from './measure';

export type CoverageDay = z.infer<typeof coverageDaySchema>;

const BILLED = 'GitHub billing API: ai_credit/usage (account-wide, all devices)';

export function getCoverage(
  database: Pick<Database, 'db'>,
  billed: readonly { day: string; credits: number }[],
): CoverageDay[] {
  if (billed.length === 0) return [];
  const rows = database.db
    .prepare(
      `SELECT day, sum(credits) AS credit_sum, count(credits) AS credit_known,
              coalesce(sum(model_host <> 'byok'), 0) AS billable
         FROM turns WHERE day IN (SELECT value FROM json_each(:days)) GROUP BY day`,
    )
    .all({ days: JSON.stringify(billed.map((row) => row.day)) }) as unknown as {
    day: string;
    credit_sum: number | null;
    credit_known: number;
    billable: number;
  }[];
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return billed.map(({ day, credits }): CoverageDay => {
    const row = byDay.get(day);
    const local =
      row === undefined
        ? unavailable<number>('no Copilot-hosted turns indexed on this machine for this day')
        : summed(row.credit_sum, row.credit_known, row.billable, SOURCES.credits);
    const localValue = local.value ?? 0;
    const lowerBound = local.provenance.kind === 'derived';
    const exceeds = credits > 0 && localValue > credits + 1e-9;
    return {
      day,
      billed: exact(credits, BILLED),
      local,
      coverage:
        credits > 0
          ? derived(
              localValue / credits,
              exceeds
                ? 'local credits ÷ GitHub billed credits (local credits exceed GitHub billed credits for this day)'
                : 'local credits ÷ GitHub billed credits',
            )
          : unavailable<number>('GitHub billed no credits for this day'),
      unexplained: derived(
        Math.max(0, credits - localValue),
        lowerBound
          ? 'billed − local (upper bound: local credits are a lower bound); other machines, Copilot CLI, github.com or other clients'
          : 'billed − local; other machines, Copilot CLI, github.com or other clients',
      ),
    };
  });
}
```

In `dto.ts`, replace the `githubUsageSchema` day rows and export the schema:

```ts
export const coverageDaySchema = z.object({
  day: z.string(),
  billed: measuredNumber,
  local: measuredNumber,
  coverage: measuredNumber,
  unexplained: measuredNumber,
});
export const githubUsageSchema = z.object({
  days: z.array(coverageDaySchema),
  lastSyncedAt: z.number().nullable(),
  account: z.string().nullable(),
});
```

(remove the unused `import { z } from 'zod'` in `coverage.ts` if lint flags it — only the type is needed:
`import type { z } from 'zod'`.) Run: `pnpm vitest run src/core/query/coverage.test.ts src/shared` — Expected:
PASS. The Phase 3.5 allow-list for `githubUsage` is unchanged (`lastSyncedAt` only).

- [ ] **Step 3: Wire the handler and the card (test first)**

In the `getGithubUsage` handler in `extension.ts` replace the day mapping with:

```ts
const today = localDay();
return {
  days: getCoverage(database, github.list(daysAgo(today, days - 1), today)),
  lastSyncedAt: github.lastSyncedAt(),
  account: github.account(),
};
```

(import `getCoverage`; remove the now-unused `exact` import if lint flags it.) Update the webview fixtures/tests:
in `GithubUsageCard.test.tsx` the `usage` object's `days` become

```tsx
  days: [
    { day: '2026-09-29', billed: exactNumber(3.5, 'github'), local: exactNumber(2.8, 'local'),
      coverage: { value: 0.8, provenance: { kind: 'derived', source: 'local ÷ billed' } },
      unexplained: { value: 0.7, provenance: { kind: 'derived', source: 'billed − local' } } },
    { day: '2026-09-30', billed: exactNumber(1, 'github'), local: missing('no local turns'),
      coverage: { value: 0, provenance: { kind: 'derived', source: 'local ÷ billed' } },
      unexplained: { value: 1, provenance: { kind: 'derived', source: 'billed − local' } } },
  ],
```

and replace the first test's assertions with:

```tsx
const card = await screen.findByRole('region', { name: 'GitHub billed credits' });
const table = await within(card).findByRole('table', { name: 'GitHub billed credits by day' });
expect(within(table).getByText('3.5')).toBeInTheDocument();
expect(within(table).getByText('80%')).toBeInTheDocument();
expect(within(table).getByText('0.7')).toBeInTheDocument();
expect(within(card).getByText(/other machines, Copilot CLI, github\.com/i)).toBeInTheDocument();
expect(within(card).getByText(/all devices and clients/)).toBeInTheDocument();
expect(within(card).getByText(/octo/)).toBeInTheDocument();
```

Run — Expected: FAIL. In `GithubUsageCard.tsx` replace the table columns with:

```tsx
          columns={[
            { id: 'day', header: 'Day', cell: (row) => row.day },
            { id: 'billed', header: 'GitHub billed', align: 'end', cell: (row) => <Measure measure={row.billed} format={credits} /> },
            { id: 'local', header: 'Local (this machine)', align: 'end', cell: (row) => <Measure measure={row.local} format={credits} /> },
            { id: 'coverage', header: 'Coverage', align: 'end', cell: (row) => <Measure measure={row.coverage} format={(value) => formatPercent(Number(value))} /> },
            { id: 'unexplained', header: 'Unexplained', align: 'end', cell: (row) => <Measure measure={row.unexplained} format={credits} /> },
          ]}
```

(with `const credits = (value: number | string) => formatCredits(Number(value));` and `formatPercent` imported) and
extend the descriptive paragraph: "Unexplained credits are billed minus local; they come from other machines,
Copilot CLI, github.com or other clients." Run: `pnpm vitest run` — Expected: PASS.

- [ ] **Step 4: Verify and commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(coverage): reconcile local exact credits with GitHub billed credits per day"
```

---

## Task 3.7: Diagnostics view and phase exit

**Files:**

- Create: `src/core/query/diagnostics.ts`, `diagnostics.test.ts`, `src/webview/views/DiagnosticsView.tsx`,
  `DiagnosticsView.test.tsx`
- Modify: `src/shared/dto.ts`, `src/shared/protocol.ts` (+test), `src/extension/webviewHost/rpcHost.test.ts`,
  `src/extension/extension.ts`, `src/webview/App.tsx` (+test), `src/webview/test/dtoFixtures.ts`,
  `README.md`, `CHANGELOG.md`, `package.json` (0.5.0), `docs/ROADMAP.md`

**Interfaces:**

- Consumes: `sessions.unknown_part_kinds/unknown_request_keys/invalid_requests`, `llm_calls`, `debug_sessions`,
  `models`, `IngestService.lastResult/lastError`, `readDebugLoggingEnabled`, `runEnableDebugLogging`.
- Produces: `getDiagnostics(database, scan): Diagnostics`-minus-environment; RPC `getDiagnostics({}) →
Diagnostics`; `DiagnosticsView()`; the Diagnostics tab.
- `Diagnostics` = `{ versions: { vscode; copilotChat: string | null; extension }, debugLogging: boolean,
scan: { role; lastSyncAt; lastError; parseErrors; badLines }, index: { sessions; turns; invalidRequests },
drift: { unknownPartKinds: string[]; unknownRequestKeys: string[] }, debugLog: { sessionsWithLogs; llmCalls;
unknownDebugNames: { name; count }[]; copilotVersionsSeen: string[] }, catalog: { models; lastSeenAt } }`.
- Rule: diagnostics show identifiers, counts and versions only — never conversation text (test plants sentinels).

- [ ] **Step 1: Write the failing query tests** — `src/core/query/diagnostics.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { getDiagnostics } from './diagnostics';

const scan = { role: 'leader' as const, lastSyncAt: 123, lastError: null, parseErrors: 2, badLines: 5 };

describe('getDiagnostics', () => {
  it('reports index size, scan status and debug-log / catalog facts', () => {
    const diagnostics = getDiagnostics(seededStore().database, scan);
    expect(diagnostics.index).toEqual({ sessions: 2, turns: 4, invalidRequests: 0 });
    expect(diagnostics.scan).toEqual(scan);
    expect(diagnostics.debugLog).toEqual({
      sessionsWithLogs: 1,
      llmCalls: 4,
      unknownDebugNames: [{ name: 'mystery-thing', count: 1 }],
      copilotVersionsSeen: ['0.99.0'],
    });
    expect(diagnostics.catalog.models).toBe(3);
  });

  it('surfaces schema drift recorded during ingestion, de-duplicated and sorted', () => {
    const { database } = seededStore();
    database.db.exec(`
      UPDATE sessions SET unknown_part_kinds = '["zebra","alpha"]', unknown_request_keys = '["newKey"]', invalid_requests = 2
       WHERE id = 'fx-auto-1';
      UPDATE sessions SET unknown_part_kinds = '["alpha"]', invalid_requests = 1 WHERE id = 'fx-byok-1';`);
    const { drift, index } = getDiagnostics(database, scan);
    expect(drift).toEqual({ unknownPartKinds: ['alpha', 'zebra'], unknownRequestKeys: ['newKey'] });
    expect(index.invalidRequests).toBe(3);
  });

  it('is well-formed and empty on an empty index', () => {
    const { database } = seededStore();
    database.db.exec(
      'DELETE FROM sessions; DELETE FROM llm_calls; DELETE FROM debug_sessions; DELETE FROM models',
    );
    const diagnostics = getDiagnostics(database, { ...scan, role: 'idle', lastSyncAt: null });
    expect(diagnostics.index).toEqual({ sessions: 0, turns: 0, invalidRequests: 0 });
    expect(diagnostics.debugLog.unknownDebugNames).toEqual([]);
    expect(diagnostics.catalog).toEqual({ models: 0, lastSeenAt: null });
  });

  it('contains no conversation text, even with debug logs and prompts in the index', () => {
    const json = JSON.stringify(getDiagnostics(seededStore().database, scan));
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('Fix the timeout race');
  });
});
```

Run: `pnpm vitest run src/core/query/diagnostics.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 2: DTO and implementation**

In `dto.ts` (this schema's numbers are diagnostics counts; it is **not** part of the provenance allow-list test):

```ts
// ---- diagnostics ----
export const diagnosticsSchema = z.object({
  versions: z.object({ vscode: z.string(), copilotChat: z.string().nullable(), extension: z.string() }),
  debugLogging: z.boolean(),
  scan: z.object({
    role: z.enum(['leader', 'follower', 'idle']),
    lastSyncAt: z.number().nullable(),
    lastError: z.string().nullable(),
    parseErrors: z.number(),
    badLines: z.number(),
  }),
  index: z.object({ sessions: z.number(), turns: z.number(), invalidRequests: z.number() }),
  drift: z.object({ unknownPartKinds: z.array(z.string()), unknownRequestKeys: z.array(z.string()) }),
  debugLog: z.object({
    sessionsWithLogs: z.number(),
    llmCalls: z.number(),
    unknownDebugNames: z.array(z.object({ name: z.string(), count: z.number() })),
    copilotVersionsSeen: z.array(z.string()),
  }),
  catalog: z.object({ models: z.number(), lastSeenAt: z.number().nullable() }),
});
export type Diagnostics = z.infer<typeof diagnosticsSchema>;
```

`src/core/query/diagnostics.ts`:

```ts
import type { Diagnostics } from '../../shared/dto';
import type { Database } from '../storage/database';
import { CatalogStore } from '../storage/catalogStore';

export type ScanDiagnostics = Diagnostics['scan'];

/** Everything except the environment-dependent fields (`versions`, `debugLogging`), which the extension adds. */
export function getDiagnostics(
  database: Database,
  scan: ScanDiagnostics,
): Omit<Diagnostics, 'versions' | 'debugLogging'> {
  const { db } = database;
  const strings = (sql: string): string[] =>
    (db.prepare(sql).all() as unknown as { value: string }[]).map((row) => row.value);
  const index = db
    .prepare(
      `SELECT (SELECT count(*) FROM sessions) AS sessions, (SELECT count(*) FROM turns) AS turns,
              (SELECT coalesce(sum(invalid_requests), 0) FROM sessions) AS invalid`,
    )
    .get() as unknown as { sessions: number; turns: number; invalid: number };
  const logs = db
    .prepare(
      'SELECT (SELECT count(*) FROM debug_sessions) AS sessions, (SELECT count(*) FROM llm_calls) AS calls',
    )
    .get() as unknown as { sessions: number; calls: number };
  const unknownNames = db
    .prepare(
      `SELECT coalesce(debug_name, '(unnamed)') AS name, count(*) AS count FROM llm_calls
        WHERE role = 'UNKNOWN' GROUP BY name ORDER BY count DESC, name`,
    )
    .all() as unknown as { name: string; count: number }[];
  return {
    scan,
    index: { sessions: index.sessions, turns: index.turns, invalidRequests: index.invalid },
    drift: {
      unknownPartKinds: strings(
        'SELECT DISTINCT j.value AS value FROM sessions s, json_each(s.unknown_part_kinds) j ORDER BY value',
      ),
      unknownRequestKeys: strings(
        'SELECT DISTINCT j.value AS value FROM sessions s, json_each(s.unknown_request_keys) j ORDER BY value',
      ),
    },
    debugLog: {
      sessionsWithLogs: logs.sessions,
      llmCalls: logs.calls,
      unknownDebugNames: unknownNames,
      copilotVersionsSeen: strings(
        'SELECT DISTINCT copilot_version AS value FROM debug_sessions WHERE copilot_version IS NOT NULL ORDER BY value',
      ),
    },
    catalog: new CatalogStore(database).stats(),
  };
}
```

Run: `pnpm vitest run src/core/query/diagnostics.test.ts` — Expected: PASS.

- [ ] **Step 3: RPC and extension glue (test first)**

Append to `protocol.test.ts`:

```ts
it('declares getDiagnostics', () => {
  expect(isRpcMethod('getDiagnostics')).toBe(true);
  expect(rpcSchemas.getDiagnostics.params.safeParse({}).success).toBe(true);
});
```

Run — Expected: FAIL. Add to `rpcSchemas`: `getDiagnostics: { params: z.object({}), result: diagnosticsSchema },`
(import `diagnosticsSchema`) and a stub in the RPC-host test:

```ts
  getDiagnostics: () => ({
    versions: { vscode: '1', copilotChat: null, extension: '0' },
    debugLogging: false,
    scan: { role: 'idle' as const, lastSyncAt: null, lastError: null, parseErrors: 0, badLines: 0 },
    index: { sessions: 0, turns: 0, invalidRequests: 0 },
    drift: { unknownPartKinds: [], unknownRequestKeys: [] },
    debugLog: { sessionsWithLogs: 0, llmCalls: 0, unknownDebugNames: [], copilotVersionsSeen: [] },
    catalog: { models: 0, lastSeenAt: null },
  }),
```

In `extension.ts` add the handler (after `service` exists):

```ts
    getDiagnostics: () => {
      const last = service.lastResult;
      const stats = last?.role === 'leader' ? last : null;
      return {
        versions: {
          vscode: vscode.version,
          copilotChat:
            ((vscode.extensions.getExtension('GitHub.copilot-chat')?.packageJSON as { version?: unknown } | undefined)?.version as
              | string
              | undefined) ?? null,
          extension: version,
        },
        debugLogging: readDebugLoggingEnabled(),
        ...getDiagnostics(database, {
          role: last?.role ?? 'idle',
          lastSyncAt: Number(state.getMeta(META.lastSyncAt)) || null,
          lastError: service.lastError,
          parseErrors: stats?.errors.length ?? 0,
          badLines: stats?.badLines ?? 0,
        }),
      };
    },
```

(imports: `getDiagnostics`, `META` from `../core/ingest/ingestService`, `readDebugLoggingEnabled`; type-check the
`packageJSON` access and simplify if TypeScript complains.)

Run: `pnpm typecheck && pnpm vitest run src/shared src/extension` — Expected: PASS.

- [ ] **Step 4: Write the failing view tests** — `src/webview/views/DiagnosticsView.test.tsx`

```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Diagnostics } from '../../shared/dto';
import { renderWithHost } from '../test/fakeHost';
import { DiagnosticsView } from './DiagnosticsView';

const diagnostics = (overrides: Partial<Diagnostics> = {}): Diagnostics => ({
  versions: { vscode: '1.139.1', copilotChat: '0.67.0', extension: '0.5.0' },
  debugLogging: true,
  scan: { role: 'leader', lastSyncAt: 1790000000000, lastError: null, parseErrors: 0, badLines: 1 },
  index: { sessions: 71, turns: 312, invalidRequests: 0 },
  drift: { unknownPartKinds: [], unknownRequestKeys: [] },
  debugLog: { sessionsWithLogs: 81, llmCalls: 9, unknownDebugNames: [], copilotVersionsSeen: ['0.67.0'] },
  catalog: { models: 55, lastSeenAt: 1790000000000 },
  ...overrides,
});

describe('DiagnosticsView', () => {
  it('shows versions, the index, the scan and the debug-log state', async () => {
    renderWithHost(<DiagnosticsView />, { getDiagnostics: diagnostics() });
    const environment = await screen.findByRole('region', { name: 'Environment' });
    expect(within(environment).getByText('1.139.1')).toBeInTheDocument();
    expect(within(environment).getByText('0.67.0')).toBeInTheDocument();
    expect(within(environment).getByText(/Agent debug logging: on/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Index' })).toHaveTextContent('71 sessions');
    expect(screen.getByRole('region', { name: 'Index' })).toHaveTextContent('312 turns');
    expect(screen.getByRole('region', { name: 'Scan' })).toHaveTextContent('leader');
    expect(screen.getByRole('region', { name: 'Debug logs and catalog' })).toHaveTextContent('55 models');
  });

  it('says there is no schema drift when nothing unknown was seen', async () => {
    renderWithHost(<DiagnosticsView />, { getDiagnostics: diagnostics() });
    expect(await screen.findByText(/No unknown fields/)).toBeInTheDocument();
  });

  it('lists drift, invalid requests and unclassified debugNames so they can be acted on', async () => {
    renderWithHost(<DiagnosticsView />, {
      getDiagnostics: diagnostics({
        drift: { unknownPartKinds: ['newPart'], unknownRequestKeys: ['newKey'] },
        index: { sessions: 1, turns: 2, invalidRequests: 3 },
        debugLog: {
          sessionsWithLogs: 1,
          llmCalls: 4,
          unknownDebugNames: [{ name: 'mystery-thing', count: 2 }],
          copilotVersionsSeen: [],
        },
        scan: { role: 'follower', lastSyncAt: null, lastError: 'disk full', parseErrors: 1, badLines: 0 },
      }),
    });
    const drift = await screen.findByRole('region', { name: 'Schema drift' });
    expect(within(drift).getByText('newPart')).toBeInTheDocument();
    expect(within(drift).getByText('newKey')).toBeInTheDocument();
    expect(within(drift).getByText(/3 invalid request/)).toBeInTheDocument();
    expect(screen.getByText('mystery-thing')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Last scan failed: disk full');
  });

  it('offers to enable exact telemetry when it is off and asks the extension to do it', async () => {
    const { calls } = renderWithHost(<DiagnosticsView />, {
      getDiagnostics: diagnostics({ debugLogging: false }),
      enableDebugLogging: { outcome: 'enabled' },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Enable exact telemetry…' }));
    expect(calls.map((call) => call.method)).toContain('enableDebugLogging');
    expect(await screen.findByText(/new Copilot chat sessions/)).toBeInTheDocument();
  });

  it('does not offer the button when logging is already on', async () => {
    renderWithHost(<DiagnosticsView />, { getDiagnostics: diagnostics() });
    await screen.findByText(/Agent debug logging: on/);
    expect(screen.queryByRole('button', { name: 'Enable exact telemetry…' })).not.toBeInTheDocument();
  });

  it('shows an error when the extension fails', async () => {
    renderWithHost(<DiagnosticsView />, {});
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load diagnostics: boom');
  });
});
```

Run: `pnpm vitest run src/webview/views/DiagnosticsView.test.tsx` — Expected: FAIL (module not found).

- [ ] **Step 5: Implement the view and the tab**

`src/webview/views/DiagnosticsView.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Diagnostics } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { Button } from '../ui/Button';
import { formatDateTime, formatInt } from '../ui/format';

export function DiagnosticsView() {
  const rpc = useRpc();
  const query = useQuery({ queryKey: ['diagnostics'], queryFn: () => rpc.call('getDiagnostics', {}) });
  return (
    <section aria-label="Diagnostics">
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && <p role="alert">Could not load diagnostics: {query.error.message}</p>}
      {query.data && <Body data={query.data} />}
    </section>
  );
}

function Body({ data }: { data: Diagnostics }) {
  const rpc = useRpc();
  const queryClient = useQueryClient();
  const enable = useMutation({
    mutationFn: () => rpc.call('enableDebugLogging', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['diagnostics'] }),
  });
  const { drift, index, debugLog, catalog, scan, versions } = data;
  const hasDrift =
    drift.unknownPartKinds.length > 0 || drift.unknownRequestKeys.length > 0 || index.invalidRequests > 0;
  return (
    <>
      <section className="card" aria-label="Environment">
        <h3>Environment</h3>
        <dl className="facts">
          <dt>VS Code</dt>
          <dd>{versions.vscode}</dd>
          <dt>Copilot Chat</dt>
          <dd>{versions.copilotChat ?? 'not found'}</dd>
          <dt>Copilot Insights</dt>
          <dd>{versions.extension}</dd>
        </dl>
        <p>Agent debug logging: {data.debugLogging ? 'on' : 'off'}</p>
        {!data.debugLogging && (
          <>
            <p className="muted">
              Turning it on adds cached tokens, per-request latency and Copilot’s own usage figures for new
              sessions. Copilot writes prompts to those log files on this machine; Copilot Insights never
              stores them.
            </p>
            <Button
              onClick={() => {
                enable.mutate();
              }}
              disabled={enable.isPending}
            >
              Enable exact telemetry…
            </Button>
          </>
        )}
        {enable.data?.outcome === 'enabled' && (
          <p role="status">Enabled. It applies to new Copilot chat sessions.</p>
        )}
        {enable.data?.outcome === 'declined' && <p role="status">Left off.</p>}
      </section>
      <section className="card" aria-label="Index">
        <h3>Index</h3>
        <p>
          {formatInt(index.sessions)} sessions · {formatInt(index.turns)} turns
        </p>
      </section>
      <section className="card" aria-label="Scan">
        <h3>Scan</h3>
        <p>
          Role: {scan.role}
          {scan.lastSyncAt !== null && ` · last scan ${formatDateTime(scan.lastSyncAt)}`}
        </p>
        <p className="muted">
          {formatInt(scan.parseErrors)} files failed to parse · {formatInt(scan.badLines)} unreadable lines
          skipped
        </p>
        {scan.lastError !== null && <p role="alert">Last scan failed: {scan.lastError}</p>}
      </section>
      <section className="card" aria-label="Schema drift">
        <h3>Schema drift</h3>
        {!hasDrift ? (
          <p className="muted">No unknown fields: Copilot’s files match what this version parses.</p>
        ) : (
          <>
            <p className="muted">
              Copilot wrote fields this version does not understand. Details belong in
              docs/copilot-data-formats.md.
            </p>
            {drift.unknownPartKinds.length > 0 && (
              <p>
                Unknown response part kinds:{' '}
                {drift.unknownPartKinds.map((kind) => (
                  <code key={kind}>{kind} </code>
                ))}
              </p>
            )}
            {drift.unknownRequestKeys.length > 0 && (
              <p>
                Unknown request keys:{' '}
                {drift.unknownRequestKeys.map((key) => (
                  <code key={key}>{key} </code>
                ))}
              </p>
            )}
            {index.invalidRequests > 0 && (
              <p>{formatInt(index.invalidRequests)} invalid requests were skipped.</p>
            )}
          </>
        )}
      </section>
      <section className="card" aria-label="Debug logs and catalog">
        <h3>Debug logs and catalog</h3>
        <p>
          {formatInt(debugLog.sessionsWithLogs)} sessions with debug logs · {formatInt(debugLog.llmCalls)}{' '}
          logged requests · {formatInt(catalog.models)} models in the catalog
          {catalog.lastSeenAt !== null && ` (last seen ${formatDateTime(catalog.lastSeenAt)})`}
        </p>
        {debugLog.copilotVersionsSeen.length > 0 && (
          <p className="muted">Copilot Chat versions in logs: {debugLog.copilotVersionsSeen.join(', ')}</p>
        )}
        {debugLog.unknownDebugNames.length > 0 && (
          <>
            <p className="muted">Requests with a debugName this version does not classify yet:</p>
            <ul className="chips">
              {debugLog.unknownDebugNames.map((entry) => (
                <li key={entry.name}>
                  {entry.name} × {formatInt(entry.count)}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
```

In `App.tsx`: add `'diagnostics'` to the tab list (label "Diagnostics") and render `<DiagnosticsView />`; add to
`App.test.tsx`: "opens the diagnostics tab" (host provides `getDiagnostics` fixture — export a `diagnostics()`
builder from `dtoFixtures.ts` by moving the one from the test).

Run: `pnpm vitest run src/webview` — Expected: PASS.

- [ ] **Step 6: Docs, verification and commit**

- `README.md`: add "Exact telemetry (opt-in)" (what enabling Copilot's agent debug log adds, that it stores prompts
  on disk in Copilot's own files, that Copilot Insights reads numbers only), "Provenance" additions (`≥` for lower
  bounds), "Diagnostics", and the new command _Enable Exact Telemetry…_.
- `CHANGELOG.md`: `## 0.5.0 — exact telemetry & trust` listing debug-log telemetry (cached tokens, latency,
  nano-AIU), internal utility calls (lower bound), model catalog tiers, enforced provenance, credit-coverage
  reconciliation, diagnostics view, opt-in flow.
- `package.json`: `"version": "0.5.0"`.
- `docs/ROADMAP.md`: mark Phase 3 done in the phase table; add decisions **D16** (debug logs are enrichment:
  telemetry only, content never read; roles from `debugName` table extended from Diagnostics data), **D17**
  (catalog prices stored as recorded with their batch size, not converted), **D18** (nano-AIU is shown as its own
  exact field and never compared with credits).

```bash
pnpm format && pnpm verify
pnpm test:integration
pnpm smoke:real
pnpm package   # inspect: no .map/src/test files; delete the .vsix afterwards
git add -A
git commit -m "feat(diagnostics): add diagnostics view; document exact telemetry; release 0.5.0"
```

---

## Phase exit criteria

Phase 3 is done when all of the following are true on `main`:

- `pnpm verify`, `pnpm test:integration` and `pnpm smoke:real` pass; the real-data smoke reports the debug-log
  aggregates without printing any content.
- A session with a matching debug log shows exact cached tokens, first-token latency and nano-AIU per turn, each
  with an `Exact` badge; sessions without one say how to enable it, and enabling only ever happens after the
  modal confirmation.
- Every numeric field of every DTO is `Measured` or explicitly allow-listed (`dto.provenance.test.ts`), and partial
  sums render with `≥`.
- The Overview shows Copilot's internal utility calls as a lower bound and model tiers from the catalog; the GitHub
  card shows billed vs local credits, coverage and the unexplained remainder without ever attributing credits to
  sessions.
- The Diagnostics tab shows versions, scan status, schema drift, unclassified `debugName`s and catalog size.
- No `SECRET-*` sentinel from any debug-log fixture appears in the database, any DTO or any diagnostics.
- `docs/ROADMAP.md` marks Phase 3 done and records D16–D18.

Then write the Phase 4 plan (`docs/superpowers/plans/<date>-phase-4-outcome-intelligence.md`) from the Phase 4
task table in `docs/ROADMAP.md`, using the interfaces this plan produced.
