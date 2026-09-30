# Changelog

## 0.8.0 — personal learning & analytics

- **Learning** tab built from your own sessions, every statistic with its sample size and "not enough data" under
  five sessions: baselines per task type and model (median and spread) with unusual sessions flagged, a model
  leaderboard (credits per successful session, corrections, edits kept, failure rate, first-token latency), prompt
  habits compared with follow-up corrections, and an Auto-routing audit against your manual picks.
- Session detail now says how the session compares with your own history, for example "Your bugfix sessions on
  gpt-5.6-luna normally use 40,000–60,000 input tokens … This one used 210,000."
- **Analytics** tab: credits per day (chart plus table), day drill-down to that day's sessions, model and workspace
  breakdowns for the chosen range, and a side-by-side session compare.
- Budgets: `copilotInsights.monthlyCreditBudget` and `copilotInsights.workspaceCreditBudgets`. The Overview shows
  spend, a linear projection (an estimate) and status; you get a non-modal warning once per month at 80% and 100%.
  Spend is the credits recorded on this machine, a lower bound.
- Opt-in live status bar (`copilotInsights.liveNudge`): the active session's context size and credits, with a hint
  when the context is three times where the session started or has been compacted twice.

## 0.7.0 — efficiency & model intelligence

- Session detail explains _why_ a session cost what it did: context growth, what filled the prompt, tool rounds and
  retries, compactions, failed work, and prompt-cache hits (described as cheaper, never as waste). Every line
  cites its numbers and provenance.
- Context-bloat advice from Copilot's debug log: tool definitions that were never called and the size of the system
  prompt, paid for on every request. Only tool names and character counts are stored; token figures are estimates
  (characters ÷ 4) and labelled inferred.
- Counterfactuals, always labelled as estimates and kept out of exact totals: what restarting in a fresh session
  might have saved, and the list-price cost of the same tokens on cheaper catalog models (a relative index, not a
  credit figure).
- Model-selection findings with evidence and hedged wording: small task on an expensive model you picked, Auto
  routing a small task to an expensive model, a complex task on a lightweight model that needed repeated fixes,
  and long reasoning on a small task. Nothing ever says "wrong model".
- Prompt findings v2: opening prompts with no file or success condition, constraints that arrived late, and
  sessions that drifted into unrelated areas.
- Failure analytics on the Overview by model, provider and mode, with tool-input retries and tool-call-limit hits.
- A transparent efficiency score: a band (good / fair / needs work) shown together with the measured components it
  is averaged from, or no score when there is too little evidence.
- Existing indexes are re-read once to pick up tool-definition and system-prompt sizes.

## 0.6.0 — outcome intelligence

- "Did the session work?" — a new Outcome card per session: lines changed, whether Copilot's edits were kept,
  undone or modified, whether the inserted lines are still in the files an hour / a day / one commit later,
  terminal and test exit codes, the change in VS Code error/warning counts for the edited files, and the commits
  the session led to with their cost.
- Deterministic task type (bug fix, feature, refactor, tests, docs, explanation, debugging, config) and an outcome
  sentence built only from evidence, for example "Bug fix: changed 4 files (2 edited, 2 created; +120 −30 lines),
  added 2 test files, tests passed on the last run — in execution, persistence." Clauses without evidence are
  left out, and the sentence is never stronger than how its task type was decided.
- Overview: edit survival by model, and commits with credits per commit (each session's own Copilot credits split
  evenly over the commits it links to — never GitHub's daily or account credits).
- Live evidence (git, diagnostics, terminal) is only collected while VS Code is open with this extension; when it
  was not, the value is shown as unavailable, never as zero.
- Privacy: to check whether inserted lines survive without keeping code, salted SHA-256 fingerprints of the
  inserted lines (and of terminal commands, after secret redaction) are stored. The salt is random per install and
  never leaves the machine. They are dropped at capture level `metrics`, when content is cleared, and on
  "clear everything". No prompt, code or command text is stored for this.
- Existing indexes are re-parsed once to add the new evidence.

## 0.5.0 — exact telemetry & trust

- Opt-in exact telemetry from Copilot's agent debug log: cached tokens, first-token latency and Copilot's usage
  figure (nano-AIU) per turn, joined by response id. Only numbers and identifiers are read; prompt text in the
  logs is never stored, logged or displayed. Enabling is a command behind a confirmation dialog.
- Copilot's internal utility requests (titles, summaries, …) are classified from Copilot's own request names and
  shown as a lower bound; unclassified names are listed in Diagnostics instead of being guessed.
- Model catalog captured from `models.json`; model tiers in the Overview come from the catalog.
- Provenance is now enforced: every measurement in every DTO is a measured value (a test fails otherwise) and
  partial sums show `≥`.
- Credit coverage per day: local exact credits vs GitHub-billed credits, coverage %, unexplained remainder.
- Diagnostics tab: versions, scan status, schema drift, unclassified request names, catalog size.

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
