# Session explorer and dashboard research

Reviewed **2026-10-01**. Expanded from four references to **29 projects: 20 primary OSS references
and nine supplementary references**. Recommendation: combine Laminar's readable transcript,
Langfuse's inspection workflow, Claude Code Viewer's contextual detail panel, LibreChat's context
accounting, and MLflow's tool analytics. Implement these patterns inside the existing VS Code webview.

## Method and scope

This is a desk review of first-party repositories, READMEs, official documentation and documented screen
examples. The products were not all installed or benchmarked. Features below are documented capabilities;
"borrow" and priority rankings are design judgments for TraceOn, not comparative performance results.
Popularity is a GitHub star snapshot fetched from the GitHub repository API on the review date, rounded to
one decimal thousand. Stars indicate community interest, not product quality. Repository links identify the
metadata sources. All 20 primary references were unarchived; last repository pushes were August–October 2026. A recent push is an activity signal, not a guarantee of support.

Selection favors established projects with at least 1,000 stars and direct relevance to session inspection,
LLM observability, coding-agent history, conversation UI, or analytics. Grafana and Jaeger are mature
adjacent references; ccusage is a CLI reporting reference, not a graphical session viewer. This is a broad
relevance-selected review, not a claim that these are the 20 most popular products globally.

Projects labeled **core** have proprietary enterprise directories. Their OSS core counts here; a hosted
feature is not assumed to be available in the OSS edition. Source-available products and SDK repositories
are listed separately. Read the applicable file license before copying code. Recommendations use design
patterns and original implementation; this extension does not send sessions to these products or depend
on their services.

## Twenty primary OSS references

