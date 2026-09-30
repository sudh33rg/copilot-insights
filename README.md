# Copilot Insights

A local VS Code extension that observes your native GitHub Copilot Chat sessions and explains what happened,
what it cost, and how to get better results next time. You keep using Copilot Chat normally; no chat
participant, proxy, server, or AI provider is involved.

> Status: **0.4.0**. Dashboard, session detail, analysis, clear/export and opt-in GitHub usage sync are back on
> top of exact ingestion. Exact telemetry, outcome and efficiency intelligence follow — see `docs/ROADMAP.md`.

## What you get

- **Overview** — today and this month: sessions, turns, exact input/output tokens and Copilot credits, failure rate,
  and breakdowns by model, workspace, and host (Copilot vs BYOK/local).
- **Sessions** — searchable list (title, workspace, prompt text, model) with routing (`Auto → model` /
  `Manual · model`), tokens, credits, turn count and state; failed-only filter; paged.
- **Session detail** — the full timeline: prompt, response (always shown as plain text), model, tokens, credits,
  reasoning time, compactions, tool calls, file activity and errors, plus a deterministic analysis: intent,
  outcome sentence, areas touched, complexity, and prompt findings with their evidence.
- **Provenance on every number** — `Exact` (recorded by Copilot), `Derived` (computed from exact data; partial sums
  are lower bounds), `Inferred` (heuristic), `Unavailable` (never shown as zero). Hover a badge for its source.
- **Clear and export** — delete or clear one session, or by date/workspace/everything; export the index as JSON.
  Deleted sessions are not re-imported. Confirmations happen in VS Code dialogs.
- **GitHub billed credits (opt-in)** — "Sync now" fetches your own daily billed AI credits from GitHub (individual
  billing only). They are shown account-wide, never attributed to sessions.

Commands (Command Palette, category _Copilot Insights_): Open Dashboard, Refresh Copilot Sessions, Rebuild Session
Index, Clear Data…, Export Index as JSON…, Sync GitHub Usage, Delete Data From Previous Version….

## What it reads

Copilot Chat's own session files, read-only: `workspaceStorage/*/chatSessions/*.jsonl` and
`globalStorage/emptyWindowChatSessions/*.jsonl` for the VS Code instance you are running (profiles are
supported), plus any extra folders in `copilotInsights.nativeStorageRoots`. Formats:
`docs/copilot-data-formats.md`.

From them it indexes every turn: your prompt, Copilot's response, the requested model and the model Auto
actually chose, exact prompt/completion tokens, exact Copilot credits (when Copilot records them), context
composition, compactions, reasoning time, tool calls, file reads/edits, failures, and timings.

## Privacy

- Everything stays on your machine in `insights.db` inside the extension's global storage.
- `copilotInsights.captureLevel` (default `summaries`): `metrics` keeps no conversation text at all;
  `summaries` keeps short redacted summaries; `full` keeps complete text. Lowering the level scrubs what is
  already stored.
- Secrets (GitHub/AWS/Slack tokens, API keys, JWTs, private keys, `password=` assignments) are redacted before
  anything is stored.
- Copilot's own files and GitHub-side data are never modified or deleted.
- The only network access is the GitHub REST API (`api.github.com`) when you click _Sync now_; the token is sent
  nowhere else. No AI provider is ever called.
- Tool arguments are never shown in the dashboard or exported.

## Settings

| Setting                                | Default     | Meaning                                 |
| -------------------------------------- | ----------- | --------------------------------------- |
| `copilotInsights.captureLevel`         | `summaries` | `metrics`, `summaries`, or `full`       |
| `copilotInsights.retentionDays`        | `30`        | Days of history to keep (`0` = forever) |
| `copilotInsights.nativeRefreshSeconds` | `60`        | Background scan interval (15–600)       |
| `copilotInsights.nativeStorageRoots`   | `[]`        | Extra `workspaceStorage` folders        |

## Development

Requires Node 22+ and pnpm 11. Working rules: `CLAUDE.md` (work only on `main`).

```bash
pnpm install
pnpm verify            # typecheck, lint, format check, unit tests, build
pnpm test:integration  # runs inside VS Code stable and 1.105.0
pnpm smoke:real        # checks parsing against your real Copilot data; prints counts only
```

Press F5 to launch an Extension Development Host.
