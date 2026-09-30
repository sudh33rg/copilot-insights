# Copilot Insights — rewrite roadmap

Spec: `docs/PRODUCT_VISION.md`. Data reference: `docs/copilot-data-formats.md`. Working rules: `CLAUDE.md`
(work only on `main`; no branches or worktrees).

## Why a rewrite

The v0.2 JavaScript prototype (deleted from the tree on 2026-09-30 before Phase 0; recoverable from git history at
commit `46a53c9`) was built against
guessed Copilot formats. Against real data (2026-09-30 review) it reconstructed **0 turns from 478 session
files**; its index held 182 sessions with 0 tokens, 0 credits, and model "Unknown". Its unit tests passed
only because their fixtures used invented formats. Other findings: content leaked at the `metrics` capture
level; cleared data was re-imported; the GitHub token was sent to report-download hosts; parsing blocked the
extension host thread; multiple windows raced on one database; no `extensionKind`.

Meanwhile the real data already exposes most of what the vision asks for — exact per-turn tokens and credits,
exact Auto routing, context composition, compaction events, reasoning time, and exact file edits — so the
rewrite starts from a faithful ingestion core.

## Architecture

```
Copilot files (read-only)                     VS Code window (extension host)
┌───────────────────────────┐   worker     ┌──────────────────────────────────────────────┐
│ workspaceStorage/*/        │  thread     │ src/extension  (thin glue: commands, timers,  │
│   chatSessions/*.jsonl     ├───────────► │   file watcher, config, webview hosting, RPC) │
│ globalStorage/             │ src/core/   │        │                                     │
│   emptyWindowChatSessions/ │ ingest      │        ▼                                     │
│ debug-logs/* (enrichment)  │             │ src/core  (pure TS: ingest, privacy,          │
└───────────────────────────┘             │   storage, analysis, github)                  │
                                            │        │  node:sqlite (WAL, migrations)      │
GitHub REST API (opt-in sync) ◄──────────── │        ▼                                     │
                                            │ globalStorage/local.copilot-insights/        │
                                            │   insights.db  + scanner.lock                │
                                            └───────────────┬──────────────────────────────┘
                                                            │ typed RPC (zod-validated postMessage)
                                                            ▼
                                            src/webview  (React 19 + TanStack Query, strict CSP)
```

Key decisions (record changes to these in this file):

| #   | Decision                                                                                                                                                                                                                                                                                                                                                       | Reason                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| D1  | TypeScript `~6.0` strict, not TS 7                                                                                                                                                                                                                                                                                                                             | typescript-eslint 8.71 supports `<6.1`; type-aware lint is required                                |
| D2  | esbuild for the extension/worker, Vite 8 for the webview                                                                                                                                                                                                                                                                                                       | fastest standard bundlers; single-file outputs; vsce `--no-dependencies`                           |
| D3  | `node:sqlite` only, no JSON fallback                                                                                                                                                                                                                                                                                                                           | available in the extension host (verified by integration test at the 1.105.0 floor); one code path |
| D4  | Normalized schema: `sessions`, `turns`, `tool_calls`, `file_events` (+ analysis tables later)                                                                                                                                                                                                                                                                  | per-turn day bucketing, drill-downs, queries without parsing blobs                                 |
| D5  | Ingestion stores facts; analysis is computed separately and versioned                                                                                                                                                                                                                                                                                          | re-analyse without re-ingesting; analysis can evolve freely                                        |
| D6  | Scan in a worker thread; one leader window writes (lock file)                                                                                                                                                                                                                                                                                                  | zero disruption; no multi-window write races                                                       |
| D7  | Observe only the VS Code instance you are running (+ configured extra roots)                                                                                                                                                                                                                                                                                   | correct profile/portable handling; test isolation                                                  |
| D8  | `extensionKind: ["ui"]`                                                                                                                                                                                                                                                                                                                                        | Copilot data is on the local machine even in Remote/WSL/containers                                 |
| D9  | Provenance is a data type (`Measured<T>`), not a label                                                                                                                                                                                                                                                                                                         | the vision's trust requirement must be enforceable                                                 |
| D10 | Default capture level `summaries`; secrets redacted before storage                                                                                                                                                                                                                                                                                             | privacy by default                                                                                 |
| D11 | Tombstones for deleted/cleared sessions                                                                                                                                                                                                                                                                                                                        | clearing must stay cleared when Copilot rewrites the source file                                   |
| D12 | UI kit: plain semantic components in `src/webview/ui` styled with VS Code CSS variables. `@vscode-elements/react-elements` 2.4.0 spike (2026-09-30): renders in jsdom but throws an unhandled `ElementInternals.setFormValue is not a function`, so tests would need polyfills. Revisit when a component we cannot cheaply build is needed (tree, split pane). | works under strict CSP and in jsdom; all UI goes through one folder                                |
| D13 | No network except GitHub REST on user sync; never forward tokens to non-`api.github.com` hosts                                                                                                                                                                                                                                                                 | privacy and security                                                                               |
| D3a | FTS5 is compiled into `node:sqlite` on VS Code 1.139.1 (stable) and 1.105.0 (floor) — verified 2026-09-30 by integration test                                                                                                                                                                                                                                  | Phase 2 search can use FTS5                                                                        |

