# Phase 6: Personal Learning & Analytics UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.
>
> **Git rule (overrides every skill):** work directly on `main`. Do not create branches, worktrees, or pull
> requests. Commit after each task. Do not push unless the user asks.

**Goal:** Turn the user's own history into guidance: what is normal for their task types, which model works best
for them, which prompt habits reduce retries, whether Auto routing pays off, where the credits go over time, and
whether they are on track for a monthly budget — with honest sample sizes and no claims from thin data.

**Architecture:** One internal, cached table of per-session facts (`SessionFacts`) is computed from the existing
session detail and analysis. Pure functions in `src/core/learning/` turn facts into baselines, a leaderboard,
prompt-style comparisons and an Auto audit; every statistic carries its sample size and is `unavailable` under 5
sessions. A new Learning tab and an Analytics tab present them; budgets and the live nudge are small pure modules
with thin VS Code glue.

**Tech Stack:** unchanged (TypeScript 6.0 strict, React 19, TanStack Query, zod 4, `node:sqlite`, Vitest, VS Code
`StatusBarItem` and notification APIs).

**Spec:** `docs/PRODUCT_VISION.md` §3 (usage analytics), §6 (personal historical learning), §7 (provenance);
`docs/ROADMAP.md` Phase 6 table (6.1–6.7); `CLAUDE.md`. Interfaces come from Phases 0–5 on `main`
(`getSessionDetail`, `AnalysisStore`, `InsightsQueries`, `Measured<T>`, the webview `DataTable`/`Measure`).

**Dry-run status:** not dry-run; written against the Phase 0–5 sources.

## Design decisions (made here)

- **D-P6-1 Small samples say so.** Any statistic over fewer than `MIN_SAMPLE = 5` sessions is `unavailable` with the
  source `not enough data: n of 5 sessions`; the sample size is always shown next to the number.
- **D-P6-2 Robust statistics.** Typical values use the median and the median absolute deviation (MAD). A session is an
  outlier when it is more than 3 scaled MADs (`1.4826 × MAD`) from the median **and** at least 1.5× (or at most
  ⅔ of) the median, so a tight group with tiny spread does not flag trivial differences.
- **D-P6-3 Success is defined, not implied.** A session counts as successful when it has no failed user turns, no
  undone edits, and its last known test run did not fail. Corrections are reported separately because they need
  stored prompt text.
- **D-P6-4 Facts come from existing evidence only.** No new ingestion. Credits are Copilot's own per-request credits
  (never GitHub's daily or account totals); BYOK sessions have no credits and are excluded from credit statistics
  (their token statistics remain).
- **D-P6-5 Prompt-style features are coarse and inferred.** At capture level `summaries` prompts are truncated to
  260 characters, so length is not used as a feature; only "names a file", "states a success condition" and
  "states constraints" on the opening prompt are compared with corrections, and only as inferred correlations.
- **D-P6-6 Budgets use local exact credits.** Spend is the sum of Copilot's per-request credits seen locally (a
  lower bound when other machines or clients also use Copilot); the projection is `inferred`. Alerts are
  non-modal, at 80 % and 100 %, once per month per threshold, and only when the user set a budget.
- **D-P6-7 The live nudge is opt-in** (`copilotInsights.liveNudge`, default off), non-modal, and debounced.

## Global Constraints

