# Copilot on-disk data formats (observed)

Observed on 2026-09-30 with GitHub Copilot Chat `0.66.0` and VS Code `1.138.0` on macOS. These formats are
undocumented and change between releases. Every parser must tolerate missing fields, wrong types, unknown
event kinds, and a truncated last line. When you observe a change, update this file, the fixtures in
`test/fixtures/`, and the drift diagnostics together.

Paths below are relative to the VS Code user-data `User` directory (macOS:
`~/Library/Application Support/Code/User`). With profiles, an extension's `globalStorage` lives under
`User/profiles/<id>/globalStorage/`, while `workspaceStorage` stays under `User/`.

## Where sessions live

| Path                                                                            | Content                                               | Role                                                            |
| ------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| `workspaceStorage/<hash>/chatSessions/<sessionId>.jsonl`                        | Chat session mutation log                             | **Canonical source**                                            |
| `workspaceStorage/<hash>/workspace.json`                                        | `{ "folder": "file:///…" }` or `{ "workspace": "…" }` | Workspace label                                                 |
| `globalStorage/emptyWindowChatSessions/<sessionId>.jsonl`                       | Same format, chats opened with no folder              | Canonical source                                                |
| `workspaceStorage/<hash>/GitHub.copilot-chat/debug-logs/<sessionId>/main.jsonl` | Span events                                           | Enrichment (only when Copilot's agent debug file logging is on) |
| `…/debug-logs/<sessionId>/models.json`                                          | Model catalog with prices                             | Enrichment                                                      |
| `…/debug-logs/<sessionId>/{system_prompt_N,tools_N}.json`                       | Prompt/tool definitions                               | Enrichment (contains prompt content)                            |
| `workspaceStorage/<hash>/GitHub.copilot-chat/transcripts/<sessionId>.jsonl`     | `{type,data,id,timestamp,parentId}` events            | Duplicate of chatSessions — do not index as separate sessions   |

Older VS Code builds wrote `chatSessions/<id>.json` as a single JSON snapshot; treat that as a kind-0 state.

Most chatSessions files are empty (a chat was opened but nothing was sent): 407 of 478 locally. Skip them.

## chatSessions mutation log

Each line is one entry. Replay in order:

| Entry                              | Meaning                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `{"kind":0,"v":{…}}`               | Replace the whole state (initial snapshot).                                          |
| `{"kind":1,"k":["a",0,"b"],"v":…}` | Set the value at key path `k`.                                                       |
| `{"kind":2,"k":[…],"v":[…],"i":n}` | Array at `k`: if `i` is given, truncate to length `i`; then append the items of `v`. |
| `{"kind":3,"k":[…]}`               | Delete at `k` (not observed yet; handled defensively).                               |

Keys come from the file — reject `__proto__`, `constructor`, and `prototype` to prevent prototype pollution.

### Session state (after replay)

`version`, `creationDate` (ms), `initialLocation` (`"panel"`, …), `responderUsername`, `sessionId`,
`customTitle` (Copilot-generated title — treat as content), `hasPendingEdits`, `requests[]`, `pendingRequests`,
`inputState` (draft input — never store).

### Request (one per user turn)

| Field                                       | Type / example                                                                                                                                              | Use                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `requestId`                                 | string                                                                                                                                                      | Turn identity                                                            |
| `timestamp`                                 | number (ms)                                                                                                                                                 | Turn start                                                               |
| `message.text`                              | string                                                                                                                                                      | User prompt (content)                                                    |
| `modelId`                                   | `"copilot/auto"`, `"copilot/<model>"`, `"ollama/Ollama/qwen3.5:35b"`, `"nvidia-nim/NVIDIA NIM/nvidia/nemotron-…"`, `"customendpoint/…"`, `"m365-copilot/…"` | Requested model; prefix = provider (`copilot` = Copilot-hosted)          |
| `modeInfo.kind`                             | `"agent"`, `"ask"`, …                                                                                                                                       | Chat mode                                                                |
| `modelState.value`                          | `0` pending, `1` complete, `2` cancelled, `3` failed (confirmed by cross-tab with `result.errorDetails`)                                                    | Turn state                                                               |
| `modelState.completedAt`                    | ms                                                                                                                                                          | Turn end                                                                 |
| `elapsedMs` / `result.timings.totalElapsed` | number                                                                                                                                                      | Active duration                                                          |
| `timeSpentWaiting`                          | number                                                                                                                                                      | Wait time                                                                |
| `promptTokens`, `completionTokens`          | number                                                                                                                                                      | **Exact** turn usage (same value as `result.metadata.promptTokens`)      |
| `copilotCredits`                            | number, e.g. `1.126141`                                                                                                                                     | **Exact** credits for the turn (only on Copilot-hosted requests)         |
| `promptTokenDetails[]`                      | `{category,label,percentageOfPrompt}` e.g. System Instructions 12, Tool Definitions 40, Messages 35, Files 12                                               | **Exact** context composition                                            |
| `editedFileEvents[]`                        | `{uri:{fsPath,…}, eventKind}`; `1` keep, `2` undo, `3` user modification (VS Code `ChatRequestEditedFileEventKind`)                                         | Outcome of earlier edits                                                 |
| `isSystemInitiated`, `systemInitiatedLabel` | bool, e.g. "`pnpm dev` completed"                                                                                                                           | Not a user prompt                                                        |
| `hiddenFromTranscript`                      | bool                                                                                                                                                        | Hidden turn                                                              |
| `response[]`                                | parts, see below                                                                                                                                            | Assistant output and actions                                             |
| `result.errorDetails`                       | `{code:"failed"\|"unknown"\|…, message, responseIsIncomplete}`                                                                                              | Errors                                                                   |
| `result.metadata.responseId`                | string                                                                                                                                                      | **Join key** to debug-log `llm_request.attrs.responseId` (9/9 matched)   |
| `result.metadata.resolvedModel`             | string                                                                                                                                                      | Actual model                                                             |
| `result.metadata.toolCallRounds[]`          | `{id,timestamp,response,toolInputRetry,toolCalls:[{id,name,arguments(JSON string)}]}`                                                                       | One model round per entry; exact tool calls and arguments                |
| `result.metadata.toolCallResults`           | map id → `{content:[…]}`                                                                                                                                    | Redacted output joined by tool-call-round ID                             |
| `result.metadata.summaries[]`               | `{contextLengthBefore,model,durationMs,outcome,numRounds,…}`                                                                                                | Context compaction events                                                |
| `result.metadata.maxToolCallsExceeded`      | bool                                                                                                                                                        | Agent hit the tool-call limit                                            |
| `variableData.variables[]`                  | attached context                                                                                                                                            | Local paths and enabled file/promptFile/implicit string values, redacted |

Other observed request keys (ignored for now): `responseId`, `contentReferences`, `codeCitations`, `agent`,
`followups`, `outputBuffer`, `responseMarkdownInfo`, `responseTimestamp`, `confirmation`, `terminalExecutionId`.

### Response parts (`request.response[]`)

| `kind`                                                                                                                                  | Shape                                                                                                                                          | Use                                              |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| _(none)_                                                                                                                                | `{value: string, …}` markdown                                                                                                                  | Assistant text                                   |
| `autoModeResolution`                                                                                                                    | `{resolved:{id:"gpt-5.6-luna", name:"GPT-5.6 Luna"}}`                                                                                          | **Exact** Auto → model routing                   |
| `thinking`                                                                                                                              | `{value, id, reasoningDurationMs}`                                                                                                             | Reasoning blocks and time                        |
| `toolInvocationSerialized`                                                                                                              | `{toolId:"copilot_readFile", toolCallId, isComplete, isConfirmed:{type}, invocationMessage:{value, uris:{"file:///…":{…}}}, pastTenseMessage}` | Tool UI record; `uris` are exact file references |
| `textEditGroup`                                                                                                                         | `{uri:{fsPath,…}, edits:[[…]], done}`                                                                                                          | Exact file edit                                  |
| `codeblockUri`                                                                                                                          | `{uri, isEdit}`                                                                                                                                | Edit target                                      |
| `inlineReference`, `undoStop`, `mcpServersStarting`, `progressTaskSerialized`, `elicitationSerialized`, `workspaceEdit`, `confirmation` | —                                                                                                                                              | Known, not used yet                              |

**Tool ids do not join:** `toolCallRounds[].toolCalls[].id` never equals
`toolInvocationSerialized.toolCallId` (0 of 6,672 matched). Treat `toolCallRounds` as the tool-call list when
present, and invocation parts only as file evidence.

### What TraceOn derives from `textEditGroup` and terminal tool calls

`textEditGroup.edits` is a list of edit groups, each a list of `{text, range}`; only `text` is read, and only to
hash it: every line of the inserted text with at least 20 non-space characters is reduced to
`SHA-256(salt \0 line)` truncated to 16 hex characters (at most 200 per edit, per file, per turn). The salt is
random per install (`meta` key `privacy.salt`). The text itself is never stored. Terminal tool calls
(`run_in_terminal`-style names) contribute a salted hash of the secret-redacted, whitespace-collapsed
`arguments.command`, used to match them to commands VS Code observed. Both are dropped at capture level `metrics`.

### Live observation tables (written by the extension host, not parsed from Copilot files)

| Table                                  | Holds                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `git_snapshots`, `git_snapshot_files`  | HEAD and per-file added/removed line counts of the working tree, first and latest observation        |
| `diag_snapshots`, `diag_snapshot_meta` | error/warning counts per file at first and latest observation (`meta` marks an empty snapshot)       |
| `terminal_runs`                        | end/start time, exit code, kind (test/build/lint/other) and salted command hash                      |
| `survival_checks`                      | per edit (session, turn, file): how many fingerprinted lines were present at +1h / +1d / next commit |
| `session_commits`                      | commits that touched files a session edited, with overlap counts                                     |

At capture level `metrics` a terminal run keeps only its exit code and timing (no kind, empty hash); lowering the
level to `metrics` or clearing all conversation text blanks the hashes already stored.

Rule: **no text — only counts, paths, hashes, exit codes and timestamps.** These tables have no foreign key to
`sessions` (a rescan replaces the session row), so clear, retention and capture-level changes delete them
explicitly.

## Debug log (`debug-logs/<sessionId>/main.jsonl`)

Span events: `{v?, ts, dur, sid, type, name, spanId, parentSpanId?, status, attrs}`.

| `type`                    | Notable `attrs`                                                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_start`           | `copilotVersion`, `vscodeVersion`                                                                                                                                                                                                 |
| `user_message`            | `content` (prompt)                                                                                                                                                                                                                |
| `turn_start` / `turn_end` | `turnId` (these are model-loop iterations, not user turns)                                                                                                                                                                        |
| `llm_request`             | `model`, `debugName` (e.g. `panel/editAgent`), `inputTokens`, `outputTokens`, `cachedTokens`, `ttft`, `responseId`, `copilotUsageNanoAiu`, `maxTokens`, `userRequest`, `inputMessages` (content), `systemPromptFile`, `toolsFile` |
| `tool_call`               | `args` (JSON string), `result`                                                                                                                                                                                                    |
| `agent_response`          | `response`, `reasoning` (`"[encrypted]"`)                                                                                                                                                                                         |
| `discovery`, `generic`    | `details`, `category` (e.g. custom-instructions files included)                                                                                                                                                                   |

### Prompt files next to `main.jsonl`

`llm_request.attrs.toolsFile` and `systemPromptFile` name files in the same folder (`tools_0.json`,
`system_prompt_0.json`; only plain file names are honoured). Both are `{content: …}`: for tools, `content` is a JSON
**string** holding `[{type, name, description, parameters}, …]`; for the system prompt it is the text. Copilot
Insights keeps each tool's name, definition size and redacted definition (`llm_tool_defs`), plus the
character count and redacted text of the system prompt (`llm_prompt_files`). These are latest recorded
session artifacts; per-request associations are unavailable. Files over 5 MB are
ignored. Tokens are estimated as characters ÷ 4 and always labelled `inferred`.

`models.json` entries: `id`, `name`, `vendor`, `version`, `capabilities.family`, `capabilities.limits.*`,
`billing.token_prices.{default,long_context}.{input_price,output_price,cache_read_price,cache_write_price,…}`,
`billing.restricted_to`, `model_picker_category` (e.g. `powerful`), `model_picker_price_category`,
`is_chat_default`.

## Local observations that shape the product

- 312 requests across 71 non-empty sessions; 70 of them failed (`modelState` 3). Failure analytics matter.
- Only 5 requests used Copilot-hosted models; the rest used bring-your-own-key or local providers
  (`nvidia-nim`, `ollama`, `customendpoint`, `omlx`, `m365-copilot`), which cost no Copilot credits.
- Debug logs existed for 81 sessions but held only 9 `llm_request` events: they are sparse enrichment, not a
  primary source.

## Attached context path capture (2026-10-01)

`variableData.variables[]` is parsed conservatively using VS Code's
[`chatVariableEntries.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/attachments/chatVariableEntries.ts)
URI / Location shapes. File, directory, enabled implicit, and prompt-file entries with a `file` URI are
recorded as file events with source `context:attachment`. Location values use `value.uri`; direct URI
values use `value`. Supported enabled file, prompt-file and implicit string values are recorded separately as context snapshots. Images, remote URIs and disabled implicit entries are ignored.
Recorded names and supported context string values are retained with secrets redacted; tool results are joined by round call IDs. Complete assembled model context is not reconstructed. These are recorded
references, not proof of which file bytes reached a model. Ingest version 8 reparses retained sessions so
existing files can gain this metadata without a manual index rebuild.

New sessions always use full local capture; there is no configuration setting or worker input for lower
capture levels. Ingest version 8 upgrades legacy summary indexes by rereading available sources.
Explicitly cleared sessions remain content-free. Legacy capture metadata is still readable, and the
session-detail query validates/redacts argument JSON again before returning it to the webview.