## Phase overview

| Phase | Outcome                                                                                             | Depends on                    | Plan                                                     |
| ----- | --------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| 0     | TypeScript/React toolchain, CI, integration harness, typed webview RPC                              | —                             | `plans/2026-09-30-phase-0-1-foundation-and-ingestion.md` |
| 1     | Correct real-data ingestion into SQLite, privacy-safe, off-thread, multi-window-safe                | 0                             | same plan                                                |
| 2     | Parity dashboard in React (sessions, detail, overview, clear/export, GitHub sync)                   | 1                             | written when Phase 1 is done                             |
| 3     | Exact telemetry & trust: debug-log join, model catalog, provenance UI, credit coverage, diagnostics | 2                             | written at phase start                                   |
| 4     | Outcome intelligence: git, edit survival, terminal exit codes, diagnostics delta, task taxonomy     | 3                             | written at phase start                                   |
| 5     | Efficiency & model-selection intelligence (evidence-based findings, counterfactuals)                | 3 (4 for outcome-aware rules) | written at phase start                                   |
| 6     | Personal learning, analytics UX, budgets, live-session nudges                                       | 4, 5                          | written at phase start                                   |
| 7     | Privacy hardening, performance budgets, release to Marketplace                                      | 6                             | written at phase start                                   |

Each later phase gets its own bite-sized plan (`docs/superpowers/plans/`) written when the previous phase is
done, because it builds on interfaces the previous phase creates. The task lists below are the contract for
those plans.

---

## Phase 0 — Foundation

Goal: a strict TypeScript + React extension skeleton that builds, lints, tests, runs in VS Code, and passes CI.

| Task                             | Deliverable                                                                                                                                                                                                                | Acceptance                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 0.1 Toolchain & skeleton         | clean slate (prototype already deleted); `LICENSE` and `media/icon.svg` restored; pnpm + TS 6 + esbuild + Vite + Vitest + ESLint + Prettier; `src/extension/extension.ts` activates; `src/shared/provenance.ts` with tests | `pnpm verify` passes; F5 opens an Extension Development Host that logs activation   |
| 0.2 Integration harness & CI     | `@vscode/test-cli` config for VS Code stable and 1.105.0; activation + `node:sqlite` (+ FTS5 probe) tests; GitHub Actions workflow                                                                                         | `pnpm test:integration` passes on both versions; CI workflow committed (not pushed) |
| 0.3 Webview shell with typed RPC | CSP/nonce HTML builder, `RpcHost` (zod-validated), `RpcClient`, React app with TanStack Query, dashboard panel + sidebar view                                                                                              | unit tests for HTML/RPC/App; integration test opens the dashboard tab               |

## Phase 1 — Real-data ingestion core

Goal: every real chat session on this machine is indexed faithfully, privately, and without blocking VS Code.

| Task                        | Deliverable                                                                                                         | Acceptance                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1.1 Time utilities          | `core/time.ts` (`localDay`, `daysAgo`, `retentionCutoff`)                                                           | DST-safe unit tests                                                                                  |
| 1.2 Mutation-log replayer   | `core/ingest/mutationLog.ts`                                                                                        | kinds 0–3, truncate-then-append, prototype-pollution guard, truncated last line, legacy `.json`      |
| 1.3 Normalizer + fixtures   | `core/ingest/chatSession.ts`, zod schemas, 3 synthetic fixtures                                                     | exact tokens, credits, Auto routing, host, state, tools, file events, compactions, drift diagnostics |
| 1.4 Privacy                 | `core/privacy/redact.ts`, `core/privacy/captureLevel.ts`                                                            | secrets redacted at every level; `metrics` keeps no text/titles/args                                 |
| 1.5 Storage                 | `core/storage/{database,migrations,sessionStore,ingestStateStore}.ts`                                               | migrations, cascade replace, clear content, tombstones (delete dominates), fingerprints, meta        |
| 1.6 Scanner                 | `core/ingest/{roots,scanner}.ts`                                                                                    | profile-aware roots, empty-window sessions, fingerprints, tombstones honoured                        |
| 1.7 Worker & lock           | `core/ingest/{scanWorker,runScan,writerLock}.ts`                                                                    | worker bundle; lock handover on stale/dead owner                                                     |
| 1.8 Ingest service          | `core/ingest/ingestService.ts`                                                                                      | leader/follower behaviour, change notifications, re-parse on ingest-version bump                     |
| 1.9 Extension wiring        | `extension/ingestController.ts`, config, commands, file watcher, retention, `getIndexStatus` RPC, status in webview | integration test ingests fixtures via configured root and shows counts                               |
| 1.10 Real-data smoke + docs | `scripts/smokeReal.ts`, README/CHANGELOG                                                                            | on this machine: `turns === requests` (312 at review time), user text and tokens present             |

