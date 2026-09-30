# Copilot Insights — product vision

> Source: product goal statement from the project owner (2026-09-30). This is the spec every roadmap phase and
> plan argues from.

The complete goal is to build a standalone VS Code extension for deep GitHub Copilot Chat observability and
optimization. It is not just a token counter or billing dashboard. For every Copilot session it should answer:

**What did I ask, what did Copilot actually do, which model was used, how much did it consume, what changed in
the codebase, was the interaction efficient, and how could I improve the next interaction?**

## 1. Exact session capture and reconstruction

- Capture exact native GitHub Copilot Chat sessions from VS Code, including multiple user inputs and Copilot
  outputs within the same session.
- Reconstruct the full session timeline: user prompts, Copilot responses, multiple internal LLM calls per turn,
  tool calls, file reads/edits, terminal/test activity, errors/retries.
- Track exact telemetry where Copilot exposes it: input tokens, output tokens, cached tokens, reasoning tokens,
  model used, model calls, duration, and credits when exact session-level credit data is available.
- Distinguish who chose the model: user manually selected a model; user selected Auto and Copilot chose the
  actual model; Copilot used an internal utility model; unknown when evidence is insufficient.
- Show model routing clearly, for example `Manual · GPT-5.6`, `Auto → GPT-5.6`,
  `Copilot internal → utility model`.

## 2. Coding outcome summaries

For coding work, each session should derive: session intent, final outcome, affected areas/modules, files read,
files modified, files created/deleted, tests added, tests executed, test results, commands run, errors
encountered, unresolved items, and a code-change summary.

Instead of "Copilot responded with 4,000 words", show "Fixed initialization race, changed 4 files, added 3
regression tests, affected execution lifecycle and persistence."

## 3. Usage analytics

Total credits used, today/month totals, day-wise drill-down, model-wise usage, workspace-wise usage,
session-wise usage, input/output/cache totals, request counts, historical trends, and authoritative GitHub usage
reconciliation where available.

## 4. Efficiency analysis

Identify vague or underspecified prompts, requirements arriving late, repeated corrective prompts, unnecessary
repository-wide exploration, excessive context growth, excessive cached context, repeated retries, abandoned
implementation approaches, tool failures, session drift into unrelated work, excessive reasoning effort, and
context that would have been cheaper to restart in a fresh session.

Explain **why** a session was expensive, not merely that it was, for example: 184K input tokens, 121K cached,
11 LLM calls, 19 repository-search/read operations, 5 corrective turns, context grew 2.8× during the session.

## 5. Model-selection analysis

Detect likely cases where a very capable/expensive model was used for a trivial task, Auto appears to have
over-routed a small task, a weak model caused repeated failures for a complex task, or high reasoning effort was
used where normal reasoning likely would have been enough.

Never blindly say "wrong model". Findings must be evidence-based, for example: "Small task, 1 file changed,
first-pass success, expensive model manually selected → likely oversized model", or "Complex concurrency
debugging, lightweight model, 6 corrections, 3 reverted approaches → stronger reasoning model may have been more
efficient."

## 6. Personal historical learning

Over time, compare the user's own sessions to learn which model works best for small fixes and for debugging,
which prompt styles reduce retries, whether Auto routing is actually efficient, typical credits/tokens for
different task types, and which sessions are unusual outliers. For example: "Your small validation changes
normally consume 40–60K tokens. This session used 210K and required 4 corrections."

## 7. Trustworthy telemetry

Every value carries provenance: **Exact**, **Derived**, **Inferred**, or **Unavailable**.

```
Input tokens        184,212        Exact
Actual model        GPT-5.6        Exact
Affected area       Execution      Derived
Prompt quality      Underspecified Inferred
Session credits     —              Unavailable
```

Never mix estimates with exact telemetry.

## 8. Privacy and local control

Everything stays inside the VS Code extension by default. No separate server, no daemon, no external web app,
no CLI, no Claude, no Codex, no other AI provider.

Support metrics-only capture, summaries, full prompt/response capture, retention windows, clearing an
individual session, clearing conversation content only, clearing usage data, clearing by date range, clearing by
workspace, and clearing everything local. Never claim to delete GitHub-side billing/usage history.

## 9. Zero disruption

The user keeps using normal GitHub Copilot Chat — no `@insights` participant, no custom chat interface. The
extension passively observes Copilot's local session/debug data and builds intelligence in the background:

```
Use GitHub Copilot normally
        ↓
Copilot Insights quietly records session evidence
        ↓
Open dashboard when needed
        ↓
See what happened, what changed, what it cost, which model was used, who chose that model, why it was
expensive, whether the prompt/model/context was efficient, and how to improve next time
```

## Summary

Copilot Insights is a local VS Code observability and optimization layer for native GitHub Copilot Chat that
reconstructs exact sessions, measures token/model/credit usage, explains coding outcomes and affected areas,
evaluates prompt/model/context efficiency, and helps developers get better results from Copilot with less waste.

Most tools answer "How much Copilot did I use?" This one answers: **"What did Copilot actually accomplish, why
did it consume what it consumed, and how can I get a better outcome next time?"**
