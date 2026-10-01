# Session explorer and dashboard research

Reviewed 2026-10-01. These projects are design and capability references; this extension does not send
sessions to them or depend on their services. The implementation is original and stays inside the VS Code
webview, using React, native disclosures, SVG and the local SQLite index.

## Open-source references

| Project                                              | Useful screens and functionality                                                                                                                                                                                                                     | Applied here                                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [Langfuse](https://github.com/langfuse/langfuse)     | [Session replay](https://langfuse.com/docs/observability/features/sessions), [trace tree and agent graph](https://langfuse.com/docs/observability/best-practices), [custom dashboards](https://langfuse.com/docs/metrics/features/custom-dashboards) | Turn navigation, conversation panels, nested tool inspection, filters and usage cards                          |
| [Arize Phoenix](https://github.com/Arize-ai/phoenix) | OpenTelemetry tracing, evaluations, datasets, experiments and replay of traced model calls                                                                                                                                                           | Usage/timing evidence grouped beside prompt context; a clear distinction between recorded and unavailable data |
| [LangWatch](https://github.com/langwatch/langwatch)  | Tracing, evaluation, prompt management and search; trace → dataset → evaluation workflow                                                                                                                                                             | Searchable session history and turn trace, failure filtering and workspace/date scope                          |
| [AgentOps](https://github.com/AgentOps-AI/agentops)  | Agent monitoring, cost tracking and benchmarking                                                                                                                                                                                                     | Explicit execution steps and tool status, with separate credit and token evidence                              |

These products instrument applications directly. Copilot Insights reads Copilot's local files, so it
cannot assume the same completeness, timestamps, span nesting or replay capability.

## Implemented screens

- **Dashboard shell:** constrained reading width, theme-aware surfaces, section descriptions, clearer
  navigation, responsive layouts, keyboard focus and smaller provenance badges.
- **Overview:** prominent sessions/turns, separate today/month cards, quieter telemetry, roomier tables.
- **Sessions:** search, failures, exact workspace and date filters, reset, range validation, pagination.
- **Session explorer:** turn navigation, search across conversation/model/tool/file/error-code fields,
  failure filtering, readable prompt/response panels, expandable tool arguments, context/file source labels,
  prompt composition meters, duration, retries, cache, first-token latency and pre-compaction context.
- **Analytics:** labeled axes/grid, peak usage, day drill-down controls, unavailable-data explanation.

## Further options and their data requirements

| Screen / capability                                            | Data needed before implementation                                                                                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Model-call waterfall with duration bars                        | Reliable start/end timestamps and turn joins for every model round and tool call; aggregate turn timing is insufficient                         |
| Context inspector for system instructions and tool definitions | An explicit content-capture policy for debug prompt artifacts, redaction and clearing coverage; currently only composition telemetry is exposed |
| Tool output viewer                                             | A new capture policy and bounded, redacted output storage; currently tool outputs are deliberately not retained                                 |
| Session comparison with prompt/context diffs                   | Full-capture sessions with comparable tasks; metrics-only sessions cannot support text diffs                                                    |
| Failure investigation grouped by error/tool/model              | Existing error codes can support grouping; attributing a turn failure to a specific tool requires additional evidence                           |
| Bookmarks and local annotations                                | Local annotation storage, export and clearing semantics                                                                                         |
| Saved filter views                                             | Local preferences with clear workspace/date/model scopes                                                                                        |
| Evaluation or prompt playground                                | Outside the current passive observer product; replay would require provider calls and authorization                                             |

## Capture limitations

`metrics` stores no conversation text. `summaries` keeps shortened, redacted prompt/response text.
`full` keeps complete redacted text and tool arguments. The detail query exposes arguments only at `full`
and validates/redacts stored JSON again; exports continue omitting arguments.

Attached local file URI paths are recorded independently from tool-derived activity, with the source
`context:attachment`. A recorded attachment is evidence of a reference, not proof of exact file content
sent to the model. String/image contents and remote resources are ignored. No file contents or tool
outputs are retained. Unknown tool status is displayed as “Status not recorded”. Prompt composition
percentages are Copilot's reported shares, and missing usage is never presented as zero.