## Phase 2 — Parity dashboard (React)

Goal: everything the prototype promised, working on real data, in a maintainable React UI.

| Task                               | Deliverable                                                                                                                                                                                                       | Acceptance                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 2.1 UI kit spike                   | decide `@vscode-elements/react-elements` vs plain components (CSP, jsdom, theming, a11y); record decision D12                                                                                                     | spike test renders a table and button in jsdom and under the real CSP      |
| 2.2 Query layer                    | `core/query/*`: session list (paging, search, filters), session detail, overview totals — all returning `Measured<T>` DTOs defined in `shared/dto.ts`                                                             | unit tests on an in-memory DB built from fixtures                          |
| 2.3 Analysis v1 (port + fix)       | `core/analysis/*` + `session_analysis` table (analyzer version): intent, outcome sentence, affected areas, files, commands, complexity, prompt findings — excluding system-initiated turns, failures from `state` | rule-by-rule unit tests; analysis recomputed when analyzer version changes |
| 2.4 Sessions view                  | virtualized session table (time, title/outcome, routing `Auto → X` / `Manual · X`, input, output, credits, turns, state) with search                                                                              | RTL tests; keyboard navigable                                              |
| 2.5 Session detail view            | timeline of turns (prompt, response as plain text, model, tokens, credits, tools, files, errors, compactions, reasoning time)                                                                                     | RTL tests with fixture DTOs                                                |
| 2.6 Overview & sidebar             | today/month exact local credits and tokens (by turn day), sessions, failure rate, per-model and per-workspace tables, host split (Copilot vs BYOK/local)                                                          | numbers match query-layer tests                                            |
| 2.7 Clear, retention, export       | clear session / content / by date / by workspace / everything (tombstones), export JSON, retention setting; legacy `usage.sqlite3`/`usage.json` detection with an offer to delete                                 | store tests; confirmation dialogs in extension glue                        |
| 2.8 GitHub usage sync (port + fix) | `core/github/*` with injected `fetch`; verify endpoints and API version against current GitHub docs; token only to `api.github.com`; org reports parsed streaming and only the user's own row kept                | unit tests with fake fetch; no token on foreign hosts                      |
| 2.9 README & release notes         | README describes the parity dashboard; CHANGELOG updated                                                                                                                                                          | `pnpm verify` green                                                        |

## Phase 3 — Exact telemetry & trust

| Task                                 | Deliverable                                                                                                                                                                                    | Acceptance                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 3.1 Debug-log span parser            | parse real span format; join `llm_request.attrs.responseId` ↔ `turns.response_id`; new `llm_calls` table (model, debugName, input/output/cached tokens, ttft, duration, `copilotUsageNanoAiu`) | fixtures from the documented format; join tests  |
| 3.2 Internal/utility model detection | classify `COPILOT_INTERNAL` from `debugName`, never from prompt text                                                                                                                           | unit tests per known debugName                   |
| 3.3 Model catalog                    | parse `models.json` (+ `vscode.lm.selectChatModels` metadata): family, vendor, picker category, price table, limits; `models` table with first/last seen                                       | catalog tests; tiers come from data, not regexes |
| 3.4 Opt-in exact telemetry           | explain what debug logging adds (cached tokens, per-call latency, nano-AIU) and that it stores prompts; enable only on explicit consent                                                        | never enabled silently                           |
| 3.5 Provenance everywhere            | provenance badge component; every metric in every view renders from `Measured<T>`; partial sums shown as derived lower bounds                                                                  | RTL tests assert badges                          |
| 3.6 Credit coverage reconciliation   | per day: local exact credits vs GitHub billed credits → coverage %, unexplained remainder (other machines, CLI, github.com)                                                                    | tests with synthetic GitHub + local data         |
| 3.7 Diagnostics view                 | schema drift (unknown part kinds/request keys, invalid requests), parse errors, Copilot/VS Code versions, leader window, last scan                                                             | drift from fixtures is displayed                 |

## Phase 4 — Outcome intelligence

