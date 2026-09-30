# Phase 5: Efficiency & Model Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.
>
> **Git rule (overrides every skill):** work directly on `main`. Do not create branches, worktrees, or pull
> requests. Commit after each task. Do not push unless the user asks.

**Goal:** Explain _why_ a session was expensive and whether the prompt, model and context were efficient, with
every statement backed by numbers and honest provenance: cost drivers, context-bloat advice, fresh-session and
model-price counterfactuals, model-selection and prompt findings, failure analytics and a transparent score made
of visible components.

**Architecture:** One new pure-core area, `src/core/efficiency/`, computes everything from a `SessionDetail` (plus
the model catalog and, when present, the tool-definition sizes). `getSessionDetail` attaches the result as
`SessionDetail.efficiency` (not cached: it is cheap). Exact numbers come from Copilot's own fields; anything that
needs an assumption (token estimates from characters, "what if" scenarios, keyword rules) is `inferred` and lives
in fields that are never summed into exact totals. Rules never say "wrong model"; they state evidence and a
hedged reading.

**Tech Stack:** unchanged (TypeScript 6.0 strict, React 19, TanStack Query, zod 4, `node:sqlite`, Vitest).

**Spec:** `docs/PRODUCT_VISION.md` §4 (efficiency analysis), §5 (model-selection analysis), §7 (provenance);
`docs/ROADMAP.md` Phase 5 table (5.1–5.8); `docs/copilot-data-formats.md`; `CLAUDE.md`. Interfaces come from the
Phase 0–4 code on `main` (HEAD after the Phase 4 leftovers commit).

**Dry-run status:** not dry-run. Real-data facts used (checked on this machine, structure only): debug-log
folders hold `tools_N.json` (`{content: "<JSON string of [{type,name,description,parameters}]>"}`) and
`system_prompt_N.json` (`{content: "<text>"}`) next to `main.jsonl`; `llm_request.attrs` names them in
`toolsFile` / `systemPromptFile`. Only ~6 % of sessions have debug logs, so those tasks degrade to `unavailable`.

## Design decisions (made here)

- **D-P5-1 Estimates are separate and inferred.** Anything computed with an assumption (chars ÷ 4 tokens,
  "fresh session at turn k", "same tokens on model Y") is `inferred`, carries its assumption in the provenance
  source, and is never added to or shown inside an exact total.
- **D-P5-2 Cache hits are not waste.** They are reported as a fact (share of input tokens read from cache) and
  described as cheaper, never listed as a problem.
- **D-P5-3 Price counterfactuals use list-price ratios, not credits.** The catalog gives per-token list prices;
  how they map to Copilot credits is not documented, so the output is a relative cost index (`0.4×` the list
  cost of what actually ran), never a credit figure.
- **D-P5-4 Tool and prompt file contents are never stored.** Only tool names, per-tool character counts and the
  character size of the system prompt are kept (tables `llm_tool_defs`, `llm_prompt_files`). Instruction-file
  contents are free text in `discovery` events and are deliberately not parsed; the system-prompt size covers
  their cost.
- **D-P5-5 A score is its components.** The efficiency score is a band derived from visible components; with
  fewer than three components with evidence it is `unavailable`. No 0–100 number is shown as a headline.

## Global Constraints

- Work on `main` only; one Conventional Commit per task; never push without being asked.
- Before every commit: `pnpm format && pnpm verify` must pass. Run `pnpm test:integration` after Task 5.2 (new
  ingestion) and Task 5.8, and `pnpm smoke:real` after Tasks 5.2 and 5.8.
- Layering (ESLint-enforced): `shared` → nothing environment-specific; `core` → `node:*`, `zod`, `shared`;
  `extension` → `vscode`, `core`, `shared`; `webview` → `react`, browser, `shared`.
- TDD: failing test first, watch it fail (never write test and implementation in one step), implement, pass.
- Never log, print, or store prompt/response/code text; fixtures are synthetic; use `SECRET-…` sentinels when a
  test feeds content through ingestion and assert they never reach the database.
- Every user-visible number is a `Measured<T>`; update `ALLOWED` in `src/shared/dto.provenance.test.ts` only for
  genuine index facts (ordinals, timestamps, row counts). Measured numbers inside new DTOs must use
  `measuredNumber`.
- Migrations are append-only: Phase 4 ended at `user_version` 8 (indexes 0–7); this phase adds index 8. Bump
  `INGEST_VERSION` (→ 4) in Task 5.2 so debug logs are re-read once.
- Each finding has a stable `id`, a message that names a hedged reading ("likely", "may"), an `evidence` string with
  the concrete numbers, and a provenance.

## Review Focus

1. **Session with no debug log** → cost drivers that need cached tokens, tool definitions or system prompt
   are omitted, never shown as zero (Tasks 5.1, 5.2).
2. **One-turn or tiny session** → no growth ratio, no counterfactual, no "long session" advice; no division by
   zero anywhere (5.1, 5.3, 5.8).
3. **Model missing from the catalog or without prices** (BYOK/local) → price counterfactual and price-rank rules
   are skipped, not guessed (5.4, 5.5).
