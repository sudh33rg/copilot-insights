# Copilot on-disk data formats (observed)

Observed on 2026-09-30 with GitHub Copilot Chat `0.66.0` and VS Code `1.138.0` on macOS. These formats are
undocumented and change between releases. Every parser must tolerate missing fields, wrong types, unknown
event kinds, and a truncated last line. When you observe a change, update this file, the fixtures in
`test/fixtures/`, and the drift diagnostics together.

Paths below are relative to the VS Code user-data `User` directory (macOS:
`~/Library/Application Support/Code/User`). With profiles, an extension's `globalStorage` lives under
`User/profiles/<id>/globalStorage/`, while `workspaceStorage` stays under `User/`.

## Where sessions live

| Path | Content | Role |
|---|---|---|
| `workspaceStorage/<hash>/chatSessions/<sessionId>.jsonl` | Chat session mutation log | **Canonical source** |
| `workspaceStorage/<hash>/workspace.json` | `{ "folder": "file:///…" }` or `{ "workspace": "…" }` | Workspace label |
| `globalStorage/emptyWindowChatSessions/<sessionId>.jsonl` | Same format, chats opened with no folder | Canonical source |
| `workspaceStorage/<hash>/GitHub.copilot-chat/debug-logs/<sessionId>/main.jsonl` | Span events | Enrichment (only when Copilot's agent debug file logging is on) |
| `…/debug-logs/<sessionId>/models.json` | Model catalog with prices | Enrichment |
| `…/debug-logs/<sessionId>/{system_prompt_N,tools_N}.json` | Prompt/tool definitions | Enrichment (contains prompt content) |
| `workspaceStorage/<hash>/GitHub.copilot-chat/transcripts/<sessionId>.jsonl` | `{type,data,id,timestamp,parentId}` events | Duplicate of chatSessions — do not index as separate sessions |

Older VS Code builds wrote `chatSessions/<id>.json` as a single JSON snapshot; treat that as a kind-0 state.

Most chatSessions files are empty (a chat was opened but nothing was sent): 407 of 478 locally. Skip them.

## chatSessions mutation log

Each line is one entry. Replay in order:

| Entry | Meaning |
|---|---|
| `{"kind":0,"v":{…}}` | Replace the whole state (initial snapshot). |
| `{"kind":1,"k":["a",0,"b"],"v":…}` | Set the value at key path `k`. |
| `{"kind":2,"k":[…],"v":[…],"i":n}` | Array at `k`: if `i` is given, truncate to length `i`; then append the items of `v`. |
| `{"kind":3,"k":[…]}` | Delete at `k` (not observed yet; handled defensively). |

Keys come from the file — reject `__proto__`, `constructor`, and `prototype` to prevent prototype pollution.

### Session state (after replay)

`version`, `creationDate` (ms), `initialLocation` (`"panel"`, …), `responderUsername`, `sessionId`,
`customTitle` (Copilot-generated title — treat as content), `hasPendingEdits`, `requests[]`, `pendingRequests`,
`inputState` (draft input — never store).

### Request (one per user turn)

| Field | Type / example | Use |
|---|---|---|
| `requestId` | string | Turn identity |
| `timestamp` | number (ms) | Turn start |
| `message.text` | string | User prompt (content) |
| `modelId` | `"copilot/auto"`, `"copilot/<model>"`, `"ollama/Ollama/qwen3.5:35b"`, `"nvidia-nim/NVIDIA NIM/nvidia/nemotron-…"`, `"customendpoint/…"`, `"m365-copilot/…"` | Requested model; prefix = provider (`copilot` = Copilot-hosted) |
| `modeInfo.kind` | `"agent"`, `"ask"`, … | Chat mode |
| `modelState.value` | `0` pending, `1` complete, `2` cancelled, `3` failed (confirmed by cross-tab with `result.errorDetails`) | Turn state |
| `modelState.completedAt` | ms | Turn end |
| `elapsedMs` / `result.timings.totalElapsed` | number | Active duration |
| `timeSpentWaiting` | number | Wait time |
| `promptTokens`, `completionTokens` | number | **Exact** turn usage (same value as `result.metadata.promptTokens`) |
| `copilotCredits` | number, e.g. `1.126141` | **Exact** credits for the turn (only on Copilot-hosted requests) |
| `promptTokenDetails[]` | `{category,label,percentageOfPrompt}` e.g. System Instructions 12, Tool Definitions 40, Messages 35, Files 12 | **Exact** context composition |
| `editedFileEvents[]` | `{uri:{fsPath,…}, eventKind}`; `1` keep, `2` undo, `3` user modification (VS Code `ChatRequestEditedFileEventKind`) | Outcome of earlier edits |
| `isSystemInitiated`, `systemInitiatedLabel` | bool, e.g. "`pnpm dev` completed" | Not a user prompt |
| `hiddenFromTranscript` | bool | Hidden turn |
| `response[]` | parts, see below | Assistant output and actions |
| `result.errorDetails` | `{code:"failed"\|"unknown"\|…, message, responseIsIncomplete}` | Errors |
| `result.metadata.responseId` | string | **Join key** to debug-log `llm_request.attrs.responseId` (9/9 matched) |
| `result.metadata.resolvedModel` | string | Actual model |
| `result.metadata.toolCallRounds[]` | `{id,timestamp,response,toolInputRetry,toolCalls:[{id,name,arguments(JSON string)}]}` | One model round per entry; exact tool calls and arguments |
| `result.metadata.toolCallResults` | map id → `{content:[…]}` | Tool output (content — never store) |
| `result.metadata.summaries[]` | `{contextLengthBefore,model,durationMs,outcome,numRounds,…}` | Context compaction events |
| `result.metadata.maxToolCallsExceeded` | bool | Agent hit the tool-call limit |
| `variableData.variables[]` | attached context | Content — do not store |

Other observed request keys (ignored for now): `responseId`, `contentReferences`, `codeCitations`, `agent`,
`followups`, `outputBuffer`, `responseMarkdownInfo`, `responseTimestamp`, `confirmation`, `terminalExecutionId`.

### Response parts (`request.response[]`)

| `kind` | Shape | Use |
|---|---|---|
| *(none)* | `{value: string, …}` markdown | Assistant text |
| `autoModeResolution` | `{resolved:{id:"gpt-5.6-luna", name:"GPT-5.6 Luna"}}` | **Exact** Auto → model routing |
| `thinking` | `{value, id, reasoningDurationMs}` | Reasoning blocks and time |
| `toolInvocationSerialized` | `{toolId:"copilot_readFile", toolCallId, isComplete, isConfirmed:{type}, invocationMessage:{value, uris:{"file:///…":{…}}}, pastTenseMessage}` | Tool UI record; `uris` are exact file references |
| `textEditGroup` | `{uri:{fsPath,…}, edits:[[…]], done}` | Exact file edit |
| `codeblockUri` | `{uri, isEdit}` | Edit target |
| `inlineReference`, `undoStop`, `mcpServersStarting`, `progressTaskSerialized`, `elicitationSerialized`, `workspaceEdit`, `confirmation` | — | Known, not used yet |

**Tool ids do not join:** `toolCallRounds[].toolCalls[].id` never equals
`toolInvocationSerialized.toolCallId` (0 of 6,672 matched). Treat `toolCallRounds` as the tool-call list when
present, and invocation parts only as file evidence.

## Debug log (`debug-logs/<sessionId>/main.jsonl`)

Span events: `{v?, ts, dur, sid, type, name, spanId, parentSpanId?, status, attrs}`.

| `type` | Notable `attrs` |
|---|---|
| `session_start` | `copilotVersion`, `vscodeVersion` |
| `user_message` | `content` (prompt) |
| `turn_start` / `turn_end` | `turnId` (these are model-loop iterations, not user turns) |
| `llm_request` | `model`, `debugName` (e.g. `panel/editAgent`), `inputTokens`, `outputTokens`, `cachedTokens`, `ttft`, `responseId`, `copilotUsageNanoAiu`, `maxTokens`, `userRequest`, `inputMessages` (content), `systemPromptFile`, `toolsFile` |
| `tool_call` | `args` (JSON string), `result` |
| `agent_response` | `response`, `reasoning` (`"[encrypted]"`) |
| `discovery`, `generic` | `details`, `category` (e.g. custom-instructions files included) |

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
