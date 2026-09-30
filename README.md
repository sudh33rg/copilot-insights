# Copilot Insights

A local VS Code extension that observes your native GitHub Copilot Chat sessions and explains what happened,
what it cost, and how to get better results next time. You keep using Copilot Chat normally; no chat
participant, proxy, server, or AI provider is involved.

> Status: **0.3.0 (rewrite in progress)**. The TypeScript/React foundation and exact session ingestion are
> done. Dashboards, analysis, and GitHub usage sync return in Phase 2 — see `docs/ROADMAP.md`.

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
