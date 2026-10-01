# Copilot Insights

A local VS Code extension that observes your native GitHub Copilot Chat sessions and explains what happened,
what it cost, and how to get better results next time. You keep using Copilot Chat normally; no chat
participant, proxy, server, or AI provider is involved.

> Status: **0.8.0**. Includes exact telemetry, outcome and efficiency intelligence, personal learning,
> analytics and budgets. Planned privacy and release work is tracked in `docs/ROADMAP.md`.

## What you get

- **Overview** — today and this month: sessions, turns, exact input/output tokens and Copilot credits, failure rate,
  and breakdowns by model, workspace, and host (Copilot vs BYOK/local).
- **Sessions** — searchable list (title, workspace, prompt text, model) with routing (`Auto → model` /
  `Manual · model`), tokens, credits, turn count and state; failed-only filter; paged.
- **Session detail** — the full timeline: prompt, response (always shown as plain text), model, tokens, credits,
  reasoning time, compactions, tool calls, file activity and errors, plus a deterministic analysis: intent,
  outcome sentence, areas touched, complexity, and prompt findings with their evidence.
- **Exact telemetry (opt-in)** — with Copilot's agent debug log on, each turn shows cached tokens, first-token
  latency and Copilot's own usage figure (nano-AIU), and the Overview accounts for the utility requests Copilot
  makes itself (titles, summaries, …) as a lower bound. Turn it on with _Enable Exact Telemetry…_. Copilot writes
  your prompts to those log files on this machine; Copilot Insights reads numbers and identifiers only and never
  stores or shows that text.
- **Outcomes** — per session: lines changed, Copilot edits kept / undone / modified, whether inserted lines
  are still present an hour, a day and one commit later, terminal and test exit codes, the change in editor error
  and warning counts, and the commits the session led to with the credits that cost. The Overview adds edit
  survival per model and credits per commit. Git, terminal and diagnostics evidence exists only while VS Code is
  open with this extension; otherwise it shows as unavailable, never as zero.
- **Efficiency** — why a session cost what it did (context growth, prompt makeup, tool rounds, compactions, cache
  hits, failed work), context-bloat advice (unused tool definitions, system-prompt size), hedged model-selection
  and prompt findings with their evidence, failure analytics, and a score shown as its measured components.
  Estimates (a fresh-session restart, the same tokens on other models at list prices) are labelled _Inferred_ /
  _Derived_ and never added to exact totals.
- **Learning (from your own history)** — what is normal for you per task type and model, which models worked best,
  whether opening-prompt habits go with fewer corrections, and how Auto routing compares with your manual picks.
  Everything shows its sample size and stays blank under five sessions.
- **Analytics and budgets** — credits per day, day drill-down, model/workspace breakdowns for a range, session
  compare, and optional monthly/per-workspace credit budgets with a projection and 80%/100% warnings (based on
  credits recorded on this machine).
- **Live status (opt-in)** — the active session's context size and credits in the status bar, with a hint when it
  may be cheaper to start fresh.
- **Credit reconciliation** — after a GitHub sync, per day: GitHub-billed credits vs credits recorded locally,
  coverage %, and the unexplained remainder (other machines, Copilot CLI, github.com, other clients).
- **Model tiers** — each model's tier comes from Copilot's own model catalog, not from name matching.
- **Diagnostics** — versions, scan status, schema drift (fields this version does not understand), unclassified
  request names, and catalog size.
- **Provenance on every number** — `Exact` (recorded by Copilot), `Derived` (computed from exact data; partial sums
  are lower bounds), `Inferred` (heuristic), `Unavailable` (never shown as zero). Hover a badge for its source.
- **Clear and export** — delete or clear one session, or by date/workspace/everything; export the index as JSON.
  Deleted sessions are not re-imported. Confirmations happen in VS Code dialogs.
- **GitHub billed credits (opt-in)** — "Sync now" fetches your own daily billed AI credits from GitHub (individual
  billing only). They are shown account-wide, never attributed to sessions.

Commands (Command Palette, category _Copilot Insights_): Open Dashboard, Refresh Copilot Sessions, Rebuild Session
Index, Clear Data…, Export Index as JSON…, Sync GitHub Usage, Enable Exact Telemetry…, Delete Data From Previous Version….

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
- Full prompts, responses and tool arguments are always captured locally, with secrets redacted.
  There is no capture-level setting.
- Secrets (GitHub/AWS/Slack tokens, API keys, JWTs, private keys, `password=` assignments) are redacted before
  anything is stored.
- Copilot's own files and GitHub-side data are never modified or deleted.
- The only network access is the GitHub REST API (`api.github.com`) when you click _Sync now_; the token is sent
  nowhere else. No AI provider is ever called.
- Redacted tool arguments are shown in the session explorer and omitted from portable JSON exports.
- To tell whether Copilot's inserted lines survive, Copilot Insights stores **salted fingerprints** (truncated
  SHA-256 of each inserted line of at least 20 characters, at most 200 per edit) and a salted hash of each
  terminal command after secret redaction. They cannot be turned back into text, the random per-install salt
  never leaves your machine, and no code or command text is stored. They are not kept at capture level `metrics`,
  and _Clear conversation text_, lowering the level to `metrics`, and _Clear everything_ remove them (clearing
  everything also forgets the salt).
- For context-bloat advice, only the **names** of the tools Copilot sent and the **character counts** of tool
  definitions and the system prompt are kept (from Copilot's debug log); descriptions, schemas and prompt text are
  never stored.
- Git, terminal exit-code and diagnostics evidence comes from VS Code's built-in git extension, terminal shell
  integration and diagnostics, and is only recorded while VS Code is open with this extension. Only counts, file
  paths, commit hashes, exit codes, timestamps and salted hashes are stored — never diffs, messages or command
  text. Clearing a session removes its observations; retention prunes them with the session.

## Settings

| Setting                                  | Default | Meaning                                 |
| ---------------------------------------- | ------- | --------------------------------------- |
| `copilotInsights.retentionDays`          | `30`    | Days of history to keep (`0` = forever) |
| `copilotInsights.nativeRefreshSeconds`   | `60`    | Background scan interval (15–600)       |
| `copilotInsights.nativeStorageRoots`     | `[]`    | Extra `workspaceStorage` folders        |
| `copilotInsights.monthlyCreditBudget`    | `0`     | Monthly credit budget (`0` = off)       |
| `copilotInsights.workspaceCreditBudgets` | `{}`    | Per-workspace monthly budgets           |
| `copilotInsights.liveNudge`              | `false` | Status bar item for the active session  |

## Exploring sessions

The session explorer groups each turn into prompt, response, usage/timing, tool calls and context/file
activity. Search turns by text, model, tool or path, filter failures, and use turn navigation to jump
through a long conversation. Session history also supports exact workspace and date filters.

Complete redacted prompts, responses and tool arguments are always captured. No setting is required.
Attached file paths are labeled separately from tool activity. File contents and tool outputs are not
retained, and JSON exports omit tool arguments. Existing summary indexes are automatically upgraded
on the next scan when their source files still exist; explicit content clearing remains respected.

The dashboard and charts follow the active VS Code theme. See [UI research](docs/UI_RESEARCH.md) for the
open-source references, implemented screens and data requirements for further functionality.

## Development

Requires Node 22+ and pnpm 11. Working rules: `CLAUDE.md` (work only on `main`).

```bash
pnpm install
pnpm verify            # typecheck, lint, format check, unit tests, build
pnpm test:integration  # runs inside VS Code stable and 1.105.0
pnpm smoke:real        # checks parsing against your real Copilot data; prints counts only
```

Press F5 to launch an Extension Development Host.
