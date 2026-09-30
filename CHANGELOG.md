# Changelog

## 0.4.0 — parity dashboard

- Overview, Sessions and Session detail views (React) on the real ingested data, with provenance badges on every
  metric (`exact` / `derived` / `inferred` / `unavailable`); partial sums are lower bounds, never exact.
- Deterministic session analysis: intent, outcome sentence, areas touched, complexity, prompt findings (system-
  initiated turns excluded; failures come from turn state). Cached per session and invalidated on re-ingest,
  content clear and analyzer version.
- Search across title, workspace, prompt text and model; failed-only filter; paged list.
- Clear a session's text, delete a session, delete by date or workspace, delete everything, export JSON; deletions
  survive rescans through tombstones; modal confirmation in VS Code.
- Opt-in GitHub billed-credit sync (individual billing endpoint, API version 2026-03-10); the token is only ever
  sent to `api.github.com`.
- Offer to delete unused data from the previous version (`usage.sqlite3`, `usage.json`).

## 0.3.0 — rewrite foundation

- Rewrote the extension in strict TypeScript with a React webview, esbuild/Vite builds, Vitest, ESLint, CI,
  and integration tests against VS Code stable and 1.105.0.
- Chat sessions are now parsed by replaying VS Code's real JSONL mutation log. The 0.2 parser recovered no
  turns from real sessions.
- Exact per-turn prompt/completion tokens, Copilot credits, Auto-routing resolution, context composition,
  compactions, reasoning time, tool calls, file events, failures, and system-initiated turns.
- Normalized SQLite storage (`insights.db`) with migrations; per-turn day bucketing.
- Privacy: default capture level `summaries`; secret redaction; `metrics` stores no text; lowering the level
  scrubs stored content; tombstones prevent re-importing deleted sessions.
- Scanning runs in a worker thread; only one VS Code window writes; `extensionKind: ui` for remote workspaces.
- The 0.2 dashboard, analysis, and GitHub usage sync are temporarily unavailable (Phase 2). The 0.2 database
  (`usage.sqlite3`) is left untouched.

## 0.2.0

- Replaced `@insights`-owned chat capture with passive native GitHub Copilot Chat ingestion.
- Added canonical `chatSessions`, Copilot transcript, and Agent Debug log discovery.
- Added incremental native trace scanning with transcript + debug-log fingerprints.
- Added exact multi-turn drill-down with multiple LLM requests and tool calls per turn.
- Added input, cached, output, and directly-reported credit fields to the session list.
- Added Auto/manual/internal model-selection provenance and actual resolved-model display.
- Added reasoning-effort capture when present in Copilot traces.
- Added deterministic session summary, outcome, affected areas, file activity, tests, commands, phases, and unresolved-item extraction.
- Added prompt-efficiency, model-routing, context-health, conversation-health, edit-churn, and discovery-efficiency findings.
- Added "why did this consume so much" cost-driver diagnostics.
- Added visibly inferred consumption attribution and local historical baselines.
- Added one-time consent flow / command to enable GitHub Copilot Agent Debug file logging for exact token/cache telemetry.
- Expanded content clearing to scrub nested turn text and tool arguments/results without deleting retained telemetry.
- Preserved authoritative GitHub daily credit reconciliation without inventing per-session allocation.

## 0.1.0

- Initial standalone VS Code extension with local usage dashboard, GitHub credit sync, local persistence, export, retention and granular clearing.