| Task                                 | Deliverable                                                                                                                                                                                                               | Acceptance                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 4.1 Git snapshots                    | via the built-in `vscode.git` API: HEAD and diff numstat when a session's first/last turn is observed live; lines added/removed per session                                                                               | extension-glue tests with a temp repo (integration) |
| 4.2 Edit survival                    | `editedFileEvents` keep/undo/user-modified + later checks whether Copilot-inserted text still exists at +1h/+1d/next commit                                                                                               | survival rate per session and per model             |
| 4.3 Terminal & test results          | `window.onDidEndTerminalShellExecution` exit codes matched to Copilot terminal tool calls and system-initiated turns                                                                                                      | exact pass/fail with provenance                     |
| 4.4 Diagnostics delta                | error/warning counts for edited files before and after the session                                                                                                                                                        | unit tests on the delta logic                       |
| 4.5 Task taxonomy & outcome sentence | deterministic task type (bugfix, feature, refactor, test, docs, explain, debug, config) and a sentence such as "Fixed initialization race, changed 4 files, added 3 regression tests, affected execution and persistence" | golden tests on fixture sessions                    |
| 4.6 Commit linking                   | link sessions to commits that touch the edited files within a window; cost per commit                                                                                                                                     | tests with a temp repo                              |

## Phase 5 — Efficiency & model intelligence

| Task                             | Deliverable                                                                                                                                                                                                 | Acceptance                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 5.1 Cost drivers v2              | evidence list per session using exact data: context composition (tool definitions %, files %, messages %), compactions, rounds, retries, failures, cache hits vs misses (cache hits are cheaper, not waste) | every driver cites its numbers and provenance |
| 5.2 Context-bloat advice         | unused MCP servers/tools (from `tools_N.json`, `mcpServersStarting`, tool usage), instruction-file cost (`copilot-instructions.md`, `AGENTS.md`) × requests                                                 | actionable recommendations with token math    |
| 5.3 Fresh-session counterfactual | estimate tokens saved by restarting at turn k (labeled inferred)                                                                                                                                            | never mixed into exact totals                 |
| 5.4 Model price counterfactual   | "this session on model Y" from the real price table (derived)                                                                                                                                               | tests with catalog fixtures                   |
| 5.5 Model-selection findings     | oversized/undersized/Auto over-routing and high-reasoning findings with evidence strings; never "wrong model"                                                                                               | rule tests with positive and negative cases   |
| 5.6 Prompt findings v2           | underspecified start, late constraints, corrections (system-initiated excluded), drift                                                                                                                      | rule tests                                    |
| 5.7 Failure analytics            | failure rate by model/provider/mode; retries and `maxToolCallsExceeded`                                                                                                                                     | query tests                                   |
| 5.8 Transparent efficiency score | score shown as its components; no fake-precise "estimated tokens"                                                                                                                                           | UI shows components                           |

## Phase 6 — Personal learning & analytics UX

| Task                            | Deliverable                                                                                                               | Acceptance                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 6.1 Baselines                   | per task type × model: median and MAD of tokens/credits; outliers flagged; sample size shown; "not enough data" under n=5 | statistical unit tests    |
| 6.2 Model leaderboard           | per task type: credits per successful session, corrections, edit survival, failure rate, latency                          | query tests               |
| 6.3 Prompt-style learning       | prompt features (length, file references, acceptance criteria, constraints up front) vs retries                           | tests                     |
| 6.4 Auto-routing audit          | Auto outcomes vs manual choices for similar tasks                                                                         | tests                     |
| 6.5 Analytics views             | day drill-down, trends, workspace and model breakdowns, session compare                                                   | RTL tests                 |
| 6.6 Budgets & forecast          | monthly credit budget, projection, per-workspace budget, non-modal alerts                                                 | tests on projection math  |
| 6.7 Live session nudge (opt-in) | status bar for the active session: context size, credits so far, nudge when context ≥3× start or compacted twice          | debounce and opt-in tests |
| 6.8 Weekly digest               | local Markdown report command                                                                                             | snapshot test             |

## Phase 7 — Privacy hardening & release

| Task                                      | Deliverable                                                                                                              | Acceptance                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| 7.1 Excluded workspaces                   | never index listed workspaces; purge on add                                                                              | tests                                  |
| 7.2 Encryption at rest (optional)         | text columns encrypted with a key in `SecretStorage`                                                                     | tests; documented trade-offs           |
| 7.3 Copilot debug-log hygiene             | show disk usage of Copilot debug logs; consent-based pruning                                                             | never automatic                        |
| 7.4 Anonymized export                     | shareable stats without text, paths hashed                                                                               | tests                                  |
| 7.5 Optional AI summaries (decision gate) | only if the owner approves: `vscode.lm` with a cheap Copilot model, opt-in, cost shown, own requests tagged and excluded | owner decision recorded                |
| 7.6 Performance budgets                   | 1,000 sessions: first scan off-thread, dashboard query < 200 ms, memory bounded                                          | benchmark tests in CI                  |
| 7.7 Release                               | publisher id, icon, README with screenshots, Marketplace packaging, CHANGELOG, security review                           | `vsce package` output installs cleanly |
