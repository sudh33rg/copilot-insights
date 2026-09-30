# Test fixtures

Synthetic files that follow the real Copilot formats documented in `docs/copilot-data-formats.md`.
They must never contain real prompts, code, paths, or tokens from a user's machine. When Copilot's format
changes, add a new fixture that reproduces the change instead of copying a real file.

- `chatSessions/auto-agent-session.jsonl` — Copilot Auto agent session, two turns, exact tokens/credits,
  tool rounds, compaction, a secret inside tool arguments, truncate-then-append update, edit outcome events.
- `chatSessions/byok-failed-session.jsonl` — bring-your-own-key model, failed turn, system-initiated turn,
  unknown response part kind and request key, and one invalid request entry.
- `chatSessions/empty-session.jsonl` — a chat that was opened but never used.
