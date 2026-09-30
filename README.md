# Copilot Insights

A standalone VS Code extension for **native GitHub Copilot Chat observability and efficiency analysis**. It does not use Copilot CLI, Claude Code, Codex, Cursor, or any other AI provider.

## Core behavior

Copilot Insights reads the GitHub Copilot/VS Code traces already persisted under VS Code `workspaceStorage` and builds an entirely local index. The user keeps using normal GitHub Copilot Chat; no `@participant`, proxy, external service, localhost server, or alternate chat UI is required.

It recognizes both current Copilot session families:

- `workspaceStorage/<workspace>/chatSessions/*.{json,jsonl}` — canonical VS Code chat-session state.
- `workspaceStorage/<workspace>/GitHub.copilot-chat/transcripts/*.jsonl` — Copilot agent transcript event streams when present.
- `workspaceStorage/<workspace>/GitHub.copilot-chat/debug-logs/<session-id>/*.jsonl` — detailed Copilot LLM/tool telemetry when Agent Debug file logging is enabled.

## Session-first dashboard

The session list shows, where Copilot records the value:

- exact session identity and timestamp
- workspace
- structured session title / summary / outcome
- model routing (`Auto → actual model`, `Manual`, or `Unknown`)
- total input tokens
- total cached tokens
- total output tokens
- exact per-session AI credits **only when explicitly present in the trace**
- turn count and internal LLM-call count
- task complexity and efficiency score
- prompt/model-efficiency findings

GitHub account/day credit metrics remain authoritative and are never heuristically divided among sessions.

## Multi-turn drill-down

A native session is represented as:

```text
Session
  ├─ Turn 1
  │   ├─ exact user input
  │   ├─ exact Copilot output
  │   ├─ LLM request 1
  │   │   ├─ selected mode/model
  │   │   ├─ resolved model
  │   │   ├─ who chose it
  │   │   ├─ input / cached / output tokens
  │   │   ├─ reasoning effort (when recorded)
  │   │   └─ credits (only when explicitly recorded)
  │   ├─ LLM request 2...
  │   └─ tool calls
  ├─ Turn 2...
  └─ Session analysis
```

## Coding outcome intelligence

The extension deterministically derives a compact result from the trace rather than displaying only the last Copilot message:

- intent and session summary
- final outcome
- affected areas
- files read/modified/created/deleted where tool evidence is available
- tests / verification actions and observed status
- terminal commands
- unresolved items
- detected phases such as discovery, implementation, and verification
- prompt evolution / late constraints
- conversation-health signals

Derived/inferred analysis is kept distinct from exact telemetry.

## Prompt and model efficiency

The local analyzer can flag evidence-backed patterns such as:

- underspecified initial prompt
- constraints added late
- repeated corrective turns
- discovery effort disproportionate to final scope
- context-heavy sessions with small outcomes
- likely oversized manual model choice for a small task
- possible Copilot Auto over-routing (`Auto → high-capability model` for a small/local task)
- possible under-routing on complex tasks with repeated retries
- high edit churn / unstable direction
- excessive context growth where a fresh chat may have been cheaper

These are **inferences**, not claims of objective correctness.

### Model-selection provenance

Every LLM request can be classified as:

- `USER` — manually selected model
- `COPILOT_AUTO` — user selected Auto; Copilot resolved the actual model
- `COPILOT_INTERNAL` — utility/internal model activity
- `UNKNOWN` — trace does not prove who selected it

The UI deliberately displays `Auto → <actual model>` rather than implying the user manually chose the resolved model.

## Why did this consume so much?

Each session can expose deterministic/derived cost drivers:

- repeated/cached context
- many model rounds
- large repository discovery phase
- corrective conversation turns
- context growth

It also provides an **inferred consumption attribution** across productive work, discovery, repeated context, retries/abandoned direction, and user corrections. This is visibly labeled inferred and is never mixed with exact token accounting.

## Historical baselines

When enough local sessions exist, the dashboard computes local medians for comparable task-complexity / selection-mode groups and can show whether a session used materially more tokens than similar past sessions. No external AI call is used for this analysis.

## Exact token/cache telemetry

Canonical session files do not always contain detailed per-request cache counters. Copilot Insights therefore offers, once and never silently, to enable GitHub Copilot's own setting:

```json
"github.copilot.chat.agentDebugLog.fileLogging.enabled": true
```

When enabled, new Copilot debug logs can expose exact per-request input/output/cached tokens, actual models, tool execution, and related debug metadata.

**Privacy note:** Copilot's debug logs can contain prompts and source-code context and are an additional local persisted copy. The extension asks before enabling this setting. It never deletes Copilot's source logs automatically.

Command Palette command:

```text
Copilot Insights: Enable Exact Copilot Token/Cache Telemetry
```

## GitHub credit sync

Optional GitHub usage sync supports:

- personal billing usage
- organization Copilot metrics
- enterprise Copilot metrics
- auto selection of configured source

The extension prefers VS Code's GitHub authentication and supports an optional token in VS Code SecretStorage.

### Accounting rule

```text
Native session/debug trace  → exact session/token/model evidence
GitHub usage API            → authoritative account/day credits
```

If a session has no explicit credit field, the UI shows `—` / unavailable. It does **not** divide the day's credits by token share.

## Privacy and trace clearing

Capture levels:

- `full` (default for this session-observability product): retain exact prompt/response text in the extension's local index.
- `summaries`: retain compact text plus telemetry.
- `metrics`: retain telemetry without conversation text.

From the dashboard or Command Palette:

- clear conversation content only
- clear indexed sessions
- clear synced GitHub usage history
- clear everything local
- clear by date range
- clear by workspace
- delete an individual session

`Clear conversation content` also scrubs turn text and tool arguments/results while retaining token/model/file-level metrics and non-content analysis evidence.

Clearing affects only Copilot Insights' local index. GitHub-side usage records and Copilot's own source session/debug logs are untouched.

## Storage

Stored under `ExtensionContext.globalStorageUri`:

- embedded `node:sqlite` in WAL mode when available
- atomic JSON fallback otherwise

Nothing is written into the source repository.

## Performance

- Native trace scan is incremental using file size + modification-time fingerprints.
- Both canonical session and related debug-log fingerprints participate, so a growing debug log refreshes the session even if the transcript itself is unchanged.
- Background refresh defaults to 60 seconds and is configurable from 15–600 seconds.
- Only changed traces are reparsed.
- Dashboard webview exists only while open; hidden state is not retained.
- GitHub multi-day metric sync uses bounded concurrency.
- No external daemon, CLI, HTTP service, or browser application is started.

## Commands

- `Copilot Insights: Open Dashboard`
- `Copilot Insights: Sync GitHub Usage`
- `Copilot Insights: Refresh Native Copilot Sessions`
- `Copilot Insights: Enable Exact Copilot Token/Cache Telemetry`
- `Copilot Insights: Clear Local Traces`
- `Copilot Insights: Set GitHub Token`
- `Copilot Insights: Export Usage Data`

## Settings

- `copilotInsights.captureLevel`
- `copilotInsights.retentionDays`
- `copilotInsights.nativeRefreshSeconds`
- `copilotInsights.nativeStorageRoots`
- `copilotInsights.githubScope`
- `copilotInsights.githubOrganization`
- `copilotInsights.githubEnterprise`
- `copilotInsights.syncDays`
- `copilotInsights.autoSync`

## Development

Runtime dependencies are intentionally zero.

```bash
npm test
npm run check
```

Open this folder in VS Code and press **F5** to launch an Extension Development Host.