- Work on `main` only; one Conventional Commit per task; never push without being asked.
- Before every commit: `pnpm format && pnpm verify` must pass (run `pnpm format` twice if a Markdown file changed:
  Prettier's first pass can rewrap). Run `pnpm test:integration` and `pnpm smoke:real` after Tasks 6.0 and 6.7.
- Layering (ESLint-enforced): `shared` → nothing environment-specific; `core` → `node:*`, `zod`, `shared`;
  `extension` → `vscode`, `core`, `shared`; `webview` → `react`, browser, `shared`.
- TDD: failing test first, watch it fail (never write test and implementation in one step), implement, pass.
- Never log, print, or store prompt/response/code text. Prompt features are booleans computed in memory from the
  already-stored opening prompt and never persisted.
- Every user-visible number is a `Measured<T>`; update `ALLOWED` in `src/shared/dto.provenance.test.ts` only for
  genuine index facts (sample sizes, counts of rows, ordinals, timestamps).
- Migrations are append-only (Phase 5 ended at `user_version` 9); this phase adds no table.
- Settings are validated when read (`src/extension/config.ts`): wrong types fall back to defaults.

## Review Focus

1. **Fewer than 5 sessions in a group** → "not enough data" with the count, never a number (6.1–6.4).
2. **All values identical (MAD = 0)** → no outlier flags and no division by zero (6.1).
3. **Mixed BYOK and Copilot sessions** → credit statistics skip BYOK sessions; token statistics keep them (6.1, 6.2).
4. **Month boundaries and budget edge cases** → day 1 of the month, budget 0 = off, spend already over budget, a
   month with no usage, a leap-year February (6.6).
5. **Live nudge with no active session or no input tokens** → nothing shown, no crash, no flicker between
   updates (6.7).

---

## File Structure

| File                                                                                   | Responsibility                                                        |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/core/learning/sessionFacts.ts` (+test)                                            | `SessionFacts` type and `sessionFactsFromDetail` (pure)               |
| `src/core/query/sessionFactsStore.ts` (+test)                                          | collect facts for every session, cached by a data-version key         |
| `src/core/learning/stats.ts` (+test)                                                   | median, MAD, quartiles, outlier rule, `MIN_SAMPLE`                    |
| `src/core/learning/baselines.ts` (+test)                                               | 6.1 baselines per task type × model, outliers, per-session comparison |
| `src/core/learning/leaderboard.ts` (+test)                                             | 6.2 model leaderboard per task type                                   |
| `src/core/learning/promptStyle.ts` (+test)                                             | 6.3 prompt features versus corrections                                |
| `src/core/learning/autoAudit.ts` (+test)                                               | 6.4 Auto versus manual per task type                                  |
| `src/core/query/trends.ts` (+test)                                                     | 6.5 daily trends and range breakdowns                                 |
| `src/core/budget/projection.ts` (+test), `src/core/budget/alerts.ts` (+test)           | 6.6 month projection and alert thresholds                             |
| `src/core/live/nudge.ts` (+test)                                                       | 6.7 live-session status and nudge rules                               |
| `src/extension/budgetAlerts.ts`, `src/extension/liveNudge.ts` (+tests with fake ports) | VS Code glue                                                          |
| `src/webview/views/LearningView.tsx`, `AnalyticsView.tsx`, `BudgetCard.tsx` (+tests)   | UI                                                                    |

---

### Task 6.0: Session facts and statistics foundations

**Files:**

- Create: `src/core/learning/stats.ts`, `stats.test.ts`, `src/core/learning/sessionFacts.ts`,
  `sessionFacts.test.ts`, `src/core/query/sessionFactsStore.ts`, `sessionFactsStore.test.ts`

**Interfaces:**

- Produces (`stats.ts`):

```ts
export const MIN_SAMPLE = 5;
export function median(values: readonly number[]): number | null; // null for []
export function mad(values: readonly number[]): number | null; // median(|x − median|)
export function quartiles(values: readonly number[]): { q1: number; q3: number } | null;
export function isOutlier(value: number, values: readonly number[]): 'high' | 'low' | null; // D-P6-2
export const notEnough = (n: number): string => `not enough data: ${n} of ${MIN_SAMPLE} sessions`;
```

- Produces (`sessionFacts.ts`):

```ts
export interface SessionFacts {
  id: string;
  workspace: string;
  day: string;
  startedAt: number;
  taskType: string | null; // analysis.taskType.value
  model: string | null; // display name of the model behind most user turns (ties: first seen)
  selection: 'auto' | 'manual' | 'mixed' | 'unknown';
  host: 'copilot' | 'byok' | 'unknown';
  inputTokens: number | null;
  credits: number | null; // null unless Copilot reported credits for every Copilot-hosted turn
  userTurns: number;
  corrections: number | null; // null when no prompt text was stored
  failedTurns: number;
  undone: number;
  lastTestPassed: boolean | null;
  editKeepRate: number | null;
  laterSurvival: number | null;
  ttftMs: number | null; // mean first-token latency over turns that have it
  opening: { namesFile: boolean; statesSuccess: boolean; statesConstraints: boolean } | null; // null when no prompt text
  successful: boolean; // D-P6-3
}
export function sessionFactsFromDetail(detail: SessionDetail): SessionFacts;
```

- Produces (`sessionFactsStore.ts`): `class SessionFactsStore { constructor(database: Database); all(): SessionFacts[] }`
  which loads every session through `getSessionDetail` + `AnalysisStore`, and caches the array under the key
  `${count}|${max(ingested_at)}|${max(changed_at)}|${ANALYZER_VERSION}` computed with one cheap SQL query, so a
  second `all()` call with unchanged data does no per-session work.

Rules for `sessionFactsFromDetail`: `credits` = session `credits.value` only when its provenance kind is `exact`
(a derived lower bound is treated as unknown); `host` = `copilot` if any user turn is Copilot-hosted, else `byok`,
else `unknown`; `corrections` counts user turns after the first whose text matches `CORRECTION`
(`src/core/analysis/findings.ts`), `null` when no user turn has text; `opening` uses the same regexes as
`underspecified-start` (export `FILE_REFERENCE`, `ACCEPTANCE_CUE`, `CONSTRAINT` from `findings.ts`);
`successful = failedTurns === 0 && undone === 0 && lastTestPassed !== false`.

- [ ] **Step 1: Failing tests.** `stats.test.ts`: `median([])` → `null`; `median([3,1,2])` → 2;
      `median([1,2,3,4])` → 2.5; `mad([1,1,2,2,4,6,9])` → 1; `quartiles([1..8])` → `{q1: 2.5, q3: 6.5}`;
      `isOutlier(100, [10,11,12,10,11])` → `'high'`; `isOutlier(11, same)` → `null`; `isOutlier(5, [10,10,10,10,10])`
      → `null` when MAD = 0 **and** the ratio rule still allows it? — decide by D-P6-2: with MAD 0 use only the ratio rule
      (≥ 1.5× or ≤ ⅔), so `isOutlier(16, [10,10,10,10,10])` → `'high'` and `isOutlier(11, …)` → `null`; fewer than
      5 values → `null`. `sessionFacts.test.ts`: build a `SessionDetail` with `sessionDetail()` from
      `src/webview/test/dtoFixtures.ts` (import path `../../webview/test/dtoFixtures` is forbidden in `core`; instead
      build the detail from `getSessionDetail(seededStore().database, 'fx-auto-1')` and override fields) and assert:
      fixture values, `corrections: null` without text, `host: 'copilot'`, `successful` false when `lastTestPassed`
      is `false`, credits `null` for a derived (lower-bound) total, BYOK session `host: 'byok'` and `credits: null`.
      `sessionFactsStore.test.ts`: `all()` returns both seeded sessions; a second call returns the same array
      instance (cache hit); after `sessions.replaceSession(..., ingestedAt + 1)` or `ObservationStore.touchSession`
      a new array is built.
- [ ] **Step 2: Run → FAIL. Step 3: Implement** the three modules (export the three regexes from `findings.ts`).
- [ ] **Step 4:** `pnpm format && pnpm verify && pnpm test:integration && pnpm smoke:real` → PASS.
- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(learning): add per-session facts, robust statistics and a cached facts store"
```

---

### Task 6.1: Baselines and outliers

**Files:**

- Create: `src/core/learning/baselines.ts`, `baselines.test.ts`, `src/webview/views/LearningView.tsx`,
  `LearningView.test.tsx`
- Modify: `src/shared/dto.ts`, `src/shared/protocol.ts`, `src/core/query/insightsQueries.ts`,
  `src/extension/extension.ts`, `src/extension/webviewHost/rpcHost.test.ts`, `src/webview/App.tsx`
  (+`App.test.tsx`), `src/webview/views/SessionDetailView.tsx`, `src/shared/dto.provenance.test.ts`,
  `src/webview/test/dtoFixtures.ts`

**Interfaces:**

- Produces (`baselines.ts`):

```ts
export interface BaselineRow {
  taskType: string;
  model: string;
  n: number;
  inputMedian: number | null;
  inputMad: number | null; // null under MIN_SAMPLE
  creditsMedian: number | null; // over Copilot sessions with exact credits, n ≥ MIN_SAMPLE
  creditSessions: number;
}
export function baselineRows(facts: readonly SessionFacts[]): BaselineRow[]; // grouped by taskType × model, n desc
export interface SessionComparison {
  taskType: string;
  model: string;
  n: number;
  verdict: 'typical' | 'high' | 'low';
  median: number;
  typicalLow: number;
  typicalHigh: number; // median ± MAD
  thisSession: number;
}
export function compareToBaseline(
  facts: readonly SessionFacts[],
  session: SessionFacts,
): SessionComparison | null;
export function outliers(
  facts: readonly SessionFacts[],
): { session: SessionFacts; comparison: SessionComparison }[];
```

Grouping needs `taskType` and `model` non-null and `inputTokens` non-null. `compareToBaseline` excludes the session
itself from the reference set and returns `null` when fewer than `MIN_SAMPLE` others remain; verdict from
`isOutlier`.

- DTO: `SessionDetail.baseline: z.object({ taskType: z.string(), model: z.string(), sessions: z.number(), verdict: measured(z.enum(['typical','high','low'])), median: measuredNumber, typicalLow: measuredNumber, typicalHigh: measuredNumber, thisSession: measuredNumber, message: z.string() }).nullable()`;
  `getSessionDetail` sets `baseline: null`; `InsightsQueries.getSession` fills it from the facts store. `message`:
  `Your bugfix sessions on gpt-5.6-luna normally use 40,000–60,000 input tokens (median 48,000, 12 other sessions). This one used 210,000.`
  (`high`/`low` verdict adds ` That is unusually high.` / ` unusually low.`). All numbers `derived`, source
  `median ± MAD of your other sessions of the same task type on the same model`; `verdict` `inferred`.
  `ALLOWED.sessionDetail` += `baseline.sessions`.
- RPC `getBaselines: { params: {}, result: z.object({ rows: z.array(baselineRowSchema), outliers: z.array(z.object({ sessionId, title: z.string().nullable(), taskType, model, verdict: measured(...), thisSession: measuredNumber, median: measuredNumber })) }) }`
  with `baselineRowSchema = { taskType, model, sessions: z.number(), inputMedian: measuredNumber, creditsMedian: measuredNumber, creditSessions: z.number() }`
  (under-sample medians are `unavailable` with `notEnough(n)` source; add `sessions`, `creditSessions` to `ALLOWED`).

- [ ] **Step 1: Failing tests** (`baselines.test.ts`, facts built with a local `fact(overrides)` helper):
  - 12 bugfix sessions on model A with inputs 40K–60K and one with 210K → `baselineRows` has one row n=13 with a
    median near the middle and `compareToBaseline` of the 210K session → verdict `high`, median/typical range,
    `n` = 12 (others);
  - a session inside the range → `typical`; a low one → `low`;
  - group of 4 → `inputMedian: null`; `compareToBaseline` → `null`;
  - identical values (MAD 0): no outliers, verdict `typical` for the same value, `high` for 1.5× (ratio rule);
  - sessions with `taskType` or `model` null are never grouped; BYOK sessions count for tokens but not
    `creditSessions`;
  - `outliers` lists each outlier once, highest deviation first.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: DTO + protocol + `InsightsQueries` (`getBaselines`,
      baseline in `getSession`) + handler + provenance `ALLOWED` + rpc test handler.** Tests: an
      `insightsQueries.test.ts` case that seeds 6 cloned sessions (use `cloneSession` from
      `test/fixtures/sessions.ts` with distinct ids and scaled `prompt_tokens` via SQL) and checks
      `getSession(id).baseline` for an inflated one (`verdict.value === 'high'`, message contains
      `normally use`), and `null` for a lone session.
- [ ] **Step 5: UI.** Add a **Learning** tab to `App.tsx` (`TAB_LABEL.learning = 'Learning'`; update `App.test.tsx`
      to click it). `LearningView` (region `Learning`) renders, for this task, a `Baselines` section: a table
      `Typical usage by task type and model` (Task, Model, Sessions, Median input tokens `Measure`, Median credits
      `Measure`; under-sample cells show `—` + badge and the source text in the badge title) and an `Unusual
sessions` list (title, verdict badge, `210,000 vs median 48,000`). Empty text
      `Not enough history yet: baselines need at least 5 sessions of the same task type on the same model.`
      `SessionDetailView` shows `baseline.message` (muted, with the verdict badge) under the totals when non-null.
      Tests: table values and badges, under-sample placeholder, outlier list, empty state, error line; the detail
      view test shows the message and omits it for `null`.
- [ ] **Step 6:** `pnpm format && pnpm verify` → PASS. **Step 7: Commit**

```bash
git add -A
git commit -m "feat(learning): compare sessions with your own baselines and flag outliers"
```

---

### Task 6.2: Model leaderboard per task type

**Files:**

- Create: `src/core/learning/leaderboard.ts`, `leaderboard.test.ts`
- Modify: `src/shared/dto.ts`, `src/shared/protocol.ts`, `src/core/query/insightsQueries.ts`,
  `src/extension/extension.ts`, `src/extension/webviewHost/rpcHost.test.ts`,
  `src/webview/views/LearningView.tsx` (+test), `src/shared/dto.provenance.test.ts`

**Interfaces:**

- Produces:

```ts
export interface LeaderboardRow {
  taskType: string;
  model: string;
  sessions: number;
  successfulSessions: number;
  creditsPerSuccess: number | null; // Σ exact credits of successful Copilot sessions ÷ their count (needs ≥ MIN_SAMPLE)
  creditSessions: number;
  correctionsPerSession: number | null; // mean over sessions with stored text (≥ MIN_SAMPLE)
  editKeepRate: number | null; // mean of sessions' keep rates (≥ MIN_SAMPLE sessions with one)
  failureRate: number | null; // failed turns ÷ user turns over the group (≥ MIN_SAMPLE sessions)
  ttftMs: number | null; // mean of sessions' mean first-token latency (≥ MIN_SAMPLE sessions with one)
}
export function leaderboard(facts: readonly SessionFacts[]): { taskType: string; rows: LeaderboardRow[] }[];
```

Groups by `taskType` × `model` (both non-null). Each metric is computed only from the sessions that have it and is
`null` when fewer than `MIN_SAMPLE` do. Rows within a task type sort by `successfulSessions` desc then model name; a
task type appears only when at least one row has `sessions ≥ MIN_SAMPLE`.

- DTO `leaderboardRowSchema` (numbers measured: `creditsPerSuccess`, `correctionsPerSession`, `editKeepRate`,
  `failureRate`, `ttftMs`; counts `sessions`, `successfulSessions`, `creditSessions` are index facts added to
  `ALLOWED.leaderboard`); RPC `getLeaderboard: { params: {}, result: z.object({ groups: z.array(z.object({ taskType: z.string(), rows: z.array(leaderboardRowSchema) })) }) }`.
  Derived provenance sources name the rule (`exact credits of successful Copilot sessions ÷ their count`, etc.);
  under-sample metrics are `unavailable` with `notEnough(n)`.

- [ ] **Step 1: Failing tests:** two models on the same task type with 6 sessions each — credits per success uses
      only successful sessions with exact credits (a failed session's credits are excluded; a session with `credits:
null` is skipped and not counted in `creditSessions`); corrections mean ignores sessions with `corrections:
null`; a model with 4 sessions has every metric `null`; a task type whose only model has 4 sessions is
      omitted; rows sorted; BYOK sessions contribute to failure rate and latency but not to credits.
- [ ] **Step 2: Run → FAIL. Step 3: Implement + DTO + protocol + handler. Step 4: UI:** `Model leaderboard`
      section in `LearningView` — one table per task type (`Best models for <task> work`), columns Model, Sessions,
      Credits per success, Corrections per session, Edits kept, Failure rate, First token; all `Measure`s; empty
      text `No task type has 5 or more sessions on a model yet.` Tests: per-task tables, placeholders for
      under-sample metrics, empty state.
- [ ] **Step 5:** `pnpm format && pnpm verify` → PASS. **Step 6: Commit**

```bash
git add -A
git commit -m "feat(learning): add a per-task-type model leaderboard from your own sessions"
```

---

### Task 6.3: Prompt-style learning

**Files:**

- Create: `src/core/learning/promptStyle.ts`, `promptStyle.test.ts`
- Modify: `src/shared/dto.ts`, `src/shared/protocol.ts`, `src/core/query/insightsQueries.ts`,
  `src/extension/extension.ts`, `src/extension/webviewHost/rpcHost.test.ts`,
  `src/webview/views/LearningView.tsx` (+test), `src/shared/dto.provenance.test.ts`

**Interfaces:**

- Produces:

```ts
export type PromptFeature = 'namesFile' | 'statesSuccess' | 'statesConstraints';
export interface PromptStyleRow {
  feature: PromptFeature;
  withFeature: { sessions: number; correctionsPerSession: number | null };
  without: { sessions: number; correctionsPerSession: number | null };
}
export function promptStyle(facts: readonly SessionFacts[]): PromptStyleRow[];
```

Only sessions with `opening !== null` and `corrections !== null` and `userTurns ≥ 2` take part (a one-turn session
cannot have a correction). A side's mean is `null` under `MIN_SAMPLE` sessions. Always all three features, in
that order.

- DTO `promptStyleRowSchema = { feature: z.enum([...]), withFeature: sideSchema, without: sideSchema }` with
  `sideSchema = { sessions: z.number(), correctionsPerSession: measuredNumber }` (`ALLOWED.promptStyle` = the six
  `…sessions` paths); provenance `inferred`, source
  `mean corrections per session, split by whether the opening prompt had the feature (keyword rules; a correlation, not a cause)`;
  under-sample means `unavailable` with `notEnough(n)`. RPC `getPromptStyle: { params: {}, result: z.object({ rows: z.array(promptStyleRowSchema) }) }`.

- [ ] **Step 1: Failing tests:** 6 sessions with file references (corrections 0,0,1,0,1,0) vs 6 without (2,3,1,2,2,3):
      means `2/6` vs `13/6`; a side with 4 sessions → `null`; sessions with `corrections: null`, `opening: null`
      or one user turn are excluded; all three features returned even when empty.
- [ ] **Step 2: Run → FAIL. Step 3: Implement + DTO + protocol + handler. Step 4: UI:** `Prompt style` section:
      for each feature a sentence `Opening prompts that name a file: 0.3 corrections per session (6 sessions)
vs 2.2 without (6 sessions)` built from measures with badges, the note `Correlation from your own history,
not proof that the habit causes fewer corrections. Needs stored prompt text.`, and `Not enough data yet`
      lines for under-sample sides. Tests for text, badges, note, placeholders.
- [ ] **Step 5:** `pnpm format && pnpm verify` → PASS. **Step 6: Commit**

```bash
git add -A
git commit -m "feat(learning): compare opening-prompt habits with follow-up corrections"
```

---

### Task 6.4: Auto-routing audit

**Files:**

- Create: `src/core/learning/autoAudit.ts`, `autoAudit.test.ts`
- Modify: `src/shared/dto.ts`, `src/shared/protocol.ts`, `src/core/query/insightsQueries.ts`,
  `src/extension/extension.ts`, `src/extension/webviewHost/rpcHost.test.ts`,
  `src/webview/views/LearningView.tsx` (+test), `src/shared/dto.provenance.test.ts`

**Interfaces:**

- Produces:

```ts
export interface AuditSide {
  sessions: number;
  creditsPerSession: number | null;
  failureRate: number | null;
  editKeepRate: number | null;
}
export interface AuditRow {
  taskType: string;
  auto: AuditSide;
  manual: AuditSide;
}
export function autoAudit(facts: readonly SessionFacts[]): AuditRow[];
```

Only sessions with `selection` `auto` or `manual` and a known `taskType` count (mixed/unknown are left out, noted in
the UI). `creditsPerSession` is the mean of exact credits over Copilot sessions on that side; `failureRate` =
failed turns ÷ user turns over the side; `editKeepRate` = mean of keep rates; each `null` under `MIN_SAMPLE`
sessions having it. A task type appears only when both sides have at least one session and at least one has
`MIN_SAMPLE`.

- DTO `auditRowSchema`; RPC `getAutoAudit: { params: {}, result: z.object({ rows: z.array(auditRowSchema), excludedSessions: z.number() }) }`
  (`excludedSessions`, each side's `sessions` → `ALLOWED.autoAudit`); derived provenance; under-sample
  `unavailable` with `notEnough(n)`.

- [ ] **Step 1: Failing tests:** 6 auto + 6 manual sessions for `bugfix` with different credits/failure rates
      → correct means and rates; a task type with 6 auto and 0 manual is omitted; 4 manual sessions → that side's
      metrics `null`; mixed/unknown selection counted in `excludedSessions` (via the store-level wrapper) and not in
      either side; BYOK sessions excluded from credits.
- [ ] **Step 2: Run → FAIL. Step 3: Implement + DTO + protocol + handler. Step 4: UI:** `Auto routing vs your own
picks` table per task type with columns for Auto and Manual side by side (sessions, credits per session,
      failure rate, edits kept) and the line `Sessions where the routing was mixed or unknown are left out (N).`;
      neutral wording (no verdict like "Auto is better"). Tests: values, placeholders, excluded note, empty state
      `Needs at least 5 sessions on one side and some on the other.`
- [ ] **Step 5:** `pnpm format && pnpm verify` → PASS. **Step 6: Commit**

```bash
git add -A
git commit -m "feat(learning): audit Auto routing against your manual model choices"
```

---

### Task 6.5: Analytics views — trends, day drill-down, breakdowns, compare

**Files:**

- Create: `src/core/query/trends.ts`, `trends.test.ts`, `src/webview/views/AnalyticsView.tsx`,
  `AnalyticsView.test.tsx`, `src/webview/views/CompareView.tsx`, `CompareView.test.tsx`
- Modify: `src/core/query/overview.ts` (export `breakdown` with a range), `src/shared/dto.ts`,
  `src/shared/protocol.ts`, `src/core/query/insightsQueries.ts`, `src/extension/extension.ts`,
  `src/extension/webviewHost/rpcHost.test.ts`, `src/webview/App.tsx` (+test), `src/shared/dto.provenance.test.ts`

**Interfaces:**

- Produces:

```ts
export function getTrends(database: Database, toDay: string, days: number): TrendDay[]; // one row per local day, oldest first, zero-usage days included
export function getRangeBreakdown(
  database: Database,
  from: string,
  to: string,
): { byModel: BreakdownRow[]; byWorkspace: BreakdownRow[] };
```

- DTO: `trendDaySchema = { day: dayString, sessions: z.number(), turns: z.number(), inputTokens: measuredNumber, outputTokens: measuredNumber, credits: measuredNumber }`
  (`sessions`, `turns` → `ALLOWED.trends`); a day with no turns has `sessions: 0, turns: 0` and `unavailable`
  measures (never 0). RPC `getTrends: { params: z.object({ days: z.number().int().min(1).max(366) }), result: z.object({ days: z.array(trendDaySchema) }) }`,
  `getRangeBreakdown: { params: z.object({ from: dayString, to: dayString }), result: z.object({ byModel: z.array(breakdownRowSchema), byWorkspace: z.array(breakdownRowSchema) }) }`
  (handler validates `from ≤ to` and a span ≤ 366 days, else throws a readable error).
- UI: new **Analytics** tab (`TAB_LABEL.analytics`): range select (`7`, `30`, `90` days) driving `getTrends`; a
  dependency-free inline SVG bar chart of credits per day (`role="img"`, `aria-label` summarising the range) plus an
  accessible `DataTable` of the same days (Day, Sessions, Turns, Input, Output, Credits); activating a day row
  lists that day's sessions beneath (reuse `listSessions({ fromDay, toDay, offset: 0, limit: 50 })` and
  `SessionsView`-style rows with `onOpen` jumping to the session); range breakdown tables by model and workspace for
  the same range (`getRangeBreakdown`). `CompareView` (section `Compare sessions` inside the Analytics tab): two
  `<select>`s populated from `listSessions`, rendering a side-by-side table of the two sessions' input/output
  tokens, credits, turn count, outcome sentence, task type and efficiency band, every cell a `Measure`/text.

- [ ] **Step 1: Failing tests** (`trends.test.ts`): `getTrends(database, day, 7)` returns 7 consecutive days ending
      at `day`, empty days with `sessions: 0` and unavailable measures, the seeded day with exact totals; leap-year
      boundary (`2028-03-01`, 3 days → `2028-02-28`, `02-29`, `03-01`); `getRangeBreakdown` matches the Overview
      breakdown for the same range. RPC validation test for the handler range guard in `rpcHost.test.ts`-style
      (call the exported validator `assertRange(from, to)` from `trends.ts`: throws for `from > to` and for spans over
      366 days).
- [ ] **Step 2: Run → FAIL. Step 3: Implement + DTO + protocol + handlers + provenance `ALLOWED`. Step 4: UI with
      tests** (`AnalyticsView.test.tsx`: range select changes the RPC `days` param; chart has an `img` role with a
      label naming the range and peak day; table rows; clicking a day row fetches that day's sessions; empty state
      `No usage in this range.`; `CompareView.test.tsx`: choosing two sessions shows both columns and outcome
      sentences, and a single choice shows the prompt `Choose two sessions to compare.`).
- [ ] **Step 5:** `pnpm format && pnpm verify` → PASS. **Step 6: Commit**

```bash
git add -A
git commit -m "feat(analytics): add trends, day drill-down, range breakdowns and session compare"
```

---

### Task 6.6: Budgets and forecast

**Files:**

- Create: `src/core/budget/projection.ts`, `projection.test.ts`, `src/core/budget/alerts.ts`, `alerts.test.ts`,
  `src/core/query/budget.ts`, `budget.test.ts`, `src/extension/budgetAlerts.ts`, `budgetAlerts.test.ts`,
  `src/webview/views/BudgetCard.tsx`, `BudgetCard.test.tsx`
- Modify: `package.json` (settings), `src/extension/config.ts` (+test), `src/shared/dto.ts`,
  `src/shared/protocol.ts`, `src/core/query/insightsQueries.ts`, `src/extension/extension.ts`,
  `src/extension/webviewHost/rpcHost.test.ts`, `src/webview/views/OverviewView.tsx`,
  `src/shared/dto.provenance.test.ts`

**Interfaces:**

- Settings (`package.json` → `contributes.configuration`): `copilotInsights.monthlyCreditBudget`
  (`number`, default `0`, minimum `0`, description `Monthly Copilot credit budget measured from credits recorded on this machine. 0 turns budgets off.`),
  `copilotInsights.workspaceCreditBudgets` (`object`, default `{}`, additionalProperties number ≥ 0, description
  `Per-workspace monthly credit budgets, keyed by workspace name.`). `config.ts` gains
  `monthlyCreditBudget: number` and `workspaceCreditBudgets: Record<string, number>` (negative or non-finite
  values ignored).
- Produces (`projection.ts`):

```ts
export interface MonthProjection {
  daysInMonth: number;
  daysElapsed: number; // daysElapsed counts today
  spent: number;
  projected: number; // projected = spent ÷ daysElapsed × daysInMonth
  status: 'ok' | 'watch' | 'over'; // over: spent ≥ budget; watch: projected > budget (spent < budget); else ok
}
export function projectMonth(input: { today: string; spent: number; budget: number }): MonthProjection | null; // null when budget <= 0
```

Edge rules: on day 1 the projection uses `daysElapsed = 1`; `spent = 0` → `projected = 0`, status `ok`; a month with
29 days (leap February) uses the real length; `daysElapsed` never exceeds `daysInMonth`.

- Produces (`alerts.ts`): `thresholdsToAlert(input: { spent: number; budget: number; alerted: readonly (80 | 100)[] }): (80 | 100)[]`
  — thresholds reached (`spent ≥ budget × t/100`) and not yet alerted, ascending; `[]` for budget ≤ 0.
- DTO `budgetSchema = { monthlyBudget: measuredNumber, spent: measuredNumber, projected: measuredNumber, status: measured(z.enum(['ok','watch','over'])), daysElapsed: z.number(), daysInMonth: z.number(), workspaces: z.array(z.object({ workspace: z.string(), budget: measuredNumber, spent: measuredNumber, status: measured(...) })) }).nullable()`
  (`null` when no budget is set; `daysElapsed`, `daysInMonth` → `ALLOWED.budget`). `spent` is the month's sum of
  exact local credits (`derived`, source
  `local Copilot credits recorded this month; other machines and clients are not included (lower bound)`),
  `projected` `inferred` (`linear projection of this month's spend`), `status` `inferred`, budgets `exact`
  (`your setting`). RPC `getBudget: { params: {}, result: budgetSchema }`; the query reads the settings through an
  injected `{ monthlyBudget, workspaceBudgets }` argument (the handler passes `readConfig()`), keeping
  `src/core` free of `vscode`.
- Glue (`budgetAlerts.ts`): `class BudgetAlerts { constructor(deps: { getBudget(): BudgetSummary | null; state: { get(key: string): unknown; update(key: string, value: unknown): PromiseLike<void> }; notify(message: string): void; month(): string }) ; check(): Promise<void> }`
  — for the overall budget and each workspace budget, fires `notify` (non-modal, wired to
  `vscode.window.showWarningMessage` in `extension.ts`) once per month per threshold using state key
  `budget.alerted.<yyyy-mm>.<scope>` (an array of numbers); messages
  `Copilot Insights: you have used 82% of your monthly credit budget (41 of 50 recorded on this machine).` and
  `… reached your monthly credit budget …`; nothing when budgets are off.

- [ ] **Step 1: Failing tests:**
  - `projection.test.ts`: day 10 of a 30-day month with 12 spent → projected 36, `watch` for budget 30, `ok` for
    budget 40; `spent ≥ budget` → `over`; day 1 with spent 3 → projected `3 × daysInMonth`; `spent: 0` → `ok`;
    `2028-02-29` → `daysInMonth` 29 and `daysElapsed` 29; budget 0 or negative → `null`; `2027-02-28` → 28 days.
  - `alerts.test.ts`: 80 % reached → `[80]`; 100 % → `[80, 100]`; already alerted `[80]` at 85 % → `[]`;
    at 100 % with `[80]` → `[100]`; budget 0 → `[]`; spent 0 → `[]`.
  - `budget.test.ts` (seeded store, budget 2, today = the seeded day): `spent` 1.626…, status from the projection,
    `unavailable` spent when no Copilot credits exist, per-workspace rows only for configured workspaces, `null`
    when both budgets are off.
  - `budgetAlerts.test.ts` with a fake state and `notify` spy: one notification per threshold per month; a new
    month alerts again; two `check()` calls in a row notify once; `state.update` rejection does not throw.
  - `config.test.ts` additions: defaults, negative budget ignored, non-object workspace budgets ignored.
- [ ] **Step 2: Run → FAIL. Step 3: Implement** the modules, settings, DTO, protocol, handler; in `extension.ts`
      call `budgetAlerts.check()` from the existing `onChanged` closure (fire-and-forget, errors logged).
- [ ] **Step 4: UI.** `BudgetCard` in Overview (region `Budget`, shown only when the query returns non-null): spent
      `Measure` of budget, a native `<meter>` with `aria-label`, projected `Measure` with the Inferred badge, the
      status sentence (`On track`, `Projected to exceed the budget`, `Over budget`), per-workspace rows, and the note
      `Based on credits recorded on this machine; usage elsewhere is not included.` Tests: each status, workspace
      rows, hidden for `null`, note, `meter` value/max attributes.
- [ ] **Step 5:** `pnpm format && pnpm verify` → PASS. **Step 6: Commit**

```bash
git add -A
git commit -m "feat(budget): add monthly and per-workspace credit budgets with projection and alerts"
```

---

### Task 6.7: Live session nudge, docs, release 0.8.0

**Files:**

- Create: `src/core/live/nudge.ts`, `nudge.test.ts`, `src/extension/liveNudge.ts`, `liveNudge.test.ts`
- Modify: `package.json` (setting + version `0.8.0`), `src/extension/config.ts` (+test), `src/extension/extension.ts`,
  `README.md`, `CHANGELOG.md`, `docs/ROADMAP.md`, `test/integration/*` (activation still green)

**Interfaces:**

- Setting: `copilotInsights.liveNudge` (`boolean`, default `false`, description
  `Show the active Copilot session's context size and credits in the status bar, with a hint when the context has grown a lot.`).
  `config.ts` gains `liveNudge: boolean` (non-boolean → `false`).
- Produces (`nudge.ts`):

```ts
export interface LiveStatus {
  contextTokens: number; // input tokens of the latest request
  credits: number | null; // Σ exact credits so far (null when none reported)
  compactions: number;
  nudge: string | null;
}
export const ACTIVE_WINDOW_MS = 600_000;
export function liveStatus(input: {
  now: number;
  endedAt: number;
  turns: readonly {
    index: number;
    inputTokens: number | null;
    credits: number | null;
    compactions: number;
  }[];
}): LiveStatus | null;
export function statusText(status: LiveStatus): string; // e.g. "Copilot 48K ctx · 1.2 cr"
```

`null` when `now − endedAt > ACTIVE_WINDOW_MS`, when no turn has input tokens, or when there are no turns.
`contextTokens` = input of the last turn with known input; `nudge` =
`Context is 3.2× where this session started. A fresh session may cost less.` when last ÷ first known input ≥ 3
(first must be > 0), else
`This session has been compacted 2 times. A fresh session may cost less.` when compactions ≥ 2, else `null`
(growth wins when both). `statusText`: context as `48K` (`≥ 1000` → thousands with one decimal dropped when whole,
e.g. `1.2M` for ≥ 1,000,000), credits `1.2 cr` (up to 2 decimals trimmed) or omitted when `null`.

- Glue (`liveNudge.ts`): `class LiveNudge { constructor(deps: { enabled(): boolean; active(now: number): { endedAt: number; turns: … } | null; statusBar: { show(text: string, tooltip: string): void; hide(): void }; now(): number }) ; update(): void }`
  — hides when disabled or `liveStatus` is `null`; shows `statusText` with the tooltip (nudge text plus
  `Open the dashboard for details.`) otherwise; only calls `show` again when the text or tooltip changed
  (no flicker). `extension.ts` creates a real `StatusBarItem` (command `copilotInsights.openDashboard`), builds
  `active` from the most recently ended session via `getSessionDetail`, and calls `update()` from `onChanged`
  (debounced 1 s) and the existing 60 s timer; the item is disposed with the extension and hidden when the setting
  is turned off (listen to `onDidChangeConfiguration`).

- [ ] **Step 1: Failing tests** (`nudge.test.ts`): context/credits/compactions from turns; growth nudge at exactly
      3× and not at 2.9×; compaction nudge at 2 and not 1; growth wins over compactions; stale session (`endedAt` 11
      minutes ago) → `null`; no input tokens → `null`; `first ≤ 0` never divides; `statusText` cases (`999` →
      `999`, `48000` → `48K`, `48500` → `48.5K`, `1_200_000` → `1.2M`, credits `1.234` → `1.23 cr`, `null`
      credits omitted). `liveNudge.test.ts` with a fake status bar: disabled → `hide`; active → `show` once for
      two identical updates, again after a change; becomes inactive → `hide`; toggling the setting off hides.
      `config.test.ts`: default false, `true` read, non-boolean → false.
- [ ] **Step 2: Run → FAIL. Step 3: Implement + wire. Step 4: Docs:** README (`What you get`: Learning tab —
      baselines, leaderboard, prompt style, Auto audit; Analytics tab; budgets; live nudge; settings table entries
      for the three new settings), CHANGELOG `0.8.0`, ROADMAP Phase 6 done with D-P6-1…7, `package.json` → `0.8.0`.
- [ ] **Step 5: Full verification:** `pnpm format && pnpm verify`, `pnpm test:integration` (stable and floor),
      `pnpm smoke:real`.
- [ ] **Step 6: Update project memory** (`copilot-insights-status.md`): Phase 6 done, roadmap complete, HEAD hash,
      test counts.
- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(live): add opt-in live session status and nudge; document; release 0.8.0"
```

---

## Self-Review

- **Spec coverage:** 6.1 → Task 6.1 (median/MAD, outliers, sample size, "not enough data" under 5); 6.2 → 6.2
  (credits per successful session, corrections, edit survival via keep rate, failure rate, latency); 6.3 → 6.3;
  6.4 → 6.4; 6.5 → 6.5 (day drill-down, trends, workspace and model breakdowns, session compare); 6.6 → 6.6
  (monthly budget, projection, per-workspace budgets, non-modal alerts); 6.7 → 6.7 (status bar, ≥3× context or two
  compactions, debounce, opt-in). Vision §6's example ("small validation changes normally consume 40–60K tokens;
  this used 210K") is the `SessionComparison.message` of 6.1. "Edit survival" in the leaderboard uses the keep rate
  (`laterSurvival` is carried in `SessionFacts` for a later metric but not shown, to keep the table readable).
- **Placeholder scan:** none intentionally left. Two steps name a file to read for exact accessors (`cloneSession`
  in `test/fixtures/sessions.ts`, `SessionsView` row markup) because those were not re-read while writing.
- **Type consistency:** `SessionFacts` (6.0) is the only input of 6.1–6.4; `MIN_SAMPLE`/`notEnough` (6.0) are used
  by all statistics; `BreakdownRow` (existing) is reused by 6.5; `BudgetSummary` in 6.6 is the inferred type of
  `budgetSchema`.
- **Known risks:** (1) collecting facts for every session runs `getSessionDetail` per session — the facts store
  caches by a cheap data-version key, and the Learning queries are only called when the tab opens; (2) a status
  bar item cannot be inspected in tests, so its logic lives in `LiveNudge` with a fake port and the glue stays
  minimal; (3) Prettier's Markdown wrapping is not idempotent — run `pnpm format` twice before `pnpm verify`.