| #   | Project / stars                                                               | License scope                           | Screens and documented functionality                                                                                                                             | What to borrow; fit for this extension                                                                                                                                        |
| --- | ----------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [Langfuse](https://github.com/langfuse/langfuse) · 35.3k                      | MIT core; enterprise exceptions         | Sessions, trace detail/tree, inputs/outputs, timeline, scores, token/cost dashboards, prompt versions                                                            | **Very high:** session → turn → event navigation, a persistent selected-event inspector, reusable filters. Instrumented spans are richer than local Copilot evidence.         |
| 2   | [Opik](https://github.com/comet-ml/opik) · 22.3k                              | Apache-2.0                              | Trace trees for model/tool/retrieval activity, annotations, datasets, experiments, production monitoring                                                         | **High:** put errors and human feedback next to the exact event; compare recorded runs. Automated judges and optimization would add provider execution.                       |
| 3   | [Helicone](https://github.com/Helicone/helicone) · 6.2k                       | Apache-2.0                              | Request inspection, sessions, latency/cost analytics, prompts and playground                                                                                     | **High:** request-level model/cache/usage details and session grouping. Its gateway/routing architecture does not fit passive native Copilot observation.                     |
| 4   | [LangWatch](https://github.com/langwatch/langwatch) · 4.9k                    | Apache-2.0 core; enterprise exceptions  | Traces, evaluations, coding-agent sessions, context optimization and cost-per-PR workflows                                                                       | **High:** connect usage to coding outcomes and context growth. A documented workflow is not proof of exact attribution for our local data.                                    |
| 5   | [Laminar](https://github.com/lmnr-ai/lmnr) · 3.3k                             | Apache-2.0                              | Transcript/tree views, tool arguments/results, collapsed subagent cards, timeline, metadata, full-text search, dashboards                                        | **Very high:** default to a transcript with compact event previews; offer tree/timing views when useful. Browser replay requires recordings we do not have.                   |
| 6   | [OpenLIT](https://github.com/openlit/openlit) · 2.8k                          | Apache-2.0                              | OpenTelemetry traces, agent/tool/MCP activity, context/prompt management, costs, evaluations and GPU monitoring                                                  | **High:** inspect the whole harness: instructions, tools, context and failures. GPU and infrastructure monitoring are peripheral here.                                        |
| 7   | [MLflow](https://github.com/mlflow/mlflow) · 28.2k                            | Apache-2.0                              | Trace viewer/search, inputs/outputs, usage/quality/tool dashboard tabs, datasets, feedback and experiments                                                       | **Very high:** dedicate analytics to tools: calls, measured duration, known outcomes and failures; drill from charts to matching sessions.                                    |
| 8   | [TruLens](https://github.com/truera/trulens) · 3.6k                           | MIT                                     | Streamlit dashboard: leaderboard, trends, records, complete conversations and side-by-side app-version comparison                                                | **Medium–high:** separate turn metrics from conversation totals; compare similar recorded sessions. Evaluation scores require actual evaluations.                             |
| 9   | [Promptfoo](https://github.com/promptfoo/promptfoo) · 25.6k                   | MIT                                     | Side-by-side prompt/model evaluation results, trace timeline, tool execution paths and assertions                                                                | **High for comparison:** align prompt/context/output/metrics columns across two historical sessions. Its eval runner is outside the passive observer scope.                   |
| 10  | [Langflow](https://github.com/langflow-ai/langflow) · 155.4k                  | MIT                                     | Visual workflow editor, flow logs, native trace view, component input/output inspection, chat session history                                                    | **Medium:** click an execution step to inspect its input/output. A visual workflow editor would imply control over Copilot that we do not have.                               |
| 11  | [LibreChat](https://github.com/LibreChat-AI/LibreChat) · 45.2k                | MIT                                     | Searchable chat history, tool activity, attachments, artifacts, context-usage inspection, ordered model/tool trace viewer                                        | **Very high:** readable conversation, attached-context inventory, separate context categories, and a details panel with structured tool rendering.                            |
| 12  | [Cline](https://github.com/cline/cline) · 69.7k                               | Apache-2.0                              | IDE conversation, file edits/commands, checkpoints, task history with prompt previews, token/cost tracking, search/sort/favorites                                | **Very high:** design for VS Code widths; make history useful with prompt previews and resource-based sorting. Resume/edit/checkpoint control is outside our observer role.   |
| 13  | [OpenCode](https://github.com/anomalyco/opencode) · 211.3k                    | MIT                                     | Coding-agent terminal/desktop UI, session switching/timeline, collapsible execution detail, file references, compaction, session diffs                           | **High:** keyboard navigation, compact tool previews and visible compaction events. We can inspect a compaction, not initiate one in native Copilot.                          |
| 14  | [CloudCLI / Claude Code UI](https://github.com/siteboon/claudecodeui) · 13.9k | AGPL-3.0-or-later; see Section 7 terms  | Project/session navigation, responsive conversation, file explorer, Git explorer and integrated terminal                                                         | **High:** project → session navigation and responsive panel layout. Remote agent control and terminal execution are outside this extension.                                   |
| 15  | [Claude Code Viewer](https://github.com/d-kimuson/claude-code-viewer) · 1.3k  | MIT                                     | Local historical/live logs, cross-project full-text search, right-panel edited files/tools/sub-sessions, dedicated tool visuals with raw toggle, Git diff viewer | **Very high:** closest local-log UX reference. Keep the transcript readable while file/tool details stay inspectable alongside it. Copilot source formats differ.             |
| 16  | [ccusage](https://github.com/ccusage/ccusage) · 18.8k                         | MIT; root license points to app license | Local usage CLI: day/week/month/session reporting, model breakdowns, cache-create/cache-read tokens, billing-window reports                                      | **High for accounting:** show input/output/cache categories distinctly and support model/workspace/date aggregation. API-equivalent dollar estimates are not Copilot credits. |
| 17  | [Chainlit](https://github.com/Chainlit/chainlit) · 12.5k                      | Apache-2.0; community maintained        | Conversation UI, typed steps with input/output/start/end, elements displayed inline or beside conversation                                                       | **High:** compact typed execution steps and adjacent payload previews. Render only recorded content; do not invent private reasoning.                                         |
| 18  | [Mastra](https://github.com/mastra-ai/mastra) · 28.5k                         | Apache-2.0 core; enterprise exceptions  | Studio trace hierarchy/timeline, model/tool inputs/outputs, tokens/timing, correlated logs, metrics and human feedback                                           | **High:** one selected event links payload, usage, errors and annotations. Its framework/runtime is unnecessary for observing Copilot.                                        |
| 19  | [Grafana](https://github.com/grafana/grafana) · 77.0k                         | AGPL-3.0; component exceptions          | Time-series panels, common filter variables, logs exploration and dashboard/data links retaining time and filters                                                | **High for analytics:** consistent date/model/workspace scope and chart → session drill-down. Borrow interaction patterns, not its dashboard-builder complexity.              |
| 20  | [Jaeger](https://github.com/jaegertracing/jaeger) · 23.3k                     | Apache-2.0                              | Trace search, nested spans, duration bars and span detail in a mature tracing UI                                                                                 | **Medium–high:** waterfall and timing inspection once timestamps are reliable. Generic service spans do not explain prompts, cache or coding outcomes by themselves.          |

## Nine supplementary references and corrections

These are useful references but do not count toward the 20 maintained OSS products above.

| Project / stars                                                 | Classification and relevance                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Arize Phoenix](https://github.com/Arize-ai/phoenix) · 11.7k    | Strong span/input/output, retrieval, evaluation and prompt comparison reference. The current [root license](https://github.com/Arize-ai/phoenix/blob/main/LICENSE) is **Elastic License 2.0**, with hosted-service restrictions. Classify separately as source-available despite the project's open-source wording. |
| [Dify](https://github.com/langgenius/dify) · 157.7k             | Useful workflow-run detail and logs. Its [modified Apache license](https://github.com/langgenius/dify/blob/main/LICENSE) adds multi-tenant and frontend branding restrictions; do not treat it as plain Apache-2.0.                                                                                                 |
| [Open WebUI](https://github.com/open-webui/open-webui) · 153.7k | Useful conversation, files, search and usage UI. Current code has [mixed licenses and a branding-preservation requirement](https://github.com/open-webui/open-webui/blob/main/LICENSE); distinguish from a permissively licensed full platform.                                                                     |
| [Flowise](https://github.com/FlowiseAI/Flowise) · 55.5k         | Visual workflow design reference, Apache-2.0 core with enterprise exceptions. Repository is **archived**; not a preferred maintained implementation reference.                                                                                                                                                      |
| [Roo Code](https://github.com/RooCodeInc/Roo-Code) · 24.3k      | Apache-2.0 coding-agent UI reference. Repository is **archived** and README reports the extension shut down May 15; favor Cline/OpenCode for current patterns.                                                                                                                                                      |
| [Langtrace](https://github.com/Scale3-Labs/langtrace) · 1.2k    | AGPL-3.0 observability UI, Apache-2.0 SDKs. Trace/latency/cost analysis is relevant, but last repository push was 2025-11-17, much older than primary references. Not archived; low recent activity does not establish abandonment.                                                                                 |
| [W&B Weave](https://github.com/wandb/weave) · 1.1k              | Apache-2.0 tracing/evaluation toolkit. Review its trace and experiment UX as a hosted-product reference; an OSS SDK/server implementation does not establish that the entire hosted UI is freely self-hostable.                                                                                                     |
| [AgentOps](https://github.com/AgentOps-AI/agentops) · 5.9k      | MIT **Python SDK** for monitoring/usage. The previous comparison failed to distinguish the SDK from the dashboard service; do not count this repository as a complete OSS dashboard.                                                                                                                                |
| [OpenLLMetry](https://github.com/traceloop/openllmetry) · 7.5k  | Apache-2.0 **instrumentation library**. Useful semantic model for model/tool spans and usage; not a standalone dashboard.                                                                                                                                                                                           |

## Screen-level evidence for the strongest patterns

| Official source                                                                                                                                                                       | Why it matters                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [Langfuse sessions](https://langfuse.com/docs/observability/features/sessions), [trace best practices](https://langfuse.com/docs/observability/best-practices)                        | Multi-turn session grouping and inspection beyond a flat session table.                                                                     |
| [Laminar trace views](https://laminar.sh/docs/platform/viewing-traces)                                                                                                                | Explicit transcript/tree switch, tool arguments/results, collapsed subagents, event previews, optional timing view and metadata inspection. |
| [MLflow dashboard](https://mlflow.org/docs/latest/genai/tracing/observe-with-traces/dashboard/), [trace viewer](https://mlflow.org/docs/latest/genai/tracing/observe-with-traces/ui/) | Separate Usage/Quality/Tool Calls tabs; tool counts, latency and errors; trace detail and search.                                           |
| [Helicone sessions](https://docs.helicone.ai/features/sessions)                                                                                                                       | Group a sequence of requests into a session and inspect its execution.                                                                      |
| [LibreChat README](https://github.com/LibreChat-AI/LibreChat#readme)                                                                                                                  | Context usage, attachments, conversation search, tool rounds and trace inspection are documented together.                                  |
| [Claude Code Viewer features/screenshots](https://github.com/d-kimuson/claude-code-viewer#features)                                                                                   | Right-panel files/tool invocations/sub-sessions, structured tool visuals and raw toggle.                                                    |
| [Cline task history](https://docs.cline.bot/core-workflows/task-management)                                                                                                           | Prompt-preview history, token/time/cost awareness, search and sort by resource use.                                                         |
| [TruLens conversation view](https://www.trulens.org/component_guides/instrumentation/conversation_evaluation/), [dashboard](https://www.trulens.org/getting_started/dashboard/)       | Conversation aggregation without obscuring turn-level measurements; side-by-side comparison.                                                |
| [Promptfoo tracing](https://www.promptfoo.dev/docs/tracing/)                                                                                                                          | Execution timeline alongside result comparison, rather than a final-answer-only score.                                                      |
| [Langflow logs](https://docs.langflow.org/logging)                                                                                                                                    | Click component inputs/outputs for payload inspection; inspect historical chat sessions.                                                    |
| [Chainlit steps](https://docs.chainlit.io/concepts/step), [elements](https://docs.chainlit.io/concepts/element)                                                                       | Distinguish conversation messages from typed execution steps and adjacent content.                                                          |
| [Mastra observability](https://mastra.ai/docs/observability/overview)                                                                                                                 | Link span hierarchy, payload, tokens, timing, logs and feedback.                                                                            |
| [ccusage billing-window reports](https://ccusage.com/guide/blocks-reports)                                                                                                            | Keep cache creation/read and input/output counts intelligible and distinct.                                                                 |
| [Grafana data links](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/configure-data-links/)                                                              | Preserve time range and filter context through drill-down.                                                                                  |
| [OpenCode TUI](https://opencode.ai/docs/tui/)                                                                                                                                         | Session switching and optional tool-detail expansion support quick investigation.                                                           |

## Recommendations for TraceOn

### 1. Make the session explorer the main product screen — first priority

Use a three-region layout on wide screens: a collapsible turn/event navigator, the readable conversation,
and a selected-event inspector. At narrow VS Code widths, show conversation plus an inspector drawer or
switchable detail panel. Keep a compact session header with workspace, model(s), outcome, turns, input/output
tokens, measured duration and credits where available. Put Overview, Sessions, Analytics, Learning and
Diagnostics in stable navigation with a clear active state.

Conversation is the default view. Show the actual user input prominently, then response and compact ordered
tool/file events. Group tools within a turn, with action summaries such as `Read workflow.service.ts`.
Selecting an event reveals full redacted arguments, associated files, status, source and raw structured
metadata. Add Conversation / Events views before introducing a graph. Keep long payloads collapsible and
searchable, with expansion independent from capture: **full capture always; display detail on demand**.
This combines Laminar, Langfuse, Claude Code Viewer and Chainlit patterns.

### 2. Add a Context inspector — first priority, with ingestion work

Show the recorded user prompt separately from system/custom instructions, conversation history, tool
schemas, attached files, retrieved/read content and tool results **when source artifacts provide them**.
For each context item expose source, turn/request association, available content, size and token provenance.
A path reference is not an exact content snapshot; do not label current workspace contents as the historical
prompt. Distinguish attached, read, edited and generated files in an inventory.

Start with existing attachments, file activity and composition telemetry. Extend parsers/storage to retain
redacted instruction artifacts, tool definitions, tool results and actual context snippets from retained
Copilot sources where available. Preserve original event ordering/identifiers. Cover clearing and exports.
Missing payloads must say why: source did not record it, unsupported format, source truncation, or explicitly
cleared. No capture-level switch should return. LibreChat, OpenLIT and trace-input inspectors are the strongest
references; complete capture cannot recover data Copilot never wrote.

### 3. Give Tools and Usage dedicated analysis — next priority

Add tool summary → filtered invocations → invocation details. Show counts, file/command targets, recorded
outcomes, retries and durations when measured. Display tool inputs and results together once results are
captured. A failed turn does not prove every tool failed; unknown status stays unknown.

Add usage charts for input, output and cached tokens over turns and days, context growth and compaction
markers, measured latency distributions and model/workspace breakdowns. Cache-read tokens are generally a
subset of input tokens, not an extra additive category. Keep cache-write accounting provider/source-aware.
Make each chart open matching sessions with existing filters preserved. Show measured credits separately
from estimates. Prefer the MLflow + ccusage + Grafana patterns; defer configurable dashboard builders.

### 4. Improve finding and investigating sessions — next priority

Add model/status/tool/file filters, sort by tokens/credits/duration, search-result snippets with matching
turn links, saved filter views and a failure-focused view grouped by recorded error codes. Preserve list
filters, selection and scroll when returning from a session. Use Cline's useful history and Claude Code
Viewer's full-text navigation. Searching full payloads requires an indexed local search path and query-time
redaction guarantees; the current truncated preview/search fields are not automatically a complete corpus.

### 5. Add comparison and local learning — after the core inspector

Allow two recorded sessions/turns to be compared side by side: user prompt, context inventory changes,
models, tokens/cache, time, credits, tools and observed file outcomes. Match comparable tasks explicitly;
model choice alone cannot establish that one model is better. Promptfoo and TruLens provide the best
comparison patterns. Add local bookmarks, tags and notes to preserve successful approaches and failure
lessons, with clear deletion/export behavior. Deterministic evidence-linked findings can explain repeated
reads, retries and context growth without introducing an AI analysis service.

### 6. Add a waterfall only after reliable request-level spans exist

Capture stable call IDs, parent relationships, start/end times, request usage and model selection if Copilot
sources expose them. Then show model → tool → next model timing with retries and overlap. Until then use an
ordered event list: do not split a turn's aggregate duration into invented spans. Laminar, Jaeger, Langfuse
and Mastra are the useful references. Defer agent graphs without reliable nesting and browser replay without
recordings. Prompt playgrounds, automatic model routing and AI judges require active provider calls and do
not belong in the current passive local product.

## Proposed screens and delivery order

| Order | Screen                                 | Main question answered                                 | Existing data versus additional work                                                                             |
| ----- | -------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 1     | Session conversation + event inspector | What did I ask, what did it answer, and what happened? | Current prompt/response/arguments/files support the foundation; structured tool results need ingestion.          |
| 1     | Context inspector                      | What information was included or referenced?           | File references/composition exist; historical payload snapshots and instructions need source-specific ingestion. |
| 2     | Tools + failures                       | Which actions are expensive, repeated or failing?      | Counts/errors exist; per-tool outcome and duration coverage must be verified.                                    |
| 2     | Usage + context growth                 | Where did tokens/time/credits go?                      | Current telemetry supports part of this; per-request joins and richer context accounting need ingestion.         |
| 2     | Search + saved views                   | How do I find the relevant session quickly?            | Add filters/preferences and local full-text indexing where appropriate.                                          |
| 3     | Compare sessions                       | What changed between two approaches?                   | Comparison UI over existing evidence; context diffs require historical payloads.                                 |
| 3     | Bookmarks + notes                      | What should I reuse or avoid next time?                | New local annotation storage and clearing/export coverage.                                                       |
| 4     | Request waterfall                      | Which step caused latency or a retry?                  | Requires trustworthy event-level timestamps and relationships.                                                   |

A useful acceptance example: open a high-token session, see the initial user request without scrolling
through telemetry, select a file-read event, inspect its recorded arguments/result, see which context
items were referenced versus captured, follow a token spike to its turn, and return to the same filtered
session list. All available text remains captured regardless of which panels are expanded.

## Implemented screens (2026-10-01)

- Theme-aware dashboard shell and responsive session investigation layout, with turn navigation and a tool inspector.
- Session panels: Conversation, Events, Context, Usage, Model calls and Notes. Context distinguishes recorded file references from captured values and latest debug artifacts.
- Tool inspector: call IDs, source, recorded status, redacted arguments and available results. Turn-level files are labeled separately from call attribution.
- Usage: input/output/cache, compactions and measured duration per turn, with links back to the conversation. Analytics switches among credits, input tokens and output tokens, with day drilldowns.
- Tools: scoped counts by workspace/model/date, recorded completion labels, grouped turn errors and session drilldowns.
- Sessions: search across prompts/responses/errors/context values/tool payloads/file paths, model/tool/file/status filters, usage sorting, bookmarks and saved views. Returning from detail preserves the session list and scroll position.
- Compare: initial prompts, models, measured tokens/time/credits, tools, context references and final responses.
- Local bookmarks, tags and notes survive rescans. Content clearing removes notes/tags, context values, results and debug artifacts; session deletion removes annotations. Portable exports include redacted annotations but omit tool/context/debug payloads. Clearing everything also removes saved views.

## Coverage and remaining data requirements

Full local capture is unconditional; no capture-level setting exists. Ingest version 8 rereads retained
sources, while clearing/deletion tombstones prevent restoration. All supported payloads are redacted before
storage and validated/redacted again for inspection. Unsupported, absent or oversized debug artifacts remain
unavailable. The existing debug-artifact parser limit is 5 MB per file.

Recorded model calls have real start times and measured durations, with matched turn links. Internal and
unmatched calls stay separate. A model-to-tool waterfall or agent graph still needs trustworthy tool timing
and parent relationships. Latest recorded instruction/tool artifacts cannot be attributed to individual
requests. Complete assembled prompts and historical file bytes cannot be inferred from reference paths.

Search uses SQLite literal matching over stored payloads; dedicated full-text indexing and highlighted
matching-turn snippets remain follow-ups for large indexes. Comparisons describe recorded evidence rather
than judging model quality. Replay, provider-backed evaluations and prompt playgrounds remain outside this
passive local observer.