4. **Prompt text absent** (`metrics` capture) → text-based findings and corrections are skipped; turn-state-based
   ones still work (5.5, 5.6).
5. **Everything healthy** → no findings, score band shown with its components; no "all good!" invented praise and
   no empty-list crashes in the UI (5.5, 5.6, 5.8).

---

## File Structure

| File                                                                              | Responsibility                                                              |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/shared/dto.ts` (modify)                                                      | `TurnDetail` extras, `efficiencySchema`, `failureAnalyticsSchema`           |
| `src/core/efficiency/types.ts`                                                    | `EfficiencyInput`, `Finding`, `CostDriver` shared types                     |
| `src/core/efficiency/costDrivers.ts` (+test)                                      | 5.1 evidence list from exact data                                           |
| `src/core/efficiency/contextBloat.ts` (+test)                                     | 5.2 unused tool definitions, system-prompt cost                             |
| `src/core/efficiency/freshSession.ts` (+test)                                     | 5.3 restart counterfactual                                                  |
| `src/core/efficiency/priceCounterfactual.ts` (+test)                              | 5.4 list-price ratios                                                       |
| `src/core/efficiency/modelFindings.ts` (+test)                                    | 5.5 oversized / undersized / over-routing / high reasoning                  |
| `src/core/analysis/findings.ts` (modify, +test)                                   | 5.6 prompt findings v2                                                      |
| `src/core/efficiency/score.ts` (+test)                                            | 5.8 components → band                                                       |
| `src/core/query/sessionEfficiency.ts` (+test)                                     | assemble `SessionDetail.efficiency` from the pieces                         |
| `src/core/query/failureAnalytics.ts` (+test)                                      | 5.7                                                                         |
| `src/core/debuglog/*`, `src/core/storage/llmCallStore.ts` (modify)                | 5.2 read tool/system-prompt file sizes                                      |
| `src/webview/views/EfficiencyCard.tsx`, `FailureAnalyticsCard.tsx` (+tests)       | UI                                                                          |

---

### Task 5.1: Cost drivers v2

**Files:**

- Create: `src/core/efficiency/types.ts`, `src/core/efficiency/costDrivers.ts`, `costDrivers.test.ts`,
  `src/core/query/sessionEfficiency.ts`, `sessionEfficiency.test.ts`, `src/webview/views/EfficiencyCard.tsx`,
  `EfficiencyCard.test.tsx`
- Modify: `src/shared/dto.ts`, `src/core/query/sessionDetail.ts`, `src/core/query/turnExtras.ts` (new helper if
  needed), `src/webview/views/SessionDetailView.tsx`, `src/webview/test/dtoFixtures.ts`,
  `test/fixtures/turns.ts`, `src/shared/dto.provenance.test.ts`

**Interfaces:**

- Produces (`types.ts`):

```ts
import type { Provenance } from '../../shared/provenance';
export interface CostDriver {
  id: string;
  title: string;
  evidence: string;
  provenance: Provenance;
}
export interface Finding {
  id: string;
  message: string;
  evidence: string;
  provenance: Provenance;
}
```

- Produces (DTO): `TurnDetail` gains
  `promptComposition: { category: string; label: string; share: MeasuredNumber }[]` (share 0–1),
  `toolInputRetries: MeasuredNumber`, `contextTokensBefore: MeasuredNumber` (largest `contextLengthBefore` of the
  turn's compactions, unavailable when none). `SessionDetail` gains
  `efficiency: efficiencySchema` with (this task) `drivers: z.array(costDriverSchema)`; later tasks extend it.
- Produces: `costDrivers(turns: readonly TurnDetail[]): CostDriver[]`.

Rules (each returns nothing when its evidence is missing; `userTurns` = non-system-initiated turns;
`requests` = all turns):

1. `context-growth` — needs ≥ 3 turns with exact `inputTokens` and first/last ratio ≥ 1.5:
   evidence `context grew 2.8× (24,000 input tokens on turn 1 → 67,200 on turn 6)`; provenance
   `derived`, source `ratio of exact input tokens, first to last turn`.
2. `cache` — needs at least one turn with `cachedTokens` and input tokens; sum over turns that have both:
   evidence `121,000 of 184,212 input tokens were read from the prompt cache (cache hits are cheaper, not waste)`;
   when only some turns had cache data append `; 3 of 5 turns reported it` and use a `lower bound` source.
   Provenance `derived`, source `agent debug log cachedTokens ÷ chatSessions.promptTokens`.
3. `composition` — needs ≥ 1 turn with a non-empty `promptComposition`; weight each turn's shares by its input
   tokens; evidence `on average tool definitions were 34% of the prompt, files 21%, messages 12%` (top three
   categories by weight, labels from `label` falling back to `category`). Provenance `derived`, source
   `chatSessions promptTokenDetails weighted by input tokens`.
4. `rounds` — total `toolRounds` ≥ 10 or total `toolInputRetries` ≥ 1: evidence
   `19 tool rounds across 6 turns, 3 tool-input retries`. Provenance `exact`, source `chatSessions toolCallRounds`.
5. `compactions` — total compactions ≥ 1: evidence `context was compacted 2 times (largest context before: 91,000 tokens)`
   (omit the parenthesis when unavailable). Provenance `exact`.
6. `failed-work` — failed user turns ≥ 1 with known input tokens: evidence
   `2 failed turns consumed 48,000 input tokens`. Provenance `exact`, source `chatSessions turn state and promptTokens`.

- [ ] **Step 1: Failing tests** `costDrivers.test.ts` with a local `t(index, overrides)` helper building
      `makeTurn` turns (import `makeTurn` from `test/fixtures/turns.ts`; extend it in this task with the three new
      `TurnDetail` fields defaulting to `unavailable`/`[]`). One test per rule for the positive case with the exact
      evidence strings above, plus:
  - no debug data → no `cache` driver and no driver whose evidence contains `0`;
  - a 2-turn session → no `context-growth`;
  - `promptComposition` with an unknown label falls back to the category name;
  - `cache` partial data → evidence contains `3 of 5 turns reported it` and provenance source contains
    `lower bound`;
  - an empty `turns` array returns `[]`.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** `types.ts` and `costDrivers.ts` (pure; `formatInt` is not
      available in core, use `value.toLocaleString('en-US')`).

- [ ] **Step 4: DTO + extraction.** In `dto.ts`: add `costDriverSchema = z.object({id, title, evidence, provenance: provenanceSchema})`,
      `efficiencySchema = z.object({ drivers: z.array(costDriverSchema) })`, the three `TurnDetail` fields and
      `efficiency: efficiencySchema` on `sessionDetailSchema`. In `sessionDetail.ts` select
      `prompt_composition, tool_input_retries` (already columns) and derive `contextTokensBefore` from the
      `compactions` JSON (`contextLengthBefore`), `promptComposition` from the JSON (`percent` ÷ 100 →
      `exact`, source `chatSessions promptTokenDetails`; drop entries with null percent). Update every
      `TurnDetail`/`SessionDetail` literal (`pnpm typecheck` lists them).

- [ ] **Step 5: `getSessionEfficiency`.** `sessionEfficiency.ts`:
      `getSessionEfficiency(turns: readonly TurnDetail[]): Efficiency` → `{ drivers: costDrivers(turns) }`; call it
      from `getSessionDetail` (`efficiency: getSessionEfficiency(turns)`). Test in `sessionEfficiency.test.ts`
      with `seededStore()` (`getSessionDetail(database, 'fx-auto-1').efficiency.drivers` contains `rounds` or is an
      array — assert `Array.isArray` and that no driver has an empty evidence).

- [ ] **Step 6: UI.** `EfficiencyCard.tsx` (`<section className="card" aria-label="Efficiency">`, heading
      `Why it cost what it did`, `<ul className="findings">` of drivers: `<strong>{title}</strong>
      <ProvenanceBadge/>` and `<div className="muted">{evidence}</div>`; when `drivers.length === 0` show
      `No cost drivers stood out for this session.`). Render it in `SessionDetailView` after `OutcomeCard`. Test
      with fixtures: lists titles/evidence/badges; empty state text; evidence rendered as plain text.

- [ ] **Step 7:** `pnpm format && pnpm verify` → PASS. **Step 8: Commit**

```bash
git add -A
git commit -m "feat(efficiency): explain session cost with evidence-backed cost drivers"
```

---

### Task 5.2: Tool-definition and system-prompt cost, context-bloat advice

**Files:**

- Create: `src/core/debuglog/promptFiles.ts` (+test), `src/core/efficiency/contextBloat.ts` (+test)
- Modify: `src/core/debuglog/parseDebugLog.ts`, `src/core/debuglog/*` scan code, `src/core/storage/migrations.ts`,
  `src/core/storage/llmCallStore.ts` (+test), `src/core/ingest/ingestService.ts` (`INGEST_VERSION = 4`),
  `src/core/storage/sessionStore.ts`/`clearService` cleanup, `src/core/query/sessionEfficiency.ts`,
  `src/shared/dto.ts`, `docs/copilot-data-formats.md`

**Interfaces:**

- Produces (`promptFiles.ts`):
  `parseToolDefs(fileText: string): { name: string; chars: number }[] | null` (null when the file is not the
  documented `{content: "<json array>"}` shape; chars = length of the JSON of that tool),
  `parsePromptFileChars(fileText: string): number | null` (length of `content` when it is a string).
- Produces (`contextBloat.ts`):

```ts
export interface BloatInput {
  toolDefs: { name: string; chars: number }[] | null;
  systemPromptChars: number | null;
  usedToolNames: ReadonlySet<string>;
  requests: number; // LLM requests in the session (turns with a debug-log call, else turns)
}
export function contextBloat(input: BloatInput): Finding[];
export const CHARS_PER_TOKEN = 4;
```

- Table (migration index 8): `llm_tool_defs(session_id TEXT, name TEXT, chars INTEGER, PRIMARY KEY(session_id,name))`,
  `llm_prompt_files(session_id TEXT PRIMARY KEY, system_prompt_chars INTEGER, tool_defs_chars INTEGER)`; no FK to
  `sessions` (debug logs can exist without a session row); cleaned by `deleteSessions`/`clear`/`purgeBefore`
  next to `llm_calls`.

Rules (all `inferred`, source `characters ÷ 4 as a token estimate; sent on every request`):

- `unused-tools` — `toolDefs` present, ≥ 5 defined tools and ≥ 50 % never called in the session:
  evidence `31 of 47 tool definitions were never called; about 9,400 tokens of definitions were sent with each of
  11 requests (≈ 103,400 tokens)`; message
  `Tools you do not use still cost tokens on every request. Disabling unused tools or MCP servers may reduce cost.`
- `system-prompt` — `systemPromptChars` ≥ 20,000: evidence
  `the system prompt is 46,352 characters (about 11,600 tokens) and was sent with each of 11 requests`;
  message `A large system prompt (instructions, custom instruction files) is paid for on every request.`

- [ ] **Step 1: Failing tests** `promptFiles.test.ts`: a synthetic tools file
      `JSON.stringify({content: JSON.stringify([{type:'function',name:'read_file',description:'x'.repeat(50),parameters:{}}, …])})`
      → names and positive `chars`; `{content: 5}` → `null`; invalid JSON → `null`; `parsePromptFileChars`
      of `{content:'abc'}` → `3`, of an array → `null`. `contextBloat.test.ts`: both findings with the exact
      evidence strings above (construct inputs that produce them: 47 tools, 16 used, 37,600 chars of definitions
      → adjust numbers in the test to what the formula yields and assert the strings from the formula);
      `toolDefs: null` and `systemPromptChars: null` → `[]`; 3 defined tools → no `unused-tools`; sentinel text
      never appears (`JSON.stringify(result)` has no `SECRET` when a tool name is `SECRET-tool`? — tool names are
      allowed; instead assert descriptions are not in the output).

- [ ] **Step 2: Run → FAIL. Step 3: Implement** both modules.

- [ ] **Step 4: Ingestion.** Read how `parseDebugLog` and the debug scan (`src/core/debuglog/`, `scanAll.ts`,
      `scanner`) find `main.jsonl`; extend the parser to also return `files: { toolsFile: string | null; systemPromptFile: string | null }`
      taken from the last `llm_request` event's `attrs.toolsFile` / `attrs.systemPromptFile` (basename only, no
      path separators; ignore anything else — path traversal guard). In the debug scan, after parsing a session,
      read `<dir>/<toolsFile>` and `<dir>/<systemPromptFile>` if they exist (≤ 5 MB each), reduce them with
      `promptFiles.ts` and put only `{ toolDefs, systemPromptChars }` on the scan result; never the text.
      Add migration index 8 and `LlmCallStore.replaceSession` (or a sibling `PromptFileStore`) writing the two
      tables; add `getToolDefs(sessionId)` / `getPromptFiles(sessionId)`. Failing tests first in
      `llmCallStore.test.ts`: round trip, replace semantics, deletion with `deleteSessions`, and a SECRET sentinel in
      the tools file description is not found in `llm_tool_defs` JSON. Bump `INGEST_VERSION` to 4.

- [ ] **Step 5: Wire.** `getSessionEfficiency` gains the session's tool defs/system prompt/used tool names
      (tool names from `tool_calls`; `requests` = count of `llm_calls` rows for non-internal roles, else turn
      count) and adds `contextBloat(...)` findings to `efficiency.findings: z.array(findingSchema)` (DTO
      `findingSchema = {id, message, evidence, provenance}`). Change its signature to
      `getSessionEfficiency(database, turns, sessionId)`. Test with a seeded session + inserted tool defs.

- [ ] **Step 6: UI.** `EfficiencyCard` also lists `findings` under `Context and model advice` (same list markup
      as analysis findings, badge per finding). Test: a finding renders message, evidence and badge.

- [ ] **Step 7: Docs.** `copilot-data-formats.md`: document `tools_N.json` / `system_prompt_N.json` shapes and
      that only names and character counts are stored.

- [ ] **Step 8:** `pnpm format && pnpm verify && pnpm test:integration && pnpm smoke:real` → PASS (smoke still
      reports all requests became turns). **Step 9: Commit**

```bash
git add -A
git commit -m "feat(efficiency): measure tool-definition and system-prompt cost and advise on context bloat"
```

---

### Task 5.3: Fresh-session counterfactual

**Files:**

- Create: `src/core/efficiency/freshSession.ts`, `freshSession.test.ts`
- Modify: `src/core/query/sessionEfficiency.ts`, `src/shared/dto.ts`, `src/webview/views/EfficiencyCard.tsx`

**Interfaces:**

- Produces:

```ts
export interface FreshSessionEstimate {
  restartAtTurn: number;       // turn index where a fresh session would have started
  tokensSaved: number;         // estimated input tokens not sent
  shareOfInput: number;        // tokensSaved ÷ total input tokens of the session (0–1)
}
export function freshSessionEstimate(turns: readonly { index: number; inputTokens: number | null; systemInitiated: boolean }[]): FreshSessionEstimate | null;
```

Model (state it in the provenance source): the first user turn's input tokens approximate the fixed baseline
(system prompt, tool definitions, first message). A session restarted at turn `k` would have paid
`baseline + (input_i − input_k)` for every later turn `i ≥ k`, so it saves `input_k − baseline` per turn from `k`
on. Choose the `k` (2 ≤ k ≤ last turn, user-initiated, known input) maximizing the total
`(turnsFromKOn) × (input_k − baseline)`, only counting positive values. Return `null` when fewer than 4 turns
have known input, when the best saving is < 20 % of the session's total input tokens, or when no `k` yields a
positive saving. Ignores cache discounts (stated).

- DTO: `efficiency.freshSession: z.object({ restartAtTurn: z.number(), tokensSaved: measuredNumber, shareOfInput: measuredNumber }).nullable()`
  — `restartAtTurn` is a turn ordinal (add to `ALLOWED`: `efficiency.freshSession.restartAtTurn`);
  `tokensSaved`/`shareOfInput` are `inferred`, source
  `estimate: a fresh session would resend the first request's baseline instead of the accumulated context; ignores prompt-cache discounts`.

- [ ] **Step 1: Failing tests:** steady growth (input 10K,20K,30K,40K,50K,60K: baseline 10K; k=3 → 5 turns... compute
      expected from the formula and assert the exact `restartAtTurn`/`tokensSaved`); flat session (all 10K) →
      `null`; fewer than 4 known turns → `null`; unknown-input turns are skipped; saving under 20 % → `null`;
      system-initiated turns are never chosen as `k`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: DTO + `getSessionEfficiency` wiring + provenance
      `ALLOWED` entry. Step 5: UI** — a line under the drivers: `Restarting in a fresh session at turn 4 would
      have saved an estimated 120,000 input tokens (63% of this session's input).` with the Inferred badge and a
      muted note `Estimate, not part of the exact totals above.`; test that the note and badge render and that no
      line renders for `null`.
- [ ] **Step 6:** `pnpm format && pnpm verify` → PASS. **Step 7: Commit**

```bash
git add -A
git commit -m "feat(efficiency): estimate what a fresh session would have saved, labelled inferred"
```

---

### Task 5.4: Model price counterfactual

**Files:**

- Create: `src/core/efficiency/priceCounterfactual.ts`, `priceCounterfactual.test.ts`
- Modify: `src/core/query/sessionEfficiency.ts`, `src/shared/dto.ts`, `src/webview/views/EfficiencyCard.tsx`

**Interfaces:**

- Consumes: the `models` table (columns `id, name, input_price, output_price, cache_read_price, price_batch_size`;
  read via `CatalogStore` — inspect `src/core/storage/catalogStore.ts` for the exact accessor; add
  `CatalogStore.prices(): ModelPrice[]` if absent).
- Produces:

```ts
export interface ModelPrice { id: string; name: string | null; inputPrice: number; outputPrice: number; cacheReadPrice: number | null; batchSize: number }
export interface TokenUse { input: number; output: number; cached: number }
export const listCost = (use: TokenUse, price: ModelPrice): number; // (input−cached)×in + cached×(cacheRead ?? in) + output×out, all ÷ batchSize
export function priceCounterfactual(input: {
  turns: readonly { model: string | null; inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null }[];
  prices: readonly ModelPrice[];
}): { model: string; name: string | null; relativeCost: number }[];
```

Rules: use only turns whose `model` has a catalog price and known input/output tokens (cached defaults to 0);
actual cost = Σ `listCost(turn, price(turn.model))`; for each catalog model with positive prices compute the
same tokens at its price; `relativeCost` = alternative ÷ actual; return at most the 4 cheapest alternatives with
`relativeCost < 1` (excluding models the session used), sorted ascending; `[]` when actual cost is 0/unknown or no
turn qualified. DTO `efficiency.priceAlternatives: z.array(z.object({ model: z.string(), name: z.string().nullable(), relativeCost: measuredNumber }))`,
each `derived`, source `catalog list prices applied to this session's exact tokens; relative to the list cost of the models actually used, not a credit figure`.

- [ ] **Step 1: Failing tests:** with prices `{A: in 10/out 30/cache 1/batch 1000, B: 1/3/0.1/1000, C: 20/60/2/1000}`
      and a session entirely on A using 1000 in (200 cached) / 100 out: actual = `(800×10+200×1+100×30)/1000 = 11.2`;
      B = `(800×1+200×0.1+100×3)/1000 = 1.12` → `relativeCost` 0.1; C excluded (>1); a model with no price
      ignored; unpriced session model → `[]`; used models excluded from alternatives; cap of 4; zero-token session →
      `[]`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Wire** (`getSessionEfficiency` receives `prices` from
      `CatalogStore`; add `ALLOWED` nothing new — `relativeCost` is measured). **Step 5: UI:** a small table
      `Same tokens on other models (list-price index)` with model name and `0.1×` (format
      `${Number(v.toFixed(2))}×`), note `Relative list cost of this session's exact tokens; not a credit figure.`
      Tests: rows, badge, note; hidden when empty.
- [ ] **Step 6:** `pnpm format && pnpm verify` → PASS. **Step 7: Commit**

```bash
git add -A
git commit -m "feat(efficiency): show list-price cost of the same tokens on other catalog models"
```

---

### Task 5.5: Model-selection findings

**Files:**

- Create: `src/core/efficiency/modelFindings.ts`, `modelFindings.test.ts`
- Modify: `src/core/query/sessionEfficiency.ts`, `src/core/analysis/findings.ts` (export `CORRECTION`)

**Interfaces:**

- Consumes: `ModelPrice` (5.4), `TurnDetail`, `Outcomes`, complexity (`estimateComplexity` from
  `src/core/analysis/complexity.ts`), `summarizeChanges` (`src/core/analysis/changes.ts`).
- Produces:

```ts
export interface ModelFindingInput {
  turns: readonly TurnDetail[];
  prices: readonly ModelPrice[];
  outcomes: Pick<Outcomes, 'editsUndone' | 'lastTestPassed'>;
}
export function modelFindings(input: ModelFindingInput): Finding[];
```

Definitions: `small` = ≤ 1 changed file, ≤ 2 user turns, 0 failed user turns, 0 undone edits, no correction
prompts. `price rank` of a model = its `inputPrice` position among catalog models with a price (top third =
`expensive`, bottom third = `lightweight`; needs ≥ 6 priced models, otherwise rules that need a rank are
skipped). `dominantModel` = the model of the most user turns (ties → the more expensive). `complex` =
`estimateComplexity(...) === 'complex'`. All findings `inferred`, source `rule over turn state, file events and
catalog list prices`; messages never say "wrong model".

1. `oversized-model` — `small`, dominant model `expensive`, `selectionMode` of its turns `manual` → message
   `This looks like a small task run on an expensive model you selected. A lighter model may have been enough.`
   evidence `1 file changed, 2 user turns, no failures, no corrections; model X is in the top third of catalog input prices`.
2. `auto-over-routing` — same but selection `auto` → message
   `Auto routed this small task to an expensive model. Picking a lighter model manually may be cheaper for tasks like this.`
3. `undersized-model` — dominant model `lightweight`, `complex`, and (≥ 3 corrections or ≥ 2 failed user turns or
   ≥ 2 undone edits) → message
   `A complex task on a lightweight model needed repeated fixes. A stronger reasoning model may have been more efficient.`
   evidence lists the counts (`4 corrections, 1 failed turn, 3 edits undone`).
4. `high-reasoning` — `small` and total `reasoningMs` ≥ 120,000 → message
   `Long reasoning on a small task. A lower reasoning effort may have been enough.` evidence
   `2m 10s of reasoning across 2 turns for 1 changed file`.

- [ ] **Step 1: Failing tests** covering each rule positive and negative:
  - `oversized-model` fires for manual+expensive+small; does **not** fire when 3 files changed, when a correction
    exists (`CORRECTION` prompt like `no, that's wrong`), or when the model is mid-priced;
  - `auto-over-routing` fires for auto, and never together with `oversized-model`;
  - `undersized-model` fires for lightweight + complex + 3 corrections; not for lightweight + simple;
  - `high-reasoning` threshold boundary (119,999 ms no, 120,000 ms yes);
  - fewer than 6 priced models or a BYOK model without a price → the rank rules return nothing;
  - without prompt text (`userText: null`) corrections count as 0 but failed turns still count;
  - no message contains the words `wrong model`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Wire** into `getSessionEfficiency`
      (`efficiency.findings`); needs `outcomes` (pass `detail.outcomes`; change the signature to
      `getSessionEfficiency(database, detail)` where `detail` is the assembled `SessionDetail` minus `efficiency`)
      and the complexity input. Test via `seededStore` that a manual + expensive catalog model session yields the
      finding only when catalog prices are inserted for ≥ 6 models.
- [ ] **Step 5:** `pnpm format && pnpm verify` → PASS. **Step 6: Commit**

```bash
git add -A
git commit -m "feat(efficiency): add evidence-based model-selection findings"
```

---

### Task 5.6: Prompt findings v2

**Files:**

- Modify: `src/core/analysis/findings.ts`, `findings.test.ts`, `src/core/analysis/analyzeSession.ts` (only if the
  input changes), `src/core/analysis/analyzeSession.test.ts`; bump `ANALYZER_VERSION` to 3.

**Interfaces:**

- `promptFindings(turns: readonly TurnDetail[]): Finding[]` keeps its signature and existing ids
  (`vague-first-prompt`, `repeated-corrections`, `long-session`, `repeated-failures`); this task adds:

1. `underspecified-start` — first user prompt text present, **no** file reference (regex
   `/[\w./-]+\.[a-z]{1,5}\b|`[^`]+`|#file:/i`) and **no** acceptance cue (`/\b(should|must|expect|so that|when|until|passes?|returns?)\b/i`),
   and the session needed ≥ 3 user turns. Evidence `opening prompt names no file and states no success condition; the session took 5 user turns`.
   Replaces `vague-first-prompt` when both would fire (keep `vague-first-prompt` only when this one does not).
2. `late-constraints` — the first prompt has no constraint word and a later user prompt (turn index ≥ 3 among user
   turns) contains one of `/\b(must|only|never|don'?t|do not|without|make sure|ensure|instead of)\b/i`.
   Evidence `constraints first appeared on turn 4 ("only", "without")` (the matched words, lowercased, max 3).
3. `drift` — with ≥ 6 file events over the session, split the user turns into first and second half by turn index;
   if both halves touched ≥ 2 distinct files and share **no** parent directory, finding
   `The session moved into unrelated areas. Starting a separate session for the new topic may keep context smaller.`
   Evidence `early turns touched execution/; later turns touched docs/, scripts/`.

All v2 findings are `inferred`; system-initiated turns are excluded everywhere (as v1 already does). Text-based
rules are skipped when no prompt text is stored; `drift` uses file events only.

- [ ] **Step 1: Failing tests** (positive and negative per rule, in `findings.test.ts` using `makeTurn`):
  underspecified start with/without a file reference and with/without acceptance cue, and with only 2 turns (no
  finding); `vague-first-prompt` does not double-fire; late constraints positive (turn 4) and negative (constraint
  already in the first prompt, constraint on turn 2); drift positive (early `src/execution/a.ts`,
  `src/execution/b.ts`; late `docs/x.md`, `scripts/y.ts`, 6 events total) and negative (shared directory, fewer than
  6 events); all three skipped with `userText: null` except `drift`; system-initiated corrections never counted.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4:** update `analyzeSession.test.ts` expectations that change
      (recompute, do not loosen); bump `ANALYZER_VERSION`.
- [ ] **Step 5:** `pnpm format && pnpm verify` → PASS. **Step 6: Commit**

```bash
git add -A
git commit -m "feat(analysis): add underspecified-start, late-constraint and drift prompt findings"
```

---

### Task 5.7: Failure analytics

**Files:**

- Create: `src/core/query/failureAnalytics.ts`, `failureAnalytics.test.ts`,
  `src/webview/views/FailureAnalyticsCard.tsx`, `FailureAnalyticsCard.test.tsx`
- Modify: `src/shared/dto.ts`, `src/shared/protocol.ts`, `src/core/query/insightsQueries.ts`,
  `src/extension/extension.ts`, `src/extension/webviewHost/rpcHost.test.ts`, `src/webview/views/OverviewView.tsx`,
  `src/shared/dto.provenance.test.ts`

**Interfaces:**

- Produces (DTO):

```ts
export const failureRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  turns: z.number(),          // user-initiated, finished turns in the group (index fact)
  failed: z.number(),         // of those, how many failed (index fact)
  failureRate: measuredNumber,
  toolInputRetries: measuredNumber,
  maxToolCallsExceeded: measuredNumber,
});
export const failureAnalyticsSchema = z.object({
  byModel: z.array(failureRowSchema),
  byProvider: z.array(failureRowSchema),
  byMode: z.array(failureRowSchema),
});
```

- Produces: `getFailureAnalytics(database: Pick<Database,'db'>): FailureAnalytics`; protocol
  `getFailureAnalytics: { params: z.object({}), result: failureAnalyticsSchema }`;
  `ALLOWED.failureAnalytics = ['byMode[].failed','byMode[].turns','byModel[].failed','byModel[].turns','byProvider[].failed','byProvider[].turns']`.

Rules: population = turns with `system_initiated = 0` and state in (`complete`,`failed`,`cancelled`) (same
definition as the Overview failure rate — read `overview.ts` and reuse its predicate constant if one exists);
model = `COALESCE(resolved_model, requested_model)` (null → `Unknown model`); provider = `model_host` label
(`Copilot`, `BYOK / local`, `Unknown`) — and for BYOK the provider prefix of the model id before the first `/`
or `:` when present (`ollama`, `nvidia-nim`…); mode = `mode` column (null → `unknown`). `failureRate` =
failed ÷ turns, `derived`, source `turn state over finished user-initiated turns`; `toolInputRetries` and
`maxToolCallsExceeded` = exact sums (`SUM(tool_input_retries)`, `SUM(max_tool_calls_exceeded)`), source
`chatSessions toolCallRounds`. Sort by failed desc, then turns desc. Groups with turns = 0 do not appear.

- [ ] **Step 1: Failing tests** (`seededStore`: fx-byok-1 has a failed turn): model/provider/mode groups exist with
      the right `turns`/`failed`; rate derived; retries/exceeded exact sums (set `tool_input_retries = 2` via SQL on a
      turn); system-initiated and pending turns excluded; empty database → three empty arrays; BYOK model
      `ollama/qwen3` groups under provider `ollama`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement + DTO + protocol + handler + provenance `ALLOWED` + rpc test
      handler. Step 4: UI** `FailureAnalyticsCard` (three `DataTable`s captions `Failures by model/provider/mode`,
      columns Group, Turns, Failed, Failure rate, Tool retries, Hit tool-call limit; empty text
      `No finished turns yet.`), mount in `OverviewView` after `CommitsCard`. Tests: tables render rates with
      badges; empty text; error line `Could not load failure analytics` when the RPC rejects while the rest of the
      overview still renders.
- [ ] **Step 5:** `pnpm format && pnpm verify` → PASS. **Step 6: Commit**

```bash
git add -A
git commit -m "feat(analytics): add failure analytics by model, provider and mode"
```

---

### Task 5.8: Transparent efficiency score, docs, release 0.7.0

**Files:**

- Create: `src/core/efficiency/score.ts`, `score.test.ts`
- Modify: `src/core/query/sessionEfficiency.ts`, `src/shared/dto.ts`, `src/webview/views/EfficiencyCard.tsx`
  (+test), `README.md`, `CHANGELOG.md`, `docs/ROADMAP.md`, `package.json` (`0.7.0`)

**Interfaces:**

- Produces:

```ts
export interface ScoreComponent { id: string; label: string; value: number; evidence: string; provenance: Provenance } // value 0–1, higher is better
export function efficiencyScore(input: {
  turns: readonly TurnDetail[]; outcomes: Outcomes; findings: readonly Finding[];
}): { band: 'good' | 'fair' | 'needs-work'; components: ScoreComponent[] } | null;
```

Components (each only when its evidence exists; `evidence` names the numbers):

- `first-pass` — `1` when no correction prompts, no undone edits and no failed user turns; otherwise
  `max(0, 1 − (corrections + undone + failed) ÷ max(userTurns, 1))`. Derived. Evidence `2 corrections, 1 edit undone, 0 failed turns over 5 user turns`.
- `edit-keep` — `editKeepRate` when available (derived, from outcomes).
- `tests` — `lastTestPassed` true → `1`, false → `0` (derived).
- `tool-reliability` — `1 − failed tool-call turns share`: here `1 − (toolInputRetries ÷ max(toolRounds, 1))` clamped
  0–1, when toolRounds > 0 (exact).
- `context-discipline` — `1` when no `long-session`/`context-growth` style problems: `1 − min(1, (growthRatio − 1) ÷ 4)`
  where `growthRatio` = last÷first user-turn input tokens, when ≥ 3 turns have input; evidence
  `context grew 2.8×` (derived).

Band: average of component values ≥ 0.75 → `good`; ≥ 0.5 → `fair`; else `needs-work`. `null` when fewer than 3
components. DTO: `efficiency.score: z.object({ band: measured(z.enum(['good','fair','needs-work'])), components: z.array(z.object({ id, label, value: measuredNumber, evidence })) }).nullable()`;
`band` provenance is the weakest of its components (`weakest(...)`), source
`unweighted average of the components shown`.

- [ ] **Step 1: Failing tests:** all five components from a crafted session; band thresholds at 0.75/0.5
      boundaries; < 3 components → `null`; a healthy session gets `good` with components (no praise string);
      zero user turns does not divide by zero; provenance weakest of components.
- [ ] **Step 2: Run → FAIL. Step 3: Implement + wire. Step 4: UI:** the card shows
      `Efficiency: Good|Fair|Needs work` with the badge and a `<dl>` of components (label → percent `Measure`,
      evidence muted); `null` → line `Not enough evidence for an efficiency score (needs at least three measured
      components).` Tests for each state and that no bare number headline is rendered.
- [ ] **Step 5: Docs:** README `What you get` (Efficiency: cost drivers, context advice, counterfactuals labelled
      inferred, model findings, failure analytics, transparent score) and Privacy (tool names and sizes only, no
      prompt file content); CHANGELOG `0.7.0`; ROADMAP Phase 5 marked done with D-P5-1…5 and the limits (debug
      logs needed for tool/system-prompt cost; list-price index is not credits); `package.json` → `0.7.0`.
- [ ] **Step 6: Full verification:** `pnpm format && pnpm verify`, `pnpm test:integration` (stable and floor),
      `pnpm smoke:real`.
- [ ] **Step 7: Update project memory** (`copilot-insights-status.md`): Phase 5 done, HEAD hash, test counts.
- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(efficiency): add transparent efficiency score; document; release 0.7.0"
```

---

## Self-Review

- **Spec coverage:** 5.1 → Task 5.1 (drivers incl. composition, compactions, rounds, retries, failures, cache);
  5.2 → Task 5.2 (unused tools, system-prompt cost; MCP-server attribution is covered as tool names, instruction
  files via system-prompt size — D-P5-4 states why free-text discovery events are not parsed); 5.3 → 5.3; 5.4 →
  5.4; 5.5 → 5.5; 5.6 → 5.6; 5.7 → 5.7; 5.8 → 5.8. Vision §4 "abandoned approaches" is covered only by the
  undone-edit signal inside `first-pass`/`undersized-model` (no separate detector; noted in the ROADMAP limits).
- **Placeholder scan:** the two "read X to find the exact accessor" notes (Task 5.2 Step 4 debug scan entry
  points, Task 5.4 `CatalogStore`, Task 5.7 overview predicate) name the file to read because those signatures
  were not re-read while writing the plan; behaviour to implement is fully specified.
- **Type consistency:** `Finding`/`CostDriver` from Task 5.1 `types.ts` are reused by 5.2, 5.5, 5.8;
  `ModelPrice` from 5.4 is reused by 5.5; `getSessionEfficiency` changes signature in 5.2 (`database, turns,
  sessionId`) and again in 5.5 (`database, detail`) — the later task updates the earlier call sites and tests.
- **Known risks:** (1) debug-log file names are read relative to the log directory — keep the basename-only
  guard; (2) `estimateComplexity` inputs are available from `summarizeChanges` + turns (as `analyzeSession` does);
  (3) catalog price columns are nullable — treat null as "no price".
