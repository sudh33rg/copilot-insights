# Phase 2: Parity Dashboard (React) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.
>
> **Git rule (overrides every skill):** work directly on `main`. Do not create branches, worktrees, or pull
> requests. Commit after each task. Do not push unless the user asks.

**Goal:** Everything the v0.2 prototype promised — sessions list, session detail, overview, clear/export/retention,
GitHub usage sync — working on the real ingested data, in a maintainable React UI, with every metric carrying
provenance.

**Architecture:** A pure query layer in `src/core/query` turns the SQLite index into `Measured<T>` DTOs defined
(as zod schemas) in `src/shared/dto.ts`. A deterministic analyzer in `src/core/analysis` derives intent, outcome,
areas, complexity and prompt findings from stored turns and caches them in `session_analysis`. The extension
exposes new typed RPC methods; the React webview renders them through a small plain-component kit in
`src/webview/ui`. Destructive actions (clear, delete legacy data) are confirmed with modal dialogs in extension
code, never in the webview. GitHub usage sync lives in `src/core/github` with an injected `fetch`.

**Tech Stack:** unchanged from Phase 0–1 (TypeScript 6.0 strict, React 19, TanStack Query 5, zod 4,
`node:sqlite`, Vitest 5 + Testing Library, esbuild, Vite 8).

**Spec:** `docs/PRODUCT_VISION.md` §1–§3, §7–§8; `docs/ROADMAP.md` Phase 2 table (tasks 2.1–2.9) and decisions
D4, D9–D13; `docs/copilot-data-formats.md`; `CLAUDE.md`. Interfaces come from
`docs/superpowers/plans/2026-09-30-phase-0-1-foundation-and-ingestion.md` (already implemented on `main`).

**Dry-run status:** not dry-run. Code blocks were written against the real Phase 1 sources and the real fixture
values (see "Fixture facts" below). Where execution proves a block wrong, fold the fix back into this file.

## Global Constraints

- Work on `main` only; one Conventional Commit per task; never push without being asked.
- Before every commit: `pnpm format && pnpm verify` must pass. Run `pnpm test:integration` at the end of
  Tasks 2.4, 2.7 and 2.9.
- Layering (ESLint-enforced): `shared` → nothing environment-specific; `core` → `node:*`, `zod`, `shared`;
  `extension` → `vscode`, `core`, `shared`; `webview` → `react`, browser, `shared`.
- Every user-visible metric is a `Measured<T>` from `src/shared/provenance.ts`. Partial sums are at most
  `derived` (use `summed()` in `src/core/query/measure.ts`); never mix estimates into exact totals.
- Never divide GitHub daily/account credits across sessions. Per-session credits come only from Copilot's own
  per-request `copilotCredits` field.
- Never send prompt text, response text, tool arguments, or file contents anywhere except to the webview as
  plain text. Tool **arguments are never sent to the webview**. Never log them.
- Webview: strict CSP, no inline scripts/`<style>`, no `dangerouslySetInnerHTML`; render conversation text as
  plain text (React text nodes only).
- No network except the GitHub REST API on explicit user sync; never send the token to any host other than
  `api.github.com`; no AI provider calls.
- Never delete or modify Copilot's own files or GitHub-side data. Clearing affects only this extension's index
  (`insights.db`) and this extension's own legacy files.
- Destructive actions require a modal confirmation in extension code, and deletions write tombstones so the
  next scan does not re-import them.
- SQL: no string-built values. Use named parameters; pass id lists as one JSON parameter (`json_each(:ids)`).

## Fixture facts (real values these tests rely on)

`test/fixtures/chatSessions/` (synthetic, produced by Phase 1):

- `auto-agent-session.jsonl` → session `fx-auto-1`, title "Fix run timeout race", 2 turns (indexes 1, 2),
  both `complete`, `AUTO` → resolved `gpt-5.6-luna`, host `copilot`. Turn 1: 24000 in / 1700 out /
  1.126141 credits, tools `read_file`, `replace_string_in_file`, files `read`+`edited`
  `/repo/src/execution/manager.ts`, 1 compaction, prompt "Fix the timeout race in src/execution/ma…". Turn 2:
  30000 in / 900 out / 0.5 credits, tool `create_file`, files `created /repo/test/manager.test.ts`,
  `kept /repo/src/execution/manager.ts`, prompt "Also add a regression test". Session totals: 54000 in,
  2600 out, 1.626141 credits. Started at 1790000001000 ms.
- `byok-failed-session.jsonl` → session `fx-byok-1`, title `null`, workspace label chosen by the test, 2 turns:
  turn 1 `failed`, `MANUAL`, `qwen3.5:35b`, host `byok`, no tokens/credits, prompt "Explain the retry policy";
  turn 2 `cancelled`, system-initiated, 5000 in / 50 out, no credits. Started at 1790100000000 ms.
- Tests seed alpha = auto fixture, beta = byok fixture via `seededStore()` (created in Task 2.2).

## Review Focus

1. **Partial data must not look exact.** A session where only some turns report tokens/credits shows a
   `derived` lower bound (never `exact`); a session with none shows `unavailable` (never `0`). Tests: Task 2.2.
2. **Search input is untrusted text.** `%`, `_`, quotes and very long strings in the search box must match
   literally and never break SQL. Test: Task 2.2.
3. **Conversation text is hostile HTML.** A prompt like `<img src=x onerror=alert(1)>` renders as visible text
   and creates no element. Test: Task 2.5.
4. **Clearing must stay cleared.** After "delete session", the next scan of the still-existing Copilot file
   must not bring it back; after "clear content", it must not restore text. Tests: Task 2.7.
5. **GitHub token containment.** With a fake `fetch`, no request with an `Authorization` header goes to any host
   other than `api.github.com`, including report download links returned by the API. Test: Task 2.8.

## File Structure

```
src/shared/dto.ts                     zod DTO schemas + inferred types (Measured, rows, detail, overview, analysis, github)
src/shared/protocol.ts                (modified) new RPC methods
src/core/query/measure.ts             summed(), known(), toTurnState(), SOURCES
src/core/query/routing.ts             "Auto → X" / "Manual · X" labels
src/core/query/sessionList.ts         listSessions (paging, search, filters)
src/core/query/sessionDetail.ts       getSessionDetail
src/core/query/overview.ts            getOverview
src/core/query/insightsQueries.ts     composes queries + analysis cache for the extension
src/core/analysis/*.ts                intent, outcome/areas, complexity, prompt findings, analyzeSession, analysisStore
src/core/storage/migrations.ts        (modified) v2 session_analysis, v3 github_daily_usage
src/core/clear/clearService.ts        clear session/content/by day/workspace/everything, with tombstones
src/core/export/exportJson.ts         export the index as JSON
src/core/github/*.ts                  API client, usage sync, usage store
src/extension/dialogs.ts              modal confirmations
src/extension/legacyData.ts           detect v0.2 usage.sqlite3/usage.json
src/extension/githubAuth.ts           token from vscode.authentication
src/webview/ui/*                      Button, Badge, Measure, DataTable, format helpers
src/webview/views/*                   OverviewView, SessionsView, SessionDetailView
test/fixtures/sessions.ts             loadFixtureSession, cloneSession, seededStore
```

---

## Task 2.1: UI kit spike (decision D12) and plain component kit

**Files:**

- Create: `src/webview/test/fakeHost.tsx`, `src/webview/ui/format.ts`, `src/webview/ui/format.test.ts`,
  `src/webview/ui/Badge.tsx`, `src/webview/ui/Measure.tsx`, `src/webview/ui/Button.tsx`,
  `src/webview/ui/DataTable.tsx`, `src/webview/ui/ui.test.tsx`
- Modify: `src/webview/App.test.tsx` (use the shared helper), `src/webview/styles.css`, `docs/ROADMAP.md`
- Create then delete: `src/webview/spike.test.tsx`

**Interfaces:**

- Produces (`src/shared/dto.ts` is created in Task 2.2; the kit below only needs this shape):
  `interface MeasureLike { value: number | string | null; provenance: { kind: 'exact' | 'derived' | 'inferred' | 'unavailable'; source: string } }`.
- Produces (`ui/format.ts`): `formatInt(n)`, `formatCredits(n)`, `formatPercent(ratio)`, `formatDuration(ms)`,
  `formatDateTime(ms)`.
- Produces (`ui/Badge.tsx`): `ProvenanceBadge({ provenance })`.
- Produces (`ui/Measure.tsx`): `Measure({ measure, format? })`.
- Produces (`ui/Button.tsx`): `Button(props: ButtonHTMLAttributes & { variant?: 'primary' | 'secondary' })`.
- Produces (`ui/DataTable.tsx`): `DataTable<Row>({ caption, columns, rows, rowKey, onRowActivate?, empty })` with
  `Column<Row> { id: string; header: string; cell(row: Row): ReactNode; align?: 'end' }`.
- Produces (`test/fakeHost.tsx`): `fakeHost(results)`, `renderWithHost(ui, results)`.

- [ ] **Step 1: Run the spike (throwaway)**

Decision D12 asks whether `@vscode-elements/react-elements` works under our constraints (strict CSP, jsdom
tests). Time-box: 20 minutes. Install it and try to render a button and a table in jsdom:

```bash
pnpm add -D @vscode-elements/react-elements
```

`src/webview/spike.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { VscodeButton } from '@vscode-elements/react-elements';
import { describe, expect, it } from 'vitest';

describe('spike: vscode-elements in jsdom', () => {
  it('renders a button', () => {
    render(<VscodeButton>Refresh</VscodeButton>);
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });
});
```

Run: `pnpm vitest run src/webview/spike.test.tsx`

Record the exact outcome (pass, or the error message such as missing `adoptedStyleSheets`/`ElementInternals`
in jsdom). Then remove everything from the spike:

```bash
rm src/webview/spike.test.tsx
pnpm remove @vscode-elements/react-elements
```

**Decision rule:** even if the spike passes, this plan builds a small plain component kit, because (a) every
component we need in Phase 2 is a table, button, badge or text input; (b) plain semantic HTML is trivially
accessible and testable; (c) all UI code goes through `src/webview/ui`, so swapping in a component library later
touches only that folder. Replace the D12 row in `docs/ROADMAP.md` with:

```
| D12 | UI kit: plain semantic components in `src/webview/ui` styled with VS Code CSS variables. `@vscode-elements/react-elements` spike (2026-09-30): <one-line result>. Revisit when a component we cannot cheaply build is needed (tree, split pane). | works under strict CSP and in jsdom; all UI goes through one folder |
```

Fill `<one-line result>` with what Step 1 actually printed.

- [ ] **Step 2: Extract the test host helper** — `src/webview/test/fakeHost.tsx`

`App.test.tsx` currently defines and exports `fakeHost` and `renderApp`. Move the reusable part here so view
tests can share it:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { HostToWebview } from '../../shared/protocol';
import { RpcClient, type Transport } from '../rpcClient';
import { RpcProvider } from '../rpcContext';

export interface RpcCall {
  method: string;
  params: unknown;
}

/**
 * A transport whose host answers `rpc` messages from `results` (by method name). A result may be a function
 * of the request params. Methods without an entry reject with "boom". Every request is recorded in `calls`.
 */
export function fakeHost(results: Record<string, unknown>, calls: RpcCall[] = []): Transport {
  let listener: ((message: HostToWebview) => void) | undefined;
  return {
    post: (message) => {
      const request = message as { id: number; method: string; params: unknown };
      calls.push({ method: request.method, params: request.params });
      queueMicrotask(() => {
        if (!Object.hasOwn(results, request.method)) {
          listener?.({ kind: 'rpc-result', id: request.id, ok: false, error: 'boom' });
          return;
        }
        const entry = results[request.method];
        const result =
          typeof entry === 'function' ? (entry as (params: unknown) => unknown)(request.params) : entry;
        listener?.({ kind: 'rpc-result', id: request.id, ok: true, result });
      });
    },
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  };
}

/** Renders `ui` against a fake host; `calls` lists every RPC the UI made, in order. */
export function renderWithHost(ui: ReactElement, results: Record<string, unknown>) {
  const calls: RpcCall[] = [];
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RpcProvider client={new RpcClient(fakeHost(results, calls))}>{ui}</RpcProvider>
    </QueryClientProvider>,
  );
  return { ...utils, calls };
}
```

Update `src/webview/App.test.tsx`: delete its local `fakeHost` and `renderApp`, import
`renderWithHost` from `./test/fakeHost`, and call `renderWithHost(<App view="dashboard" />, {...})` in each
test. Check the shape the existing tests pass (`getIndexStatus` results keyed by method name) before deleting.

Run: `pnpm vitest run src/webview` — Expected: PASS (same 5 tests).

- [ ] **Step 3: Write the failing kit tests** — `src/webview/ui/format.test.ts` and `src/webview/ui/ui.test.tsx`

`src/webview/ui/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatCredits, formatDuration, formatInt, formatPercent } from './format';

describe('format', () => {
  it('groups integers', () => {
    expect(formatInt(1234567)).toBe('1,234,567');
    expect(formatInt(0)).toBe('0');
  });

  it('shows credits with up to 3 decimals and no trailing zeros', () => {
    expect(formatCredits(1.626141)).toBe('1.626');
    expect(formatCredits(0.5)).toBe('0.5');
    expect(formatCredits(12)).toBe('12');
  });

  it('formats ratios as whole percentages', () => {
    expect(formatPercent(0.2246)).toBe('22%');
    expect(formatPercent(0)).toBe('0%');
  });

  it('formats durations compactly', () => {
    expect(formatDuration(450)).toBe('450 ms');
    expect(formatDuration(12_300)).toBe('12.3 s');
    expect(formatDuration(185_000)).toBe('3m 5s');
    expect(formatDuration(3_723_000)).toBe('1h 2m');
  });
});
```

`src/webview/ui/ui.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { DataTable, type Column } from './DataTable';
import { Measure } from './Measure';

describe('Measure', () => {
  it('shows the value with its provenance', () => {
    render(
      <Measure
        measure={{ value: 54000, provenance: { kind: 'exact', source: 'chatSessions.promptTokens' } }}
      />,
    );
    expect(screen.getByText('54,000')).toBeInTheDocument();
    const badge = screen.getByText('Exact');
    expect(badge).toHaveAttribute('title', 'Exact — chatSessions.promptTokens');
  });

  it('shows a dash and the reason when unavailable', () => {
    render(
      <Measure
        measure={{ value: null, provenance: { kind: 'unavailable', source: 'no credits reported' } }}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toHaveAttribute('title', 'Unavailable — no credits reported');
  });

  it('uses a custom formatter', () => {
    render(
      <Measure
        format={(value) => `${String(value)} cr`}
        measure={{ value: 2, provenance: { kind: 'derived', source: 'x' } }}
      />,
    );
    expect(screen.getByText('2 cr')).toBeInTheDocument();
    expect(screen.getByText('Derived')).toBeInTheDocument();
  });
});

interface Person {
  id: string;
  name: string;
}
const columns: Column<Person>[] = [
  { id: 'name', header: 'Name', cell: (row) => row.name },
  { id: 'id', header: 'Id', cell: (row) => row.id, align: 'end' },
];
const rows: Person[] = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Bo' },
];

describe('DataTable', () => {
  it('renders a captioned table with headers and rows', () => {
    render(
      <DataTable caption="People" columns={columns} rows={rows} rowKey={(row) => row.id} empty="None" />,
    );
    expect(screen.getByRole('table', { name: 'People' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Name', 'Id']);
    expect(screen.getByText('Ada')).toBeInTheDocument();
  });

  it('shows the empty message instead of an empty table', () => {
    render(
      <DataTable caption="People" columns={columns} rows={[]} rowKey={(row) => row.id} empty="Nobody here" />,
    );
    expect(screen.getByText('Nobody here')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('activates a row by click and by keyboard', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        caption="People"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        onRowActivate={onActivate}
        empty="None"
      />,
    );
    await user.click(screen.getByText('Ada'));
    expect(onActivate).toHaveBeenLastCalledWith(rows[0]);
    const second = screen.getByText('Bo').closest('tr');
    expect(second).not.toBeNull();
    second?.focus();
    await user.keyboard('{Enter}');
    expect(onActivate).toHaveBeenLastCalledWith(rows[1]);
  });
});

describe('Button', () => {
  it('renders a real button and forwards clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Refresh</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
```

Run: `pnpm vitest run src/webview/ui` — Expected: FAIL (modules not found).

- [ ] **Step 4: Implement the kit**

`src/webview/ui/format.ts`:

```ts
const INT = new Intl.NumberFormat('en-US');

export function formatInt(value: number): string {
  return INT.format(value);
}

export function formatCredits(value: number): string {
  return String(Number(value.toFixed(3)));
}

export function formatPercent(ratio: number): string {
  return `${String(Math.round(ratio * 100))}%`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${String(Number(seconds.toFixed(1)))} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(Math.round(seconds - minutes * 60))}s`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h ${String(minutes - hours * 60)}m`;
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString();
}
```

`src/webview/ui/Badge.tsx`:

```tsx
export type ProvenanceKind = 'exact' | 'derived' | 'inferred' | 'unavailable';

const LABELS: Record<ProvenanceKind, string> = {
  exact: 'Exact',
  derived: 'Derived',
  inferred: 'Inferred',
  unavailable: 'Unavailable',
};

export function ProvenanceBadge({ provenance }: { provenance: { kind: ProvenanceKind; source: string } }) {
  const label = LABELS[provenance.kind];
  return (
    <abbr className={`badge badge--${provenance.kind}`} title={`${label} — ${provenance.source}`}>
      {label}
    </abbr>
  );
}
```

`src/webview/ui/Measure.tsx`:

```tsx
import { ProvenanceBadge, type ProvenanceKind } from './Badge';
import { formatInt } from './format';

const defaultFormat = (value: number | string): string =>
  typeof value === 'number' ? formatInt(value) : value;

export interface MeasureLike {
  value: number | string | null;
  provenance: { kind: ProvenanceKind; source: string };
}

export function Measure({
  measure,
  format = defaultFormat,
}: {
  measure: MeasureLike;
  format?: (value: number | string) => string;
}) {
  return (
    <span className="measure">
      <span className="measure__value">{measure.value === null ? '—' : format(measure.value)}</span>
      <ProvenanceBadge provenance={measure.provenance} />
    </span>
  );
}
```

`src/webview/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react';

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  return (
    <button type={type} className={`btn btn--${variant}${className ? ` ${className}` : ''}`} {...rest} />
  );
}
```

`src/webview/ui/DataTable.tsx`:

```tsx
import type { KeyboardEvent, ReactNode } from 'react';

export interface Column<Row> {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: 'end';
}

export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  onRowActivate,
  empty,
}: {
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  onRowActivate?: (row: Row) => void;
  empty: string;
}) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  const activate = (row: Row) => (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowActivate?.(row);
    }
  };
  return (
    <table className="table" aria-label={caption}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.id} scope="col" className={column.align === 'end' ? 'num' : undefined}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={rowKey(row)}
            tabIndex={onRowActivate ? 0 : undefined}
            className={onRowActivate ? 'row--interactive' : undefined}
            onClick={
              onRowActivate
                ? () => {
                    onRowActivate(row);
                  }
                : undefined
            }
            onKeyDown={onRowActivate ? activate(row) : undefined}
          >
            {columns.map((column) => (
              <td key={column.id} className={column.align === 'end' ? 'num' : undefined}>
                {column.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Append to `src/webview/styles.css`:

```css
.btn {
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 2px;
  padding: 4px 10px;
  font: inherit;
  cursor: pointer;
}
.btn--primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
.btn--secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
.btn:focus-visible,
.row--interactive:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
.table {
  width: 100%;
  border-collapse: collapse;
}
.table th,
.table td {
  padding: 4px 8px;
  text-align: left;
  border-bottom: 1px solid var(--vscode-editorGroup-border, var(--vscode-widget-border, transparent));
  vertical-align: top;
}
.table th {
  color: var(--vscode-descriptionForeground);
  font-weight: 600;
}
.table .num {
  text-align: right;
  white-space: nowrap;
}
.row--interactive {
  cursor: pointer;
}
.row--interactive:hover {
  background: var(--vscode-list-hoverBackground);
}
.measure {
  display: inline-flex;
  gap: 6px;
  align-items: baseline;
}
.badge {
  font-size: 0.75em;
  padding: 0 4px;
  border-radius: 3px;
  text-decoration: none;
  border: 1px solid currentColor;
  opacity: 0.8;
}
.badge--exact {
  color: var(--vscode-charts-green);
}
.badge--derived {
  color: var(--vscode-charts-blue);
}
.badge--inferred {
  color: var(--vscode-charts-orange);
}
.badge--unavailable {
  color: var(--vscode-descriptionForeground);
}
```

Run: `pnpm vitest run src/webview` — Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(webview): add plain UI kit with provenance badges; record decision D12"
```

---

## Task 2.2: DTOs and the query layer

**Files:**

- Create: `src/shared/dto.ts`, `src/shared/dto.test.ts`, `test/fixtures/sessions.ts`,
  `src/core/query/measure.ts`, `src/core/query/measure.test.ts`, `src/core/query/routing.ts`,
  `src/core/query/routing.test.ts`, `src/core/query/sessionList.ts`, `src/core/query/sessionList.test.ts`,
  `src/core/query/sessionDetail.ts`, `src/core/query/sessionDetail.test.ts`, `src/core/query/overview.ts`,
  `src/core/query/overview.test.ts`

**Interfaces:**

- Consumes: `Database` (`.db`), `SessionStore.replaceSession`, `normalizeChatSession`, `modelNameFromId`,
  `applyCaptureLevel`, `localDay`, `Measured`, `exact`, `derived`, `unavailable`.
- Produces (`shared/dto.ts`): zod schemas and inferred types `Provenance`, `MeasuredNumber`, `Routing`,
  `SessionRow`, `SessionList`, `TurnDetail`, `SessionDetail`, `Analysis`, `Overview`, `PeriodTotals`,
  `BreakdownRow`, plus the RPC param schemas `sessionListParams`, `sessionIdParams`.
- Produces (`query/measure.ts`): `SOURCES`, `summed(sum, withValue, expected, source)`, `known(value, source)`,
  `toTurnState(value)`.
- Produces (`query/routing.ts`): `routingFor(entries): Routing`.
- Produces: `listSessions(database, query)`, `getSessionDetail(database, id)`, `getOverview(database, today)`.
- Produces (`test/fixtures/sessions.ts`): `loadFixtureSession(name, workspace, level?)`,
  `cloneSession(session, id, shiftMs)`, `seededStore(level?)`.

- [ ] **Step 1: Write the DTO schemas and their test**

`src/shared/dto.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { measured, sessionListParams, sessionRowSchema } from './dto';
import { z } from 'zod';

describe('dto', () => {
  it('validates a measured value and rejects an unknown provenance kind', () => {
    const schema = measured(z.number());
    expect(schema.safeParse({ value: 1, provenance: { kind: 'exact', source: 's' } }).success).toBe(true);
    expect(schema.safeParse({ value: null, provenance: { kind: 'unavailable', source: 's' } }).success).toBe(
      true,
    );
    expect(schema.safeParse({ value: 1, provenance: { kind: 'guess', source: 's' } }).success).toBe(false);
  });

  it('bounds list parameters', () => {
    const ok = { offset: 0, limit: 50 };
    expect(sessionListParams.safeParse(ok).success).toBe(true);
    expect(sessionListParams.safeParse({ ...ok, limit: 1000 }).success).toBe(false);
    expect(sessionListParams.safeParse({ ...ok, offset: -1 }).success).toBe(false);
    expect(sessionListParams.safeParse({ ...ok, q: 'x'.repeat(201) }).success).toBe(false);
    expect(sessionListParams.safeParse({ ...ok, fromDay: '2026-9-1' }).success).toBe(false);
  });

  it('has a session row schema with routing and measured totals', () => {
    expect(Object.keys(sessionRowSchema.shape)).toEqual(
      expect.arrayContaining(['id', 'routing', 'inputTokens', 'outputTokens', 'credits', 'state', 'outcome']),
    );
  });
});
```

Run: `pnpm vitest run src/shared/dto.test.ts` — Expected: FAIL (module not found).

`src/shared/dto.ts`:

```ts
import { z } from 'zod';

export const provenanceSchema = z.object({
  kind: z.enum(['exact', 'derived', 'inferred', 'unavailable']),
  source: z.string(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/** Wire form of `Measured<T>` from `provenance.ts`. */
export const measured = <T extends z.ZodType>(value: T) =>
  z.object({ value: value.nullable(), provenance: provenanceSchema });

export const measuredNumber = measured(z.number());
export type MeasuredNumber = z.infer<typeof measuredNumber>;

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const turnStateSchema = z.enum(['pending', 'complete', 'cancelled', 'failed', 'unknown']);
export const hostSchema = z.enum(['copilot', 'byok', 'unknown']);
export const routingSchema = z.object({
  kind: z.enum(['auto', 'manual', 'mixed', 'unknown']),
  label: z.string(),
});
export type Routing = z.infer<typeof routingSchema>;

// ---- analysis (filled in by Task 2.3) ----
export const analysisSchema = z.object({
  intent: measured(z.string()),
  outcome: measured(z.string()),
  areas: measured(z.array(z.string())),
  complexity: measured(z.enum(['simple', 'moderate', 'complex'])),
  commandCount: measuredNumber,
  findings: z.array(
    z.object({ id: z.string(), message: z.string(), evidence: z.string(), provenance: provenanceSchema }),
  ),
});
export type Analysis = z.infer<typeof analysisSchema>;

// ---- session list ----
export const sessionListParams = z.object({
  q: z.string().max(200).optional(),
  fromDay: dayString.optional(),
  toDay: dayString.optional(),
  workspace: z.string().max(500).optional(),
  failedOnly: z.boolean().optional(),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(100),
});
export type SessionListParams = z.infer<typeof sessionListParams>;

export const sessionRowSchema = z.object({
  id: z.string(),
  day: z.string(),
  startedAt: z.number(),
  workspace: z.string(),
  title: z.string().nullable(),
  outcome: z.string().nullable(),
  routing: routingSchema,
  state: turnStateSchema,
  turns: z.number(),
  failedTurns: z.number(),
  inputTokens: measuredNumber,
  outputTokens: measuredNumber,
  credits: measuredNumber,
});
export type SessionRow = z.infer<typeof sessionRowSchema>;

export const sessionListSchema = z.object({ rows: z.array(sessionRowSchema), total: z.number() });
export type SessionList = z.infer<typeof sessionListSchema>;

// ---- session detail ----
export const sessionIdParams = z.object({ id: z.string().min(1).max(200) });

/** Tool arguments are deliberately absent: they can contain file contents and secrets. */
export const turnDetailSchema = z.object({
  index: z.number(),
  startedAt: z.number().nullable(),
  state: turnStateSchema,
  systemInitiated: z.boolean(),
  mode: z.string().nullable(),
  userText: z.string().nullable(),
  assistantText: z.string().nullable(),
  routing: routingSchema,
  model: z.string().nullable(),
  host: hostSchema,
  inputTokens: measuredNumber,
  outputTokens: measuredNumber,
  credits: measuredNumber,
  reasoningMs: z.number(),
  toolRounds: z.number(),
  compactions: z.number(),
  toolCalls: z.array(z.object({ name: z.string(), status: z.string() })),
  fileEvents: z.array(z.object({ path: z.string(), action: z.string() })),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type TurnDetail = z.infer<typeof turnDetailSchema>;

export const sessionDetailSchema = z.object({
  id: z.string(),
  workspace: z.string(),
  title: z.string().nullable(),
  day: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  activeMs: z.number(),
  captureLevel: z.enum(['metrics', 'summaries', 'full']),
  inputTokens: measuredNumber,
  outputTokens: measuredNumber,
  credits: measuredNumber,
  analysis: analysisSchema.nullable(),
  turns: z.array(turnDetailSchema),
});
export type SessionDetail = z.infer<typeof sessionDetailSchema>;

// ---- overview ----
export const periodTotalsSchema = z.object({
  from: z.string(),
  to: z.string(),
  sessions: z.number(),
  turns: z.number(),
  inputTokens: measuredNumber,
  outputTokens: measuredNumber,
  credits: measuredNumber,
});
export type PeriodTotals = z.infer<typeof periodTotalsSchema>;

export const breakdownRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  host: hostSchema.nullable(),
  sessions: z.number(),
  turns: z.number(),
  inputTokens: measuredNumber,
  outputTokens: measuredNumber,
  credits: measuredNumber,
});
export type BreakdownRow = z.infer<typeof breakdownRowSchema>;

export const overviewSchema = z.object({
  today: periodTotalsSchema,
  month: periodTotalsSchema,
  failureRate: measuredNumber,
  byModel: z.array(breakdownRowSchema),
  byWorkspace: z.array(breakdownRowSchema),
  hostSplit: z.array(z.object({ host: hostSchema, turns: z.number(), sessions: z.number() })),
});
export type Overview = z.infer<typeof overviewSchema>;
```

Run: `pnpm vitest run src/shared/dto.test.ts` — Expected: PASS.

- [ ] **Step 2: Add the test support helpers** — `test/fixtures/sessions.ts`

```ts
import { readFileSync } from 'node:fs';
import { normalizeChatSession } from '../../src/core/ingest/chatSession';
import { replayMutationLog } from '../../src/core/ingest/mutationLog';
import type { NormalizedSession } from '../../src/core/ingest/types';
import { applyCaptureLevel, type CaptureLevel } from '../../src/core/privacy/captureLevel';
import { Database } from '../../src/core/storage/database';
import { SessionStore } from '../../src/core/storage/sessionStore';
import { fixturePath } from './fixtures';

export function loadFixtureSession(
  name: string,
  workspace: string,
  level: CaptureLevel = 'full',
): NormalizedSession {
  const state = replayMutationLog(readFileSync(fixturePath(name), 'utf8')).state;
  const session = normalizeChatSession(state, { file: name, workspace });
  if (session === null) throw new Error(`fixture ${name} failed to normalize`);
  return applyCaptureLevel(session, level);
}

/** A copy of `session` under a new id, shifted in time (for paging and ordering tests). */
export function cloneSession(session: NormalizedSession, id: string, shiftMs: number): NormalizedSession {
  const shift = (value: number | null): number | null => (value === null ? null : value + shiftMs);
  return {
    ...session,
    id,
    startedAt: session.startedAt + shiftMs,
    endedAt: session.endedAt + shiftMs,
    turns: session.turns.map((turn) => ({
      ...turn,
      startedAt: shift(turn.startedAt),
      endedAt: shift(turn.endedAt),
    })),
  };
}

/** In-memory database with `fx-auto-1` (workspace alpha) and `fx-byok-1` (workspace beta). */
export function seededStore(level: CaptureLevel = 'full') {
  const database = new Database(':memory:');
  const sessions = new SessionStore(database);
  sessions.replaceSession(loadFixtureSession('auto-agent-session.jsonl', 'alpha', level), level, 1);
  sessions.replaceSession(loadFixtureSession('byok-failed-session.jsonl', 'beta', level), level, 1);
  return { database, sessions };
}
```

- [ ] **Step 3: Write the failing measure and routing tests**

`src/core/query/measure.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { known, summed, toTurnState } from './measure';

describe('measure', () => {
  it('is exact only when every expected row reported a value', () => {
    expect(summed(10, 3, 3, 'src')).toEqual({ value: 10, provenance: { kind: 'exact', source: 'src' } });
  });

  it('is a derived lower bound when some rows are missing', () => {
    const result = summed(10, 1, 3, 'src');
    expect(result.value).toBe(10);
    expect(result.provenance.kind).toBe('derived');
    expect(result.provenance.source).toContain('1 of 3');
  });

  it('is unavailable (not zero) when no row reported a value', () => {
    expect(summed(null, 0, 3, 'src').value).toBeNull();
    expect(summed(null, 0, 3, 'src').provenance.kind).toBe('unavailable');
    expect(summed(0, 0, 0, 'src').provenance.kind).toBe('unavailable');
  });

  it('wraps a single nullable value', () => {
    expect(known(5, 's').provenance.kind).toBe('exact');
    expect(known(null, 's').provenance.kind).toBe('unavailable');
  });

  it('narrows unknown state strings', () => {
    expect(toTurnState('failed')).toBe('failed');
    expect(toTurnState('weird')).toBe('unknown');
    expect(toTurnState(null)).toBe('unknown');
  });
});
```

`src/core/query/routing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { routingFor } from './routing';

describe('routingFor', () => {
  it('labels Auto routing with the resolved model', () => {
    expect(routingFor([{ mode: 'AUTO', model: 'gpt-5.6-luna' }])).toEqual({
      kind: 'auto',
      label: 'Auto → gpt-5.6-luna',
    });
  });

  it('labels manual choices and strips provider prefixes', () => {
    expect(routingFor([{ mode: 'MANUAL', model: 'ollama/Ollama/qwen3.5:35b' }])).toEqual({
      kind: 'manual',
      label: 'Manual · qwen3.5:35b',
    });
  });

  it('reports mixed routing and collapses long lists', () => {
    const mixed = routingFor([
      { mode: 'AUTO', model: 'a' },
      { mode: 'MANUAL', model: 'b' },
      { mode: 'MANUAL', model: 'c' },
    ]);
    expect(mixed.kind).toBe('mixed');
    expect(mixed.label).toBe('Auto → a, Manual · b +1 more');
  });

  it('handles unknown mode and missing model', () => {
    expect(routingFor([{ mode: 'UNKNOWN', model: null }])).toEqual({
      kind: 'unknown',
      label: 'Unknown model',
    });
    expect(routingFor([])).toEqual({ kind: 'unknown', label: 'Unknown' });
  });
});
```

Run: `pnpm vitest run src/core/query` — Expected: FAIL (modules not found).

- [ ] **Step 4: Implement measure and routing**

`src/core/query/measure.ts`:

```ts
import { derived, exact, unavailable, type Measured } from '../../shared/provenance';
import type { TurnState } from '../ingest/types';

/** Names the concrete Copilot fields these numbers come from (shown in provenance tooltips). */
export const SOURCES = {
  inputTokens: 'chatSessions.promptTokens',
  outputTokens: 'chatSessions.completionTokens',
  credits: 'chatSessions.copilotCredits',
} as const;

/**
 * Trust level of a sum of nullable per-turn values. `withValue` is how many turns reported a value and
 * `expected` how many should have: exact when all did, a derived lower bound when only some did, and
 * unavailable (never zero) when none did.
 */
export function summed(
  sum: number | null,
  withValue: number,
  expected: number,
  source: string,
): Measured<number> {
  if (sum === null || withValue === 0) return unavailable(source);
  if (withValue >= expected) return exact(sum, source);
  return derived(
    sum,
    `${source} (lower bound: ${String(withValue)} of ${String(expected)} turns reported it)`,
  );
}

export function known(value: number | null, source: string): Measured<number> {
  return value === null ? unavailable(source) : exact(value, source);
}

const TURN_STATES: readonly TurnState[] = ['pending', 'complete', 'cancelled', 'failed', 'unknown'];

export function toTurnState(value: string | null): TurnState {
  return TURN_STATES.find((state) => state === value) ?? 'unknown';
}
```

`src/core/query/routing.ts`:

```ts
import type { Routing } from '../../shared/dto';
import { modelNameFromId } from '../ingest/chatSession';

export interface RoutingEntry {
  mode: string;
  model: string | null;
}

/** Human label for how models were chosen: "Auto → X" (Copilot picked), "Manual · X" (user picked). */
export function routingFor(entries: readonly RoutingEntry[]): Routing {
  const parts = new Map<string, 'auto' | 'manual' | 'unknown'>();
  for (const entry of entries) {
    const name = entry.model === null ? 'Unknown model' : modelNameFromId(entry.model);
    const kind = entry.mode === 'AUTO' ? 'auto' : entry.mode === 'MANUAL' ? 'manual' : 'unknown';
    const label = kind === 'auto' ? `Auto → ${name}` : kind === 'manual' ? `Manual · ${name}` : name;
    if (!parts.has(label)) parts.set(label, kind);
  }
  const labels = [...parts.keys()];
  const known = [...new Set([...parts.values()].filter((kind) => kind !== 'unknown'))];
  const kind = known.length === 0 ? 'unknown' : known.length === 1 ? (known[0] ?? 'unknown') : 'mixed';
  const [first, second] = labels;
  const label =
    first === undefined
      ? 'Unknown'
      : second === undefined || labels.length === 2
        ? labels.join(', ')
        : `${first}, ${second} +${String(labels.length - 2)} more`;
  return { kind, label };
}
```

Run: `pnpm vitest run src/core/query` — Expected: PASS (9 tests).

- [ ] **Step 5: Write the failing session-list tests** — `src/core/query/sessionList.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { cloneSession, loadFixtureSession, seededStore } from '../../../test/fixtures/sessions';
import { listSessions } from './sessionList';

const page = { offset: 0, limit: 50 };

describe('listSessions', () => {
  it('returns newest first with exact totals and routing', () => {
    const { database } = seededStore();
    const { rows, total } = listSessions(database, page);
    expect(total).toBe(2);
    expect(rows.map((row) => row.id)).toEqual(['fx-byok-1', 'fx-auto-1']);
    const auto = rows[1];
    expect(auto).toMatchObject({
      workspace: 'alpha',
      title: 'Fix run timeout race',
      turns: 2,
      failedTurns: 0,
      state: 'complete',
      outcome: null,
    });
    expect(auto?.routing).toEqual({ kind: 'auto', label: 'Auto → gpt-5.6-luna' });
    expect(auto?.inputTokens).toEqual({
      value: 54000,
      provenance: { kind: 'exact', source: 'chatSessions.promptTokens' },
    });
    expect(auto?.outputTokens.value).toBe(2600);
    expect(auto?.credits.value).toBeCloseTo(1.626141);
    expect(auto?.credits.provenance.kind).toBe('exact');
  });

  it('marks partial sums as derived and absent values as unavailable', () => {
    const { database } = seededStore();
    const byok = listSessions(database, page).rows[0];
    expect(byok).toMatchObject({
      id: 'fx-byok-1',
      workspace: 'beta',
      title: null,
      failedTurns: 1,
      state: 'cancelled',
    });
    expect(byok?.routing).toEqual({ kind: 'manual', label: 'Manual · qwen3.5:35b' });
    expect(byok?.inputTokens.value).toBe(5000);
    expect(byok?.inputTokens.provenance.kind).toBe('derived');
    expect(byok?.credits.value).toBeNull();
    expect(byok?.credits.provenance.kind).toBe('unavailable');
  });

  it('pages results and reports the total', () => {
    const { database, sessions } = seededStore();
    const base = loadFixtureSession('auto-agent-session.jsonl', 'alpha');
    for (let index = 0; index < 5; index++) {
      sessions.replaceSession(cloneSession(base, `clone-${String(index)}`, -(index + 1) * 60_000), 'full', 1);
    }
    const first = listSessions(database, { offset: 0, limit: 3 });
    const second = listSessions(database, { offset: 3, limit: 3 });
    expect(first.total).toBe(7);
    expect(first.rows).toHaveLength(3);
    expect(second.rows).toHaveLength(3);
    expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(6);
  });

  it('searches title, workspace, prompt text and model, case-insensitively', () => {
    const { database } = seededStore();
    const ids = (q: string) => listSessions(database, { ...page, q }).rows.map((row) => row.id);
    expect(ids('TIMEOUT')).toEqual(['fx-auto-1']);
    expect(ids('alpha')).toEqual(['fx-auto-1']);
    expect(ids('retry policy')).toEqual(['fx-byok-1']);
    expect(ids('qwen')).toEqual(['fx-byok-1']);
    expect(ids('luna')).toEqual(['fx-auto-1']);
    expect(ids('nothing matches this')).toEqual([]);
  });

  it('treats LIKE wildcards, quotes and SQL fragments in the search box literally', () => {
    const { database } = seededStore();
    const total = (q: string) => listSessions(database, { ...page, q }).total;
    expect(total('%')).toBe(0);
    expect(total('_')).toBe(0);
    expect(total("'; DROP TABLE sessions; --")).toBe(0);
    expect(total('\\')).toBe(0);
    expect(listSessions(database, page).total).toBe(2);
  });

  it('filters by failed turns, workspace and day range', () => {
    const { database } = seededStore();
    expect(listSessions(database, { ...page, failedOnly: true }).rows.map((row) => row.id)).toEqual([
      'fx-byok-1',
    ]);
    expect(listSessions(database, { ...page, workspace: 'alpha' }).rows.map((row) => row.id)).toEqual([
      'fx-auto-1',
    ]);
    const day = listSessions(database, page).rows[1]?.day ?? '';
    expect(listSessions(database, { ...page, fromDay: day, toDay: day }).rows.map((row) => row.id)).toContain(
      'fx-auto-1',
    );
    expect(listSessions(database, { ...page, toDay: '2000-01-01' }).total).toBe(0);
  });

  it('returns an empty page for an empty index', () => {
    const { database } = seededStore();
    database.db.exec('DELETE FROM sessions');
    expect(listSessions(database, page)).toEqual({ rows: [], total: 0 });
  });
});
```

Run: `pnpm vitest run src/core/query/sessionList.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 6: Implement `src/core/query/sessionList.ts`**

```ts
import type { SessionRow } from '../../shared/dto';
import type { Database, SqlValue } from '../storage/database';
import { SOURCES, summed, toTurnState } from './measure';
import { routingFor, type RoutingEntry } from './routing';

export interface SessionListQuery {
  q?: string;
  fromDay?: string;
  toDay?: string;
  workspace?: string;
  failedOnly?: boolean;
  offset: number;
  limit: number;
}

interface ListRow {
  id: string;
  day: string;
  started_at: number;
  workspace: string;
  title: string | null;
  turns: number;
  failed_turns: number;
  in_sum: number | null;
  in_known: number;
  out_sum: number | null;
  out_known: number;
  credit_sum: number | null;
  credit_known: number;
  billable: number;
  last_state: string | null;
}

export function listSessions(
  database: Pick<Database, 'db'>,
  query: SessionListQuery,
): { rows: SessionRow[]; total: number } {
  const { db } = database;
  const filter = buildFilter(query);
  const total = (
    db.prepare(`SELECT count(*) AS n FROM sessions s ${filter.where}`).get(filter.params) as unknown as {
      n: number;
    }
  ).n;
  const list = db
    .prepare(
      `SELECT s.id, s.day, s.started_at, s.workspace, s.title,
              count(t.idx) AS turns,
              coalesce(sum(t.state = 'failed'), 0) AS failed_turns,
              sum(t.prompt_tokens) AS in_sum, count(t.prompt_tokens) AS in_known,
              sum(t.completion_tokens) AS out_sum, count(t.completion_tokens) AS out_known,
              sum(t.credits) AS credit_sum, count(t.credits) AS credit_known,
              coalesce(sum(t.model_host <> 'byok'), 0) AS billable,
              (SELECT lt.state FROM turns lt WHERE lt.session_id = s.id ORDER BY lt.idx DESC LIMIT 1) AS last_state
         FROM sessions s LEFT JOIN turns t ON t.session_id = s.id
         ${filter.where}
        GROUP BY s.id
        ORDER BY s.started_at DESC, s.id
        LIMIT :limit OFFSET :offset`,
    )
    .all({ ...filter.params, limit: query.limit, offset: query.offset }) as unknown as ListRow[];
  const routing = routingBySession(
    database,
    list.map((row) => row.id),
  );
  const rows = list.map((row): SessionRow => ({
    id: row.id,
    day: row.day,
    startedAt: row.started_at,
    workspace: row.workspace,
    title: row.title,
    outcome: null,
    routing: routingFor(routing.get(row.id) ?? []),
    state: toTurnState(row.last_state),
    turns: row.turns,
    failedTurns: row.failed_turns,
    inputTokens: summed(row.in_sum, row.in_known, row.turns, SOURCES.inputTokens),
    outputTokens: summed(row.out_sum, row.out_known, row.turns, SOURCES.outputTokens),
    // Credits exist only for Copilot-hosted requests; BYOK turns are not expected to report any.
    credits: summed(row.credit_sum, row.credit_known, row.billable, SOURCES.credits),
  }));
  return { rows, total };
}

/** Escapes LIKE wildcards so user text always matches literally (paired with `ESCAPE '\'`). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildFilter(query: SessionListQuery): { where: string; params: Record<string, SqlValue> } {
  const clauses: string[] = [];
  const params: Record<string, SqlValue> = {};
  if (query.fromDay !== undefined) {
    clauses.push('s.day >= :fromDay');
    params.fromDay = query.fromDay;
  }
  if (query.toDay !== undefined) {
    clauses.push('s.day <= :toDay');
    params.toDay = query.toDay;
  }
  if (query.workspace !== undefined) {
    clauses.push('s.workspace = :workspace');
    params.workspace = query.workspace;
  }
  if (query.failedOnly === true) {
    clauses.push("EXISTS (SELECT 1 FROM turns ft WHERE ft.session_id = s.id AND ft.state = 'failed')");
  }
  const text = query.q?.trim().toLowerCase();
  if (text !== undefined && text !== '') {
    params.q = `%${escapeLike(text)}%`;
    clauses.push(
      `(lower(coalesce(s.title, '')) LIKE :q ESCAPE '\\'
        OR lower(s.workspace) LIKE :q ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM turns qt WHERE qt.session_id = s.id
             AND (lower(coalesce(qt.user_text, '')) LIKE :q ESCAPE '\\'
               OR lower(coalesce(qt.resolved_model, qt.requested_model, '')) LIKE :q ESCAPE '\\')))`,
    );
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function routingBySession(
  database: Pick<Database, 'db'>,
  ids: readonly string[],
): Map<string, RoutingEntry[]> {
  const result = new Map<string, RoutingEntry[]>();
  if (ids.length === 0) return result;
  const rows = database.db
    .prepare(
      `SELECT session_id, selection_mode AS mode, coalesce(resolved_model, requested_model) AS model
         FROM turns
        WHERE session_id IN (SELECT value FROM json_each(:ids))
        GROUP BY session_id, selection_mode, coalesce(resolved_model, requested_model)
        ORDER BY session_id, min(idx)`,
    )
    .all({ ids: JSON.stringify(ids) }) as unknown as {
    session_id: string;
    mode: string;
    model: string | null;
  }[];
  for (const row of rows) {
    const entries = result.get(row.session_id) ?? [];
    entries.push({ mode: row.mode, model: row.model });
    result.set(row.session_id, entries);
  }
  return result;
}
```

Run: `pnpm vitest run src/core/query/sessionList.test.ts` — Expected: PASS (7 tests).

- [ ] **Step 7: Write the failing session-detail tests** — `src/core/query/sessionDetail.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { getSessionDetail } from './sessionDetail';

describe('getSessionDetail', () => {
  it('returns null for an unknown id', () => {
    expect(getSessionDetail(seededStore().database, 'nope')).toBeNull();
  });

  it('returns session totals and per-turn measurements with provenance', () => {
    const detail = getSessionDetail(seededStore().database, 'fx-auto-1');
    expect(detail).toMatchObject({
      id: 'fx-auto-1',
      workspace: 'alpha',
      title: 'Fix run timeout race',
      captureLevel: 'full',
      analysis: null,
    });
    expect(detail?.inputTokens.value).toBe(54000);
    expect(detail?.inputTokens.provenance.kind).toBe('exact');
    expect(detail?.turns.map((turn) => turn.index)).toEqual([1, 2]);
    const first = detail?.turns[0];
    expect(first).toMatchObject({
      state: 'complete',
      systemInitiated: false,
      host: 'copilot',
      model: 'gpt-5.6-luna',
      compactions: 1,
    });
    expect(first?.userText).toContain('Fix the timeout race');
    expect(first?.inputTokens).toEqual({
      value: 24000,
      provenance: { kind: 'exact', source: 'chatSessions.promptTokens' },
    });
    expect(first?.credits.value).toBeCloseTo(1.126141);
    expect(first?.routing).toEqual({ kind: 'auto', label: 'Auto → gpt-5.6-luna' });
  });

  it('lists tool names and file events but never tool arguments', () => {
    const turn = getSessionDetail(seededStore().database, 'fx-auto-1')?.turns[0];
    expect(turn?.toolCalls.map((call) => call.name)).toEqual(['read_file', 'replace_string_in_file']);
    expect(turn?.toolCalls[0]).toEqual({ name: 'read_file', status: expect.any(String) as string });
    expect(turn?.fileEvents).toContainEqual({ path: '/repo/src/execution/manager.ts', action: 'edited' });
    expect(JSON.stringify(turn)).not.toContain('"args"');
  });

  it('marks missing measurements unavailable and keeps system-initiated turns', () => {
    const detail = getSessionDetail(seededStore().database, 'fx-byok-1');
    expect(detail?.turns[0]?.inputTokens.provenance.kind).toBe('unavailable');
    expect(detail?.turns[0]).toMatchObject({ state: 'failed', host: 'byok' });
    expect(detail?.turns[1]).toMatchObject({ state: 'cancelled', systemInitiated: true });
    expect(detail?.inputTokens.provenance.kind).toBe('derived');
    expect(detail?.credits.provenance.kind).toBe('unavailable');
  });

  it('has no conversation text at the metrics capture level', () => {
    const detail = getSessionDetail(seededStore('metrics').database, 'fx-auto-1');
    expect(detail?.title).toBeNull();
    expect(detail?.turns.every((turn) => turn.userText === null && turn.assistantText === null)).toBe(true);
    expect(detail?.turns[0]?.inputTokens.value).toBe(24000);
  });
});
```

Run: `pnpm vitest run src/core/query/sessionDetail.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 8: Implement `src/core/query/sessionDetail.ts`**

```ts
import type { SessionDetail, TurnDetail } from '../../shared/dto';
import { modelNameFromId } from '../ingest/chatSession';
import { isCaptureLevel } from '../privacy/captureLevel';
import type { Database } from '../storage/database';
import { known, SOURCES, summed, toTurnState } from './measure';
import { routingFor } from './routing';

interface SessionHeader {
  id: string;
  workspace: string;
  title: string | null;
  day: string;
  started_at: number;
  ended_at: number;
  active_ms: number;
  capture_level: string;
}

interface TurnRow {
  idx: number;
  started_at: number | null;
  state: string;
  system_initiated: number;
  mode: string | null;
  user_text: string | null;
  assistant_text: string | null;
  requested_model: string | null;
  resolved_model: string | null;
  selection_mode: string;
  model_host: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  credits: number | null;
  reasoning_ms: number;
  tool_rounds: number;
  compactions: string;
  error_code: string | null;
  error_message: string | null;
}

export function getSessionDetail(database: Pick<Database, 'db'>, id: string): SessionDetail | null {
  const { db } = database;
  const header = db
    .prepare(
      'SELECT id, workspace, title, day, started_at, ended_at, active_ms, capture_level FROM sessions WHERE id = :id',
    )
    .get({ id }) as unknown as SessionHeader | undefined;
  if (header === undefined) return null;
  const turnRows = db
    .prepare(
      `SELECT idx, started_at, state, system_initiated, mode, user_text, assistant_text, requested_model,
              resolved_model, selection_mode, model_host, prompt_tokens, completion_tokens, credits,
              reasoning_ms, tool_rounds, compactions, error_code, error_message
         FROM turns WHERE session_id = :id ORDER BY idx`,
    )
    .all({ id }) as unknown as TurnRow[];
  const tools = groupBy(
    db
      .prepare('SELECT turn_idx, name, status FROM tool_calls WHERE session_id = :id ORDER BY turn_idx, seq')
      .all({ id }) as unknown as { turn_idx: number; name: string; status: string }[],
    (row) => row.turn_idx,
  );
  const files = groupBy(
    db
      .prepare('SELECT turn_idx, path, action FROM file_events WHERE session_id = :id ORDER BY turn_idx, seq')
      .all({ id }) as unknown as { turn_idx: number; path: string; action: string }[],
    (row) => row.turn_idx,
  );

  const turns = turnRows.map((row): TurnDetail => {
    const model = row.resolved_model ?? row.requested_model;
    return {
      index: row.idx,
      startedAt: row.started_at,
      state: toTurnState(row.state),
      systemInitiated: row.system_initiated === 1,
      mode: row.mode,
      userText: row.user_text,
      assistantText: row.assistant_text,
      routing: routingFor([{ mode: row.selection_mode, model }]),
      model: model === null ? null : modelNameFromId(model),
      host: row.model_host === 'copilot' || row.model_host === 'byok' ? row.model_host : 'unknown',
      inputTokens: known(row.prompt_tokens, SOURCES.inputTokens),
      outputTokens: known(row.completion_tokens, SOURCES.outputTokens),
      credits: known(row.credits, SOURCES.credits),
      reasoningMs: row.reasoning_ms,
      toolRounds: row.tool_rounds,
      compactions: countJsonArray(row.compactions),
      toolCalls: (tools.get(row.idx) ?? []).map((call) => ({ name: call.name, status: call.status })),
      fileEvents: (files.get(row.idx) ?? []).map((file) => ({ path: file.path, action: file.action })),
      errorCode: row.error_code,
      errorMessage: row.error_message,
    };
  });

  const total = (pick: (row: TurnRow) => number | null, source: string, expected = turnRows.length) => {
    const values = turnRows.map(pick).filter((value): value is number => value !== null);
    return summed(
      values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0),
      values.length,
      expected,
      source,
    );
  };
  return {
    id: header.id,
    workspace: header.workspace,
    title: header.title,
    day: header.day,
    startedAt: header.started_at,
    endedAt: header.ended_at,
    activeMs: header.active_ms,
    captureLevel: isCaptureLevel(header.capture_level) ? header.capture_level : 'metrics',
    inputTokens: total((row) => row.prompt_tokens, SOURCES.inputTokens),
    outputTokens: total((row) => row.completion_tokens, SOURCES.outputTokens),
    credits: total(
      (row) => row.credits,
      SOURCES.credits,
      turnRows.filter((row) => row.model_host !== 'byok').length,
    ),
    analysis: null,
    turns,
  };
}

function groupBy<T>(rows: readonly T[], key: (row: T) => number): Map<number, T[]> {
  const result = new Map<number, T[]>();
  for (const row of rows) {
    const group = result.get(key(row)) ?? [];
    group.push(row);
    result.set(key(row), group);
  }
  return result;
}

function countJsonArray(text: string): number {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
```

Run: `pnpm vitest run src/core/query/sessionDetail.test.ts` — Expected: PASS (5 tests).

- [ ] **Step 9: Write the failing overview tests** — `src/core/query/overview.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { localDay } from '../time';
import { getOverview } from './overview';

const BYOK_START = 1790100000000;
const AUTO_START = 1790000001000;

describe('getOverview', () => {
  it('buckets today by the local day of each turn', () => {
    const { database } = seededStore();
    const overview = getOverview(database, localDay(AUTO_START));
    expect(overview.today).toMatchObject({
      from: localDay(AUTO_START),
      to: localDay(AUTO_START),
      sessions: 1,
      turns: 2,
    });
    expect(overview.today.inputTokens).toEqual({
      value: 54000,
      provenance: { kind: 'exact', source: 'chatSessions.promptTokens' },
    });
    expect(overview.today.outputTokens.value).toBe(2600);
    expect(overview.today.credits.value).toBeCloseTo(1.626141);
    expect(overview.today.credits.provenance.kind).toBe('exact');
  });

  it('sums the month, keeping partial data derived and BYOK out of the credit expectation', () => {
    const { database } = seededStore();
    const today = localDay(BYOK_START);
    const overview = getOverview(database, today);
    expect(overview.month.from).toBe(`${today.slice(0, 8)}01`);
    expect(overview.month).toMatchObject({ sessions: 2, turns: 4 });
    expect(overview.month.inputTokens.value).toBe(59000);
    expect(overview.month.inputTokens.provenance.kind).toBe('derived');
    expect(overview.month.credits.value).toBeCloseTo(1.626141);
    expect(overview.month.credits.provenance.kind).toBe('exact');
  });

  it('reports the failure rate over finished, user-initiated turns as derived', () => {
    const overview = getOverview(seededStore().database, localDay(BYOK_START));
    // Finished user turns: two complete (auto) + one failed (byok); the cancelled turn is system-initiated.
    expect(overview.failureRate.value).toBeCloseTo(1 / 3);
    expect(overview.failureRate.provenance.kind).toBe('derived');
  });

  it('breaks usage down by model, workspace and host', () => {
    const overview = getOverview(seededStore().database, localDay(BYOK_START));
    expect(overview.byModel.map((row) => [row.label, row.host, row.turns])).toEqual([
      ['gpt-5.6-luna', 'copilot', 2],
      ['qwen3.5:35b', 'byok', 2],
    ]);
    expect(overview.byWorkspace.map((row) => [row.label, row.turns])).toEqual([
      ['alpha', 2],
      ['beta', 2],
    ]);
    expect(overview.hostSplit).toEqual([
      { host: 'byok', turns: 2, sessions: 1 },
      { host: 'copilot', turns: 2, sessions: 1 },
    ]);
  });

  it('is empty and unavailable, not zero, on an empty index', () => {
    const { database } = seededStore();
    database.db.exec('DELETE FROM sessions');
    const overview = getOverview(database, '2026-09-30');
    expect(overview.today).toMatchObject({ sessions: 0, turns: 0 });
    expect(overview.today.inputTokens.value).toBeNull();
    expect(overview.failureRate.provenance.kind).toBe('unavailable');
    expect(overview.byModel).toEqual([]);
  });
});
```

Run: `pnpm vitest run src/core/query/overview.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 10: Implement `src/core/query/overview.ts`**

```ts
import type { BreakdownRow, Overview, PeriodTotals } from '../../shared/dto';
import { derived, unavailable } from '../../shared/provenance';
import { modelNameFromId } from '../ingest/chatSession';
import type { Database } from '../storage/database';
import { SOURCES, summed } from './measure';

interface SumRow {
  sessions: number;
  turns: number;
  in_sum: number | null;
  in_known: number;
  out_sum: number | null;
  out_known: number;
  credit_sum: number | null;
  credit_known: number;
  billable: number;
}

const SUMS = `count(DISTINCT t.session_id) AS sessions, count(*) AS turns,
  sum(t.prompt_tokens) AS in_sum, count(t.prompt_tokens) AS in_known,
  sum(t.completion_tokens) AS out_sum, count(t.completion_tokens) AS out_known,
  sum(t.credits) AS credit_sum, count(t.credits) AS credit_known,
  coalesce(sum(t.model_host <> 'byok'), 0) AS billable`;

/** `today` is a local YYYY-MM-DD day; the month runs from the 1st of that day's month through `today`. */
export function getOverview(database: Pick<Database, 'db'>, today: string): Overview {
  const monthStart = `${today.slice(0, 8)}01`;
  return {
    today: periodTotals(database, today, today),
    month: periodTotals(database, monthStart, today),
    failureRate: failureRate(database, monthStart, today),
    byModel: breakdown(database, 'model', monthStart, today),
    byWorkspace: breakdown(database, 'workspace', monthStart, today),
    hostSplit: hostSplit(database, monthStart, today),
  };
}

function measures(row: SumRow) {
  return {
    sessions: row.sessions,
    turns: row.turns,
    inputTokens: summed(row.in_sum, row.in_known, row.turns, SOURCES.inputTokens),
    outputTokens: summed(row.out_sum, row.out_known, row.turns, SOURCES.outputTokens),
    credits: summed(row.credit_sum, row.credit_known, row.billable, SOURCES.credits),
  };
}

function periodTotals(database: Pick<Database, 'db'>, from: string, to: string): PeriodTotals {
  const row = database.db
    .prepare(`SELECT ${SUMS} FROM turns t WHERE t.day >= :from AND t.day <= :to`)
    .get({ from, to }) as unknown as SumRow;
  return { from, to, ...measures(row) };
}

function failureRate(database: Pick<Database, 'db'>, from: string, to: string) {
  const row = database.db
    .prepare(
      `SELECT coalesce(sum(state = 'failed'), 0) AS failed, coalesce(sum(state IN ('complete', 'failed')), 0) AS finished
         FROM turns WHERE system_initiated = 0 AND day >= :from AND day <= :to`,
    )
    .get({ from, to }) as unknown as { failed: number; finished: number };
  const source = 'turns.state (failed ÷ finished user-initiated turns; cancelled and system turns excluded)';
  return row.finished === 0 ? unavailable<number>(source) : derived(row.failed / row.finished, source);
}

function breakdown(
  database: Pick<Database, 'db'>,
  by: 'model' | 'workspace',
  from: string,
  to: string,
): BreakdownRow[] {
  const keyExpr = by === 'model' ? "coalesce(t.resolved_model, t.requested_model, 'unknown')" : 's.workspace';
  const hostExpr = by === 'model' ? 't.model_host' : 'NULL';
  const rows = database.db
    .prepare(
      `SELECT ${keyExpr} AS group_key, ${hostExpr} AS host, ${SUMS}
         FROM turns t JOIN sessions s ON s.id = t.session_id
        WHERE t.day >= :from AND t.day <= :to
        GROUP BY group_key, host
        ORDER BY turns DESC, group_key`,
    )
    .all({ from, to }) as unknown as (SumRow & { group_key: string; host: string | null })[];
  return rows.map((row) => ({
    key: row.group_key,
    label:
      by === 'model'
        ? row.group_key === 'unknown'
          ? 'Unknown model'
          : modelNameFromId(row.group_key)
        : row.group_key,
    host: row.host === 'copilot' || row.host === 'byok' ? row.host : row.host === null ? null : 'unknown',
    ...measures(row),
  }));
}

function hostSplit(database: Pick<Database, 'db'>, from: string, to: string): Overview['hostSplit'] {
  const rows = database.db
    .prepare(
      `SELECT model_host AS host, count(*) AS turns, count(DISTINCT session_id) AS sessions
         FROM turns WHERE day >= :from AND day <= :to GROUP BY model_host ORDER BY model_host`,
    )
    .all({ from, to }) as unknown as { host: string; turns: number; sessions: number }[];
  return rows.map((row) => ({
    host: row.host === 'copilot' || row.host === 'byok' ? row.host : 'unknown',
    turns: row.turns,
    sessions: row.sessions,
  }));
}
```

Run: `pnpm vitest run src/core/query` — Expected: PASS (all query tests).

- [ ] **Step 11: Verify and commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(query): add provenance-aware session list, detail and overview queries"
```

---

## Task 2.3: Analysis v1 (port and fix) with a versioned cache

**Files:**

- Create: `test/fixtures/turns.ts`, `src/core/analysis/intent.ts`, `intent.test.ts`, `changes.ts`,
  `changes.test.ts`, `complexity.ts`, `complexity.test.ts`, `findings.ts`, `findings.test.ts`,
  `analyzeSession.ts`, `analyzeSession.test.ts`, `analysisStore.ts`, `analysisStore.test.ts`,
  `src/core/query/insightsQueries.ts`, `src/core/query/insightsQueries.test.ts`
- Modify: `src/core/storage/migrations.ts` (add v2), `src/core/storage/sessionStore.ts` (invalidate cached analysis
  when content changes), `src/core/storage/sessionStore.test.ts`

**Interfaces:**

- Consumes: `SessionDetail`, `TurnDetail`, `Analysis` (2.2); `getSessionDetail`, `listSessions`, `getOverview` (2.2).
- Produces: `classifyIntent(prompt)`, `summarizeChanges(turns)`, `buildOutcome(summary, turns)`,
  `estimateComplexity(input)`, `promptFindings(turns)`, `analyzeSession(input): Analysis`, `ANALYZER_VERSION`,
  `class AnalysisStore { get(id): Analysis | null; forDetail(detail): Analysis }`,
  `class InsightsQueries { listSessions(query): SessionList; getSession(id): SessionDetail | null; getOverview(today): Overview }`.
- Behavioural rules (from the spec, §2 and the roadmap): system-initiated turns are excluded from prompt
  findings; "failed" comes from turn `state`, never from text; nothing is computed from text that was not
  stored (metrics level → intent and prompt findings are `unavailable`); every analysis field is `derived` or
  `inferred`, never `exact`.

- [ ] **Step 1: Migration v2 and cache invalidation (test first)**

Append to `src/core/storage/database.test.ts` inside the existing `describe`:

```ts
it('creates the analysis cache table', () => {
  const database = new Database(':memory:');
  const tables = (
    database.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  ).map((row) => row.name);
  expect(tables).toContain('session_analysis');
});
```

Append to `src/core/storage/sessionStore.test.ts` inside the `SessionStore` describe:

```ts
it('drops cached analysis when content is cleared or downgraded', () => {
  const { database, sessions } = newStore();
  const cached = () =>
    (database.db.prepare('SELECT count(*) AS n FROM session_analysis').get() as { n: number }).n;
  sessions.replaceSession(fixture(), 'full', 1);
  database.db
    .prepare(
      "INSERT INTO session_analysis (session_id, analyzer_version, ingested_at, json) VALUES ('fx-auto-1', 1, 1, '{}')",
    )
    .run();
  sessions.downgradeStoredContent('summaries');
  expect(cached()).toBe(0);
  database.db
    .prepare(
      "INSERT INTO session_analysis (session_id, analyzer_version, ingested_at, json) VALUES ('fx-auto-1', 1, 1, '{}')",
    )
    .run();
  sessions.clearContent(['fx-auto-1']);
  expect(cached()).toBe(0);
});
```

Run: `pnpm vitest run src/core/storage` — Expected: FAIL (`no such table: session_analysis`).

In `src/core/storage/migrations.ts`, append a second entry to `MIGRATIONS`:

```ts
  `
  CREATE TABLE session_analysis (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    analyzer_version INTEGER NOT NULL,
    ingested_at INTEGER NOT NULL,
    json TEXT NOT NULL
  );
  `,
```

In `src/core/storage/sessionStore.ts`:

- in `clearContent`, inside the transaction, add before the `UPDATE sessions` statement:

```ts
db.prepare(`DELETE FROM session_analysis WHERE session_id IN (${IDS})`).run(params);
```

- in `downgradeStoredContent`, in the `summaries` branch transaction, add before the `UPDATE sessions` statement:

```ts
db.exec(`DELETE FROM session_analysis WHERE session_id IN (${full})`);
```

Run: `pnpm vitest run src/core/storage` — Expected: PASS.

- [ ] **Step 2: Add the turn test helper** — `test/fixtures/turns.ts`

```ts
import type { TurnDetail } from '../../src/shared/dto';
import { unavailable } from '../../src/shared/provenance';

/** A minimal `TurnDetail` for analysis tests; override only what a test cares about. */
export function makeTurn(overrides: Partial<TurnDetail> & { index: number }): TurnDetail {
  return {
    startedAt: null,
    state: 'complete',
    systemInitiated: false,
    mode: null,
    userText: null,
    assistantText: null,
    routing: { kind: 'unknown', label: 'Unknown' },
    model: null,
    host: 'copilot',
    inputTokens: unavailable('test'),
    outputTokens: unavailable('test'),
    credits: unavailable('test'),
    reasoningMs: 0,
    toolRounds: 0,
    compactions: 0,
    toolCalls: [],
    fileEvents: [],
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}
```

- [ ] **Step 3: Write the failing rule tests**

`src/core/analysis/intent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifyIntent } from './intent';

describe('classifyIntent', () => {
  it.each([
    ['Fix the timeout race in src/execution/manager.ts', 'bugfix'],
    ['Explain the retry policy', 'explain'],
    ['Add a dark mode toggle to settings', 'feature'],
    ['Refactor the parser into smaller functions', 'refactor'],
    ['Write unit tests for the scanner', 'test'],
    ['Update the README with install steps', 'docs'],
    ['Configure eslint and install prettier', 'config'],
    ['Why is this crashing with a stack trace?', 'debug'],
    ['hello there', 'other'],
  ])('%s → %s', (prompt, expected) => {
    expect(classifyIntent(prompt).intent).toBe(expected);
  });

  it('reports the words that decided the intent', () => {
    expect(classifyIntent('Fix the timeout race').matched).toBe('fix');
    expect(classifyIntent('hello there').matched).toBe('');
  });
});
```

`src/core/analysis/changes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeTurn } from '../../../test/fixtures/turns';
import { buildOutcome, summarizeChanges } from './changes';

const turns = [
  makeTurn({
    index: 1,
    fileEvents: [
      { path: '/repo/src/execution/manager.ts', action: 'read' },
      { path: '/repo/src/execution/manager.ts', action: 'edited' },
    ],
    toolCalls: [
      { name: 'read_file', status: 'complete' },
      { name: 'run_in_terminal', status: 'complete' },
    ],
  }),
  makeTurn({
    index: 2,
    fileEvents: [
      { path: '/repo/test/manager.test.ts', action: 'created' },
      { path: '/repo/src/execution/manager.ts', action: 'kept' },
    ],
  }),
  makeTurn({
    index: 3,
    fileEvents: [
      { path: '/repo/src/execution/manager.ts', action: 'edited' },
      { path: '/repo/docs/x.md', action: 'deleted' },
      { path: '/repo/src/old.ts', action: 'undone' },
    ],
  }),
];

describe('summarizeChanges', () => {
  it('counts distinct changed files by strongest action and ignores reads and keeps', () => {
    const summary = summarizeChanges(turns);
    expect(summary).toMatchObject({ edited: 1, created: 1, deleted: 1, undone: 1, commandCount: 1 });
    expect(summary.changed.map((file) => file.path).sort()).toEqual([
      '/repo/docs/x.md',
      '/repo/src/execution/manager.ts',
      '/repo/test/manager.test.ts',
    ]);
  });

  it('names the directories touched, most-touched first, at most three', () => {
    expect(summarizeChanges(turns).areas).toEqual(['docs', 'execution', 'test']);
  });

  it('understands Windows separators', () => {
    const summary = summarizeChanges([
      makeTurn({ index: 1, fileEvents: [{ path: 'C:\\repo\\src\\a.ts', action: 'edited' }] }),
    ]);
    expect(summary.areas).toEqual(['src']);
  });
});

describe('buildOutcome', () => {
  it('summarizes changes, commands, undone edits and areas in one sentence', () => {
    expect(buildOutcome(summarizeChanges(turns), turns)).toBe(
      'Changed 3 files (1 edited, 1 created, 1 deleted), ran 1 terminal command, 1 edit undone — in docs, execution, test.',
    );
  });

  it('reports failures from turn state and excludes system-initiated turns', () => {
    const failed = [
      makeTurn({ index: 1, state: 'failed' }),
      makeTurn({ index: 2, state: 'cancelled', systemInitiated: true }),
    ];
    expect(buildOutcome(summarizeChanges(failed), failed)).toBe('No files changed, 1 of 1 turn failed.');
  });
});
```

`src/core/analysis/complexity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { estimateComplexity } from './complexity';

describe('estimateComplexity', () => {
  it('scores turns, tool calls, changed files and compactions', () => {
    expect(estimateComplexity({ userTurns: 1, toolCalls: 0, changedFiles: 0, compactions: 0 })).toBe(
      'simple',
    );
    expect(estimateComplexity({ userTurns: 2, toolCalls: 3, changedFiles: 2, compactions: 1 })).toBe(
      'moderate',
    );
    expect(estimateComplexity({ userTurns: 20, toolCalls: 40, changedFiles: 10, compactions: 3 })).toBe(
      'complex',
    );
  });
});
```

`src/core/analysis/findings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeTurn } from '../../../test/fixtures/turns';
import { promptFindings } from './findings';

const ids = (turns: Parameters<typeof promptFindings>[0]) =>
  promptFindings(turns).map((finding) => finding.id);

describe('promptFindings', () => {
  it('flags a very short opening prompt', () => {
    expect(ids([makeTurn({ index: 1, userText: 'fix it' })])).toContain('vague-first-prompt');
    expect(
      ids([makeTurn({ index: 1, userText: 'Fix the timeout race in src/execution/manager.ts' })]),
    ).not.toContain('vague-first-prompt');
  });

  it('flags repeated corrections from user turns only', () => {
    const turns = [
      makeTurn({ index: 1, userText: 'Refactor the scanner into smaller functions please' }),
      makeTurn({ index: 2, userText: 'No, that is wrong' }),
      makeTurn({ index: 3, userText: 'Still failing after your change' }),
      makeTurn({ index: 4, systemInitiated: true, userText: 'still running' }),
    ];
    const finding = promptFindings(turns).find((item) => item.id === 'repeated-corrections');
    expect(finding?.evidence).toBe('2 follow-up prompts read as corrections (turns 2, 3)');
  });

  it('flags long sessions by user turns or compactions', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      makeTurn({ index: index + 1, userText: 'a'.repeat(40) }),
    );
    expect(ids(many)).toContain('long-session');
    expect(ids([makeTurn({ index: 1, userText: 'a'.repeat(40), compactions: 2 })])).toContain('long-session');
  });

  it('flags repeated failures from state, even without any stored text', () => {
    const turns = [
      makeTurn({ index: 1, state: 'failed' }),
      makeTurn({ index: 2, state: 'failed' }),
      makeTurn({ index: 3 }),
    ];
    const finding = promptFindings(turns).find((item) => item.id === 'repeated-failures');
    expect(finding?.evidence).toBe('2 of 3 turns failed');
    expect(ids(turns)).not.toContain('vague-first-prompt');
  });

  it('returns nothing for a healthy session', () => {
    expect(
      ids([makeTurn({ index: 1, userText: 'Add retry logic to the fetch helper with a 3 attempt limit' })]),
    ).toEqual([]);
  });
});
```

Run: `pnpm vitest run src/core/analysis` — Expected: FAIL (modules not found).

- [ ] **Step 4: Implement the rules**

`src/core/analysis/intent.ts`:

```ts
export type Intent =
  'debug' | 'bugfix' | 'refactor' | 'test' | 'docs' | 'config' | 'explain' | 'feature' | 'other';

// Ordered: the first rule that matches wins. Keyword rules, so the result is always `inferred`.
const RULES: readonly (readonly [Intent, RegExp])[] = [
  ['debug', /\b(debug|stack ?trace|exception|crash(?:es|ed|ing)?|not working|doesn'?t work|failing)\b/i],
  ['bugfix', /\b(fix(?:es|ed)?|bugs?|broken|regression)\b/i],
  ['refactor', /\b(refactor|clean ?up|rename|restructure|simplif(?:y|ied))\b/i],
  ['test', /\b(tests?|specs?|coverage|unit ?tests?)\b/i],
  ['docs', /\b(docs?|readme|documentation|document|changelog|comments?)\b/i],
  [
    'config',
    /\b(config(?:ure|uration)?|set ?up|install|dependenc(?:y|ies)|ci|pipeline|docker|eslint|prettier)\b/i,
  ],
  ['explain', /\b(explain|what (?:is|does)|how (?:does|do)|why|walk me through|understand)\b/i],
  ['feature', /\b(add|implement|create|build|support|introduce)\b/i],
];

export function classifyIntent(prompt: string): { intent: Intent; matched: string } {
  for (const [intent, pattern] of RULES) {
    const match = pattern.exec(prompt);
    if (match) return { intent, matched: match[0].toLowerCase() };
  }
  return { intent: 'other', matched: '' };
}
```

`src/core/analysis/changes.ts`:

```ts
import type { TurnDetail } from '../../shared/dto';

export interface ChangeSummary {
  changed: { path: string; action: 'edited' | 'created' | 'deleted' }[];
  edited: number;
  created: number;
  deleted: number;
  undone: number;
  areas: string[];
  commandCount: number;
}

const CHANGE_RANK = { edited: 1, deleted: 2, created: 3 } as const;
const TERMINAL_TOOL = /terminal|run_?command|execute_?command/i;

export function summarizeChanges(turns: readonly TurnDetail[]): ChangeSummary {
  const strongest = new Map<string, 'edited' | 'created' | 'deleted'>();
  const undone = new Set<string>();
  let commandCount = 0;
  for (const turn of turns) {
    for (const event of turn.fileEvents) {
      if (event.action === 'undone') undone.add(event.path);
      if (event.action !== 'edited' && event.action !== 'created' && event.action !== 'deleted') continue;
      const current = strongest.get(event.path);
      if (current === undefined || CHANGE_RANK[event.action] > CHANGE_RANK[current]) {
        strongest.set(event.path, event.action);
      }
    }
    commandCount += turn.toolCalls.filter((call) => TERMINAL_TOOL.test(call.name)).length;
  }
  const changed = [...strongest].map(([path, action]) => ({ path, action }));
  return {
    changed,
    edited: changed.filter((file) => file.action === 'edited').length,
    created: changed.filter((file) => file.action === 'created').length,
    deleted: changed.filter((file) => file.action === 'deleted').length,
    undone: undone.size,
    areas: topAreas(changed.map((file) => file.path)),
    commandCount,
  };
}

/** The parent directory name of each changed file; a coarse, honest "where" that needs no workspace root. */
function topAreas(paths: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const segments = path.split(/[\\/]/).filter((segment) => segment !== '');
    const area = segments.length >= 2 ? segments[segments.length - 2] : undefined;
    if (area !== undefined) counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([area]) => area)
    .sort((a, b) => a.localeCompare(b));
}

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

export function buildOutcome(summary: ChangeSummary, turns: readonly TurnDetail[]): string {
  const parts: string[] = [];
  const total = summary.changed.length;
  if (total > 0) {
    const detail = [
      summary.edited > 0 ? `${String(summary.edited)} edited` : null,
      summary.created > 0 ? `${String(summary.created)} created` : null,
      summary.deleted > 0 ? `${String(summary.deleted)} deleted` : null,
    ].filter((item): item is string => item !== null);
    parts.push(`Changed ${plural(total, 'file')} (${detail.join(', ')})`);
  } else {
    parts.push('No files changed');
  }
  if (summary.commandCount > 0) parts.push(`ran ${plural(summary.commandCount, 'terminal command')}`);
  if (summary.undone > 0) parts.push(`${plural(summary.undone, 'edit')} undone`);
  const userTurns = turns.filter((turn) => !turn.systemInitiated);
  const failed = userTurns.filter((turn) => turn.state === 'failed').length;
  if (failed > 0) parts.push(`${String(failed)} of ${plural(userTurns.length, 'turn')} failed`);
  const areas = summary.areas.length > 0 ? ` — in ${summary.areas.join(', ')}` : '';
  return `${parts.join(', ')}${areas}.`;
}
```

`src/core/analysis/complexity.ts`:

```ts
export type Complexity = 'simple' | 'moderate' | 'complex';

export interface ComplexityInput {
  userTurns: number;
  toolCalls: number;
  changedFiles: number;
  compactions: number;
}

/** Heuristic size of the work. Always shown as `inferred`. */
export function estimateComplexity(input: ComplexityInput): Complexity {
  const score = input.userTurns + input.toolCalls / 5 + input.changedFiles + 3 * input.compactions;
  if (score < 4) return 'simple';
  if (score < 15) return 'moderate';
  return 'complex';
}
```

`src/core/analysis/findings.ts`:

```ts
import type { TurnDetail } from '../../shared/dto';

export interface Finding {
  id: string;
  message: string;
  evidence: string;
}

const CORRECTION = /^\s*(no|nope|wrong|that'?s (?:not|wrong)|still|again|actually|instead|don'?t)\b/i;

/**
 * Prompt-quality findings. Text rules need stored prompt text (skipped when there is none); the failure rule
 * uses turn state only. System-initiated turns (Copilot's own follow-ups) never count as user prompts.
 */
export function promptFindings(turns: readonly TurnDetail[]): Finding[] {
  const findings: Finding[] = [];
  const userTurns = turns.filter((turn) => !turn.systemInitiated);
  const withText = userTurns.filter((turn) => turn.userText !== null && turn.userText.trim() !== '');

  const first = withText[0]?.userText?.trim();
  if (first !== undefined && first.length < 25) {
    findings.push({
      id: 'vague-first-prompt',
      message:
        'The opening prompt was very short. Stating the goal, the files involved and how you will judge success up front usually saves follow-up turns.',
      evidence: `opening prompt is ${String(first.length)} characters`,
    });
  }

  const corrections = withText.slice(1).filter((turn) => CORRECTION.test(turn.userText ?? ''));
  if (corrections.length >= 2) {
    findings.push({
      id: 'repeated-corrections',
      message:
        'Several follow-ups corrected the previous answer. Restating the requirement in one message may converge faster.',
      evidence: `${String(corrections.length)} follow-up prompts read as corrections (turns ${corrections.map((turn) => String(turn.index)).join(', ')})`,
    });
  }

  const compactions = turns.reduce((sum, turn) => sum + turn.compactions, 0);
  if (userTurns.length >= 12 || compactions >= 2) {
    findings.push({
      id: 'long-session',
      message:
        'Long sessions carry a growing context. Starting a fresh session for the next task usually costs less.',
      evidence: `${String(userTurns.length)} user turns, ${String(compactions)} context compactions`,
    });
  }

  const failed = userTurns.filter((turn) => turn.state === 'failed').length;
  if (failed >= 2) {
    findings.push({
      id: 'repeated-failures',
      message: 'Several turns failed. Check the model/provider and the error codes on those turns.',
      evidence: `${String(failed)} of ${String(userTurns.length)} turns failed`,
    });
  }
  return findings;
}
```

Run: `pnpm vitest run src/core/analysis` — Expected: PASS.

- [ ] **Step 5: Write the failing analyzer, store and query tests**

`src/core/analysis/analyzeSession.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeTurn } from '../../../test/fixtures/turns';
import { analyzeSession } from './analyzeSession';

describe('analyzeSession', () => {
  const turns = [
    makeTurn({
      index: 1,
      userText: 'Fix the timeout race in src/execution/manager.ts',
      fileEvents: [{ path: '/repo/src/execution/manager.ts', action: 'edited' }],
      toolCalls: [{ name: 'read_file', status: 'complete' }],
    }),
  ];

  it('tags every field derived or inferred, never exact', () => {
    const analysis = analyzeSession({ turns });
    expect(analysis.intent).toMatchObject({ value: 'bugfix', provenance: { kind: 'inferred' } });
    expect(analysis.outcome).toMatchObject({
      value: 'Changed 1 file (1 edited) — in execution.',
      provenance: { kind: 'derived' },
    });
    expect(analysis.areas).toMatchObject({ value: ['execution'], provenance: { kind: 'derived' } });
    expect(analysis.complexity.provenance.kind).toBe('inferred');
    expect(analysis.commandCount.provenance.kind).toBe('derived');
    expect(analysis.findings.every((finding) => finding.provenance.kind === 'inferred')).toBe(true);
  });

  it('does not invent an intent when no prompt text was stored', () => {
    const analysis = analyzeSession({ turns: [makeTurn({ index: 1 })] });
    expect(analysis.intent.value).toBeNull();
    expect(analysis.intent.provenance.kind).toBe('unavailable');
    expect(analysis.outcome.value).toBe('No files changed.');
  });
});
```

`src/core/analysis/analysisStore.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadFixtureSession, seededStore } from '../../../test/fixtures/sessions';
import { ANALYZER_VERSION } from './analyzeSession';
import { AnalysisStore } from './analysisStore';

const cachedRows = (database: ReturnType<typeof seededStore>['database']) =>
  (database.db.prepare('SELECT count(*) AS n FROM session_analysis').get() as { n: number }).n;

describe('AnalysisStore', () => {
  it('returns null for an unknown session', () => {
    expect(new AnalysisStore(seededStore().database).get('nope')).toBeNull();
  });

  it('computes once and serves the cache afterwards', () => {
    const { database } = seededStore();
    const store = new AnalysisStore(database);
    const first = store.get('fx-auto-1');
    expect(first?.intent.value).toBe('bugfix');
    expect(first?.outcome.value).toBe('Changed 2 files (1 edited, 1 created) — in execution, test.');
    expect(cachedRows(database)).toBe(1);
    database.db.prepare("UPDATE session_analysis SET json = replace(json, 'bugfix', 'cached-marker')").run();
    expect(store.get('fx-auto-1')?.intent.value).toBe('cached-marker');
  });

  it('recomputes when the analyzer version changes or the session is re-ingested', () => {
    const { database, sessions } = seededStore();
    const store = new AnalysisStore(database);
    store.get('fx-auto-1');
    database.db.prepare('UPDATE session_analysis SET analyzer_version = :v').run({ v: ANALYZER_VERSION - 1 });
    expect(store.get('fx-auto-1')?.intent.value).toBe('bugfix');
    expect(
      (database.db.prepare('SELECT analyzer_version AS v FROM session_analysis').get() as { v: number }).v,
    ).toBe(ANALYZER_VERSION);
    sessions.replaceSession(loadFixtureSession('auto-agent-session.jsonl', 'alpha'), 'full', 999);
    expect(cachedRows(database)).toBe(0);
    expect(store.get('fx-auto-1')).not.toBeNull();
  });

  it('is recomputed after content is cleared', () => {
    const { database, sessions } = seededStore();
    const store = new AnalysisStore(database);
    expect(store.get('fx-auto-1')?.intent.value).toBe('bugfix');
    sessions.clearContent(['fx-auto-1']);
    expect(store.get('fx-auto-1')?.intent.provenance.kind).toBe('unavailable');
  });

  it('ignores a corrupt cached row', () => {
    const { database } = seededStore();
    const store = new AnalysisStore(database);
    store.get('fx-auto-1');
    database.db.prepare("UPDATE session_analysis SET json = '{not json'").run();
    expect(store.get('fx-auto-1')?.intent.value).toBe('bugfix');
  });
});
```

`src/core/query/insightsQueries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { InsightsQueries } from './insightsQueries';

describe('InsightsQueries', () => {
  it('adds the outcome sentence to list rows', () => {
    const queries = new InsightsQueries(seededStore().database);
    const { rows } = queries.listSessions({ offset: 0, limit: 10 });
    expect(rows.find((row) => row.id === 'fx-auto-1')?.outcome).toBe(
      'Changed 2 files (1 edited, 1 created) — in execution, test.',
    );
    expect(rows.find((row) => row.id === 'fx-byok-1')?.outcome).toBe('No files changed, 1 of 1 turn failed.');
  });

  it('adds the analysis to session detail and passes overview through', () => {
    const queries = new InsightsQueries(seededStore().database);
    const detail = queries.getSession('fx-auto-1');
    expect(detail?.analysis?.intent.value).toBe('bugfix');
    expect(detail?.analysis?.complexity.value).toBe('moderate');
    expect(queries.getSession('nope')).toBeNull();
    expect(queries.getOverview('2026-09-30').month.from).toBe('2026-09-01');
  });
});
```

Run: `pnpm vitest run src/core/analysis src/core/query/insightsQueries.test.ts` — Expected: FAIL (modules not found).

- [ ] **Step 6: Implement the analyzer, cache and query facade**

`src/core/analysis/analyzeSession.ts`:

```ts
import type { Analysis, SessionDetail } from '../../shared/dto';
import { derived, inferred, unavailable } from '../../shared/provenance';
import { buildOutcome, summarizeChanges } from './changes';
import { estimateComplexity } from './complexity';
import { promptFindings } from './findings';
import { classifyIntent } from './intent';

/** Bump when any rule changes; cached analyses with an older version are recomputed on next read. */
export const ANALYZER_VERSION = 1;

export function analyzeSession(input: Pick<SessionDetail, 'turns'>): Analysis {
  const { turns } = input;
  const userTurns = turns.filter((turn) => !turn.systemInitiated);
  const changes = summarizeChanges(turns);
  const firstPrompt = userTurns.find(
    (turn) => turn.userText !== null && turn.userText.trim() !== '',
  )?.userText;
  const intent =
    firstPrompt === undefined
      ? unavailable<string>('no prompt text stored at this capture level')
      : inferred(classifyIntent(firstPrompt).intent, 'keyword rules on the first user prompt');
  return {
    intent,
    outcome: derived(buildOutcome(changes, turns), 'file events, terminal tool calls and turn state'),
    areas: derived(changes.areas, 'parent directories of changed files'),
    complexity: inferred(
      estimateComplexity({
        userTurns: userTurns.length,
        toolCalls: turns.reduce((sum, turn) => sum + turn.toolCalls.length, 0),
        changedFiles: changes.changed.length,
        compactions: turns.reduce((sum, turn) => sum + turn.compactions, 0),
      }),
      'turns + tool calls/5 + changed files + 3 × compactions',
    ),
    commandCount: derived(changes.commandCount, 'tool calls whose name mentions a terminal'),
    findings: promptFindings(turns).map((finding) => ({
      ...finding,
      provenance: { kind: 'inferred', source: 'prompt rules' },
    })),
  };
}
```

`src/core/analysis/analysisStore.ts`:

```ts
import { analysisSchema, type Analysis, type SessionDetail } from '../../shared/dto';
import type { Database } from '../storage/database';
import { getSessionDetail } from '../query/sessionDetail';
import { ANALYZER_VERSION, analyzeSession } from './analyzeSession';

interface CacheRow {
  ingested_at: number;
  analyzer_version: number | null;
  json: string | null;
}

/** Caches analysis per session; valid while the analyzer version and the session's ingest time match. */
export class AnalysisStore {
  constructor(private readonly database: Pick<Database, 'db'>) {}

  get(id: string): Analysis | null {
    const cached = this.readCache(id);
    if (cached === 'missing-session') return null;
    if (cached !== null) return cached;
    const detail = getSessionDetail(this.database, id);
    return detail === null ? null : this.compute(detail);
  }

  forDetail(detail: SessionDetail): Analysis {
    const cached = this.readCache(detail.id);
    if (cached !== null && cached !== 'missing-session') return cached;
    return this.compute(detail);
  }

  private compute(detail: SessionDetail): Analysis {
    const analysis = analyzeSession(detail);
    const ingestedAt = this.ingestedAt(detail.id);
    if (ingestedAt !== null) {
      this.database.db
        .prepare(
          `INSERT INTO session_analysis (session_id, analyzer_version, ingested_at, json)
           VALUES (:id, :version, :ingestedAt, :json)
           ON CONFLICT(session_id) DO UPDATE SET analyzer_version = excluded.analyzer_version,
             ingested_at = excluded.ingested_at, json = excluded.json`,
        )
        .run({ id: detail.id, version: ANALYZER_VERSION, ingestedAt, json: JSON.stringify(analysis) });
    }
    return analysis;
  }

  private ingestedAt(id: string): number | null {
    const row = this.database.db.prepare('SELECT ingested_at FROM sessions WHERE id = :id').get({ id }) as
      { ingested_at: number } | undefined;
    return row?.ingested_at ?? null;
  }

  private readCache(id: string): Analysis | 'missing-session' | null {
    const row = this.database.db
      .prepare(
        `SELECT s.ingested_at, a.analyzer_version, a.json
           FROM sessions s LEFT JOIN session_analysis a ON a.session_id = s.id WHERE s.id = :id`,
      )
      .get({ id }) as unknown as CacheRow | undefined;
    if (row === undefined) return 'missing-session';
    if (row.json === null || row.analyzer_version !== ANALYZER_VERSION) return null;
    try {
      const parsed = analysisSchema.safeParse(JSON.parse(row.json));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
```

Note: `readCache` does not compare `ingested_at` because `replaceSession` deletes the session row, which
cascades to `session_analysis`; a cache row can therefore only outlive an ingest if content changed in place,
and Step 1 already clears it in that case. `ingested_at` is stored for diagnostics.

`src/core/query/insightsQueries.ts`:

```ts
import type { Overview, SessionDetail, SessionList } from '../../shared/dto';
import { AnalysisStore } from '../analysis/analysisStore';
import type { Database } from '../storage/database';
import { getOverview } from './overview';
import { getSessionDetail } from './sessionDetail';
import { listSessions, type SessionListQuery } from './sessionList';

/** What the extension exposes to the webview: raw queries plus cached analysis. */
export class InsightsQueries {
  private readonly analysis: AnalysisStore;

  constructor(private readonly database: Database) {
    this.analysis = new AnalysisStore(database);
  }

  listSessions(query: SessionListQuery): SessionList {
    const { rows, total } = listSessions(this.database, query);
    return {
      total,
      rows: rows.map((row) => ({ ...row, outcome: this.analysis.get(row.id)?.outcome.value ?? null })),
    };
  }

  getSession(id: string): SessionDetail | null {
    const detail = getSessionDetail(this.database, id);
    return detail === null ? null : { ...detail, analysis: this.analysis.forDetail(detail) };
  }

  getOverview(today: string): Overview {
    return getOverview(this.database, today);
  }
}
```

Fix the import order in `analysisStore.ts` to match the lint rules if `eslint` reports it (import of
`../query/sessionDetail` may sort before `../storage/database`).

Run: `pnpm vitest run src/core` — Expected: PASS.

- [ ] **Step 7: Verify and commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(analysis): add deterministic intent, outcome, areas and prompt findings with a versioned cache"
```

---

## Task 2.4: RPC surface and the Sessions view

**Files:**

- Create: `src/webview/test/dtoFixtures.ts`, `src/webview/ui/useDebounced.ts`, `src/webview/ui/useDebounced.test.tsx`,
  `src/webview/views/SessionsView.tsx`, `src/webview/views/SessionsView.test.tsx`,
  `src/webview/views/IndexStatus.tsx`
- Modify: `src/shared/protocol.ts`, `src/shared/protocol.test.ts`, `src/extension/webviewHost/rpcHost.test.ts`,
  `src/extension/extension.ts`, `src/webview/App.tsx`, `src/webview/App.test.tsx`, `src/webview/styles.css`

**Interfaces:**

- Consumes: `InsightsQueries` (2.3), DTO schemas (2.2), kit (2.1), `RpcHandlers`, `DashboardPanel`.
- Produces (RPC, in `protocol.ts`): `listSessions(SessionListParams) → SessionList`,
  `getSession({ id }) → SessionDetail | null`, `getOverview({}) → Overview`, `openDashboard({}) → { opened }`.
- Produces: `SessionsView({ onOpen(id), debounceMs? })`, `IndexStatus()` component, `useDebounced(value, ms)`,
  `sessionRow(overrides)`, `exactNumber(value)`, `missing()` webview test fixtures.

- [ ] **Step 1: Extend the protocol (test first)**

Append to `src/shared/protocol.test.ts` inside the `describe`:

```ts
it('declares the Phase 2 methods and validates their params', () => {
  for (const method of ['listSessions', 'getSession', 'getOverview', 'openDashboard']) {
    expect(isRpcMethod(method)).toBe(true);
  }
  expect(rpcSchemas.listSessions.params.safeParse({ offset: 0, limit: 50 }).success).toBe(true);
  expect(rpcSchemas.listSessions.params.safeParse({ offset: 0, limit: 5000 }).success).toBe(false);
  expect(rpcSchemas.getSession.params.safeParse({ id: '' }).success).toBe(false);
});
```

(Add `rpcSchemas` to the import from `./protocol`.) Run: `pnpm vitest run src/shared/protocol.test.ts` —
Expected: FAIL.

In `src/shared/protocol.ts` add the import and the four entries:

```ts
import {
  overviewSchema,
  sessionDetailSchema,
  sessionIdParams,
  sessionListParams,
  sessionListSchema,
} from './dto';
```

```ts
  listSessions: { params: sessionListParams, result: sessionListSchema },
  getSession: { params: sessionIdParams, result: sessionDetailSchema.nullable() },
  getOverview: { params: z.object({}), result: overviewSchema },
  openDashboard: { params: z.object({}), result: z.object({ opened: z.boolean() }) },
```

Run: `pnpm vitest run src/shared/protocol.test.ts` — Expected: PASS.

`RpcHandlers` now requires the four handlers. In `src/extension/webviewHost/rpcHost.test.ts` extend the shared
`handlers` map:

```ts
  listSessions: () => ({ rows: [], total: 0 }),
  getSession: () => null,
  getOverview: () => {
    const none = { value: null, provenance: { kind: 'unavailable' as const, source: 'test' } };
    const period = { from: '2026-09-01', to: '2026-09-30', sessions: 0, turns: 0, inputTokens: none, outputTokens: none, credits: none };
    return { today: period, month: period, failureRate: none, byModel: [], byWorkspace: [], hostSplit: [] };
  },
  openDashboard: () => ({ opened: true }),
```

In `src/extension/extension.ts`: import `InsightsQueries` from `../core/query/insightsQueries` and `localDay`
from `../core/time`; after `const state = …` add `const queries = new InsightsQueries(database);`; the
`handlers` object becomes:

```ts
// `dashboard` is created after the handlers; the closure reads it lazily.
const handlers: RpcHandlers = {
  ping: () => ({ version, now: Date.now() }),
  getIndexStatus: () => indexStatus(service, sessions, state, readConfig().captureLevel),
  listSessions: (params) => queries.listSessions(params),
  getSession: ({ id }) => queries.getSession(id),
  getOverview: () => queries.getOverview(localDay()),
  openDashboard: () => {
    dashboard.show();
    return { opened: true };
  },
};
const dashboard = new DashboardPanel(context.extensionUri, handlers, log);
```

(`const handlers` referencing `dashboard` declared after it is fine because the handler runs later; ESLint's
`no-use-before-define` is not enabled in `strictTypeChecked`. If it complains, declare `let dashboard` first.)

Run: `pnpm typecheck && pnpm vitest run src/extension src/shared` — Expected: PASS.

- [ ] **Step 2: Webview fixtures and the debounce hook (test first)**

`src/webview/test/dtoFixtures.ts`:

```ts
import type { MeasuredNumber, SessionRow } from '../../shared/dto';

export const exactNumber = (value: number, source = 'test'): MeasuredNumber => ({
  value,
  provenance: { kind: 'exact', source },
});

export const missing = (source = 'test'): MeasuredNumber => ({
  value: null,
  provenance: { kind: 'unavailable', source },
});

export function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'fx-auto-1',
    day: '2026-09-21',
    startedAt: 1790000001000,
    workspace: 'alpha',
    title: 'Fix run timeout race',
    outcome: 'Changed 2 files (1 edited, 1 created) — in execution, test.',
    routing: { kind: 'auto', label: 'Auto → gpt-5.6-luna' },
    state: 'complete',
    turns: 2,
    failedTurns: 0,
    inputTokens: exactNumber(54000, 'chatSessions.promptTokens'),
    outputTokens: exactNumber(2600, 'chatSessions.completionTokens'),
    credits: exactNumber(1.626141, 'chatSessions.copilotCredits'),
    ...overrides,
  };
}
```

`src/webview/ui/useDebounced.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebounced } from './useDebounced';

describe('useDebounced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('only publishes the latest value after the delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounced(value, 200), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'ab' });
    rerender({ value: 'abc' });
    expect(result.current).toBe('a');
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current).toBe('a');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('abc');
  });
});
```

Run: `pnpm vitest run src/webview/ui/useDebounced.test.tsx` — Expected: FAIL.

`src/webview/ui/useDebounced.ts`:

```ts
import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);
  return debounced;
}
```

Run: `pnpm vitest run src/webview/ui/useDebounced.test.tsx` — Expected: PASS.

- [ ] **Step 3: Write the failing Sessions view tests** — `src/webview/views/SessionsView.test.tsx`

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SessionListParams } from '../../shared/dto';
import { exactNumber, missing, sessionRow } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { SessionsView } from './SessionsView';

describe('SessionsView', () => {
  it('shows each session with title, outcome, routing, tokens, credits and state', async () => {
    renderWithHost(<SessionsView onOpen={vi.fn()} debounceMs={0} />, {
      listSessions: { rows: [sessionRow()], total: 1 },
    });
    expect(await screen.findByText('Fix run timeout race')).toBeInTheDocument();
    expect(screen.getByText(/alpha · Changed 2 files/)).toBeInTheDocument();
    expect(screen.getByText('Auto → gpt-5.6-luna')).toBeInTheDocument();
    expect(screen.getByText('54,000')).toBeInTheDocument();
    expect(screen.getByText('2,600')).toBeInTheDocument();
    expect(screen.getByText('1.626')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 1 sessions')).toBeInTheDocument();
  });

  it('shows unavailable credits as a dash with its badge, not zero', async () => {
    renderWithHost(<SessionsView onOpen={vi.fn()} debounceMs={0} />, {
      listSessions: {
        rows: [
          sessionRow({ id: 'b', title: null, outcome: null, credits: missing('BYOK: no Copilot credits') }),
        ],
        total: 1,
      },
    });
    expect(await screen.findByText('Untitled session')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toHaveAttribute(
      'title',
      'Unavailable — BYOK: no Copilot credits',
    );
  });

  it('opens a session from a click or the keyboard', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderWithHost(<SessionsView onOpen={onOpen} debounceMs={0} />, {
      listSessions: { rows: [sessionRow()], total: 1 },
    });
    await user.click(await screen.findByText('Fix run timeout race'));
    expect(onOpen).toHaveBeenCalledWith('fx-auto-1');
    screen.getByText('Fix run timeout race').closest('tr')?.focus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('searches with the typed text and filters failures', async () => {
    const user = userEvent.setup();
    const { calls } = renderWithHost(<SessionsView onOpen={vi.fn()} debounceMs={0} />, {
      listSessions: { rows: [], total: 0 },
    });
    await screen.findByText(/No sessions indexed yet/);
    await user.type(screen.getByRole('searchbox', { name: 'Search sessions' }), 'timeout');
    await waitFor(() => {
      expect(calls.some((call) => (call.params as SessionListParams).q === 'timeout')).toBe(true);
    });
    expect(await screen.findByText('No sessions match your search.')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /failures/ }));
    await waitFor(() => {
      expect(calls.some((call) => (call.params as SessionListParams).failedOnly === true)).toBe(true);
    });
  });

  it('loads the next page on demand', async () => {
    const user = userEvent.setup();
    const { calls } = renderWithHost(<SessionsView onOpen={vi.fn()} debounceMs={0} />, {
      listSessions: (params: SessionListParams) =>
        params.offset === 0
          ? { rows: [sessionRow({ id: 'one', title: 'First' })], total: 2 }
          : { rows: [sessionRow({ id: 'two', title: 'Second' })], total: 2 },
    });
    expect(await screen.findByText('First')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2 sessions')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Second')).toBeInTheDocument();
    expect(calls.map((call) => (call.params as SessionListParams).offset)).toEqual([0, 1]);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows an error when the extension fails', async () => {
    renderWithHost(<SessionsView onOpen={vi.fn()} debounceMs={0} />, {});
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load sessions: boom');
  });
});
```

(`exactNumber` is imported for later tasks' reuse; delete the import if lint reports it unused here.)

Run: `pnpm vitest run src/webview/views/SessionsView.test.tsx` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement the view**

`src/webview/views/SessionsView.tsx`:

```tsx
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { SessionRow } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { Button } from '../ui/Button';
import { DataTable, type Column } from '../ui/DataTable';
import { formatCredits, formatDateTime, formatInt } from '../ui/format';
import { Measure } from '../ui/Measure';
import { useDebounced } from '../ui/useDebounced';

const PAGE_SIZE = 50;

const STATE_LABEL: Record<SessionRow['state'], string> = {
  complete: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
  pending: 'In progress',
  unknown: 'Unknown',
};

const columns: Column<SessionRow>[] = [
  { id: 'time', header: 'Time', cell: (row) => formatDateTime(row.startedAt) },
  {
    id: 'session',
    header: 'Session',
    cell: (row) => (
      <>
        <strong>{row.title ?? row.outcome ?? 'Untitled session'}</strong>
        <div className="muted">
          {row.workspace}
          {row.title !== null && row.outcome !== null ? ` · ${row.outcome}` : ''}
        </div>
      </>
    ),
  },
  { id: 'routing', header: 'Model', cell: (row) => row.routing.label },
  {
    id: 'input',
    header: 'Input tokens',
    align: 'end',
    cell: (row) => <Measure measure={row.inputTokens} format={(value) => formatInt(Number(value))} />,
  },
  {
    id: 'output',
    header: 'Output tokens',
    align: 'end',
    cell: (row) => <Measure measure={row.outputTokens} format={(value) => formatInt(Number(value))} />,
  },
  {
    id: 'credits',
    header: 'Credits',
    align: 'end',
    cell: (row) => <Measure measure={row.credits} format={(value) => formatCredits(Number(value))} />,
  },
  { id: 'turns', header: 'Turns', align: 'end', cell: (row) => formatInt(row.turns) },
  {
    id: 'state',
    header: 'State',
    cell: (row) => (
      <span className={`state state--${row.state}`}>
        {STATE_LABEL[row.state]}
        {row.failedTurns > 0 ? ` · ${String(row.failedTurns)} failed` : ''}
      </span>
    ),
  },
];

export function SessionsView({
  onOpen,
  debounceMs = 250,
}: {
  onOpen: (id: string) => void;
  debounceMs?: number;
}) {
  const rpc = useRpc();
  const [text, setText] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);
  const q = useDebounced(text.trim(), debounceMs);
  const filtered = q !== '' || failedOnly;

  const list = useInfiniteQuery({
    queryKey: ['sessions', q, failedOnly],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      rpc.call('listSessions', {
        offset: pageParam,
        limit: PAGE_SIZE,
        ...(q !== '' ? { q } : {}),
        ...(failedOnly ? { failedOnly: true } : {}),
      }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.rows.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });

  const rows = list.data?.pages.flatMap((page) => page.rows) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  return (
    <section aria-label="Sessions">
      <div className="toolbar" role="search">
        <input
          type="search"
          aria-label="Search sessions"
          placeholder="Search title, workspace, prompt or model"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <label>
          <input
            type="checkbox"
            checked={failedOnly}
            onChange={(event) => {
              setFailedOnly(event.target.checked);
            }}
          />{' '}
          Only sessions with failures
        </label>
      </div>
      {list.isPending && <p className="muted">Loading…</p>}
      {list.isError && <p role="alert">Could not load sessions: {list.error.message}</p>}
      {list.data && (
        <>
          <DataTable
            caption="Sessions"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            onRowActivate={(row) => {
              onOpen(row.id);
            }}
            empty={
              filtered
                ? 'No sessions match your search.'
                : 'No sessions indexed yet. Use Copilot Chat, then refresh.'
            }
          />
          {rows.length > 0 && (
            <p className="muted">
              Showing {rows.length} of {total} sessions
            </p>
          )}
          {list.hasNextPage && (
            <Button
              disabled={list.isFetchingNextPage}
              onClick={() => {
                void list.fetchNextPage();
              }}
            >
              Load more
            </Button>
          )}
        </>
      )}
    </section>
  );
}
```

`src/webview/views/IndexStatus.tsx` — move `IndexStatusSummary` and its query out of `App.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import type { IndexStatus as IndexStatusData } from '../../shared/protocol';
import { useRpc } from '../rpcContext';

export function IndexStatus() {
  const rpc = useRpc();
  const status = useQuery({ queryKey: ['indexStatus'], queryFn: () => rpc.call('getIndexStatus', {}) });
  return (
    <>
      {status.isPending && <p className="muted">Loading…</p>}
      {status.isError && <p role="alert">Could not reach the extension: {status.error.message}</p>}
      {status.data && <IndexStatusSummary status={status.data} />}
    </>
  );
}

function IndexStatusSummary({ status }: { status: IndexStatusData }) {
  return (
    <section aria-label="Index status">
      <p>
        <strong>{status.sessions}</strong> sessions · <strong>{status.turns}</strong> turns indexed
      </p>
      <p className="muted">
        Capture level: {status.captureLevel}
        {status.lastSyncAt !== null && ` · last scan ${new Date(status.lastSyncAt).toLocaleString()}`}
      </p>
      {status.role === 'follower' && (
        <p className="muted">
          Another VS Code window is indexing Copilot sessions; showing the shared index.
        </p>
      )}
      {status.lastError !== null && <p role="alert">Last scan failed: {status.lastError}</p>}
    </section>
  );
}
```

Replace `src/webview/App.tsx` (the Overview tab, detail view and sidebar arrive in Tasks 2.5–2.6):

```tsx
import { IndexStatus } from './views/IndexStatus';
import { SessionsView } from './views/SessionsView';

export function App({ view }: { view: 'dashboard' | 'sidebar' }) {
  return (
    <main className={`app app--${view}`}>
      <h1>Copilot Insights</h1>
      <IndexStatus />
      {view === 'dashboard' && (
        <SessionsView
          onOpen={() => {
            // Wired to the detail view in Task 2.5.
          }}
        />
      )}
    </main>
  );
}
```

Update `src/webview/App.test.tsx`: the dashboard now also calls `listSessions`, so give each test host
`listSessions: { rows: [], total: 0 }` in addition to `getIndexStatus`. The third test ("shows an error when the
extension fails") now yields two alerts; change its assertions to:

```tsx
const alerts = await screen.findAllByRole('alert');
expect(alerts.length).toBeGreaterThan(0);
expect(alerts[0]).toHaveTextContent('boom');
```

Append to `src/webview/styles.css`:

```css
.toolbar {
  display: flex;
  gap: 16px;
  align-items: center;
  margin: 8px 0;
}
.toolbar input[type='search'] {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  font: inherit;
}
.state--failed {
  color: var(--vscode-errorForeground);
}
.state--pending {
  color: var(--vscode-charts-orange);
}
```

Run: `pnpm vitest run src/webview` — Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
pnpm format && pnpm verify
pnpm test:integration
git add -A
git commit -m "feat: expose session queries over RPC and add the Sessions view"
```

---

## Task 2.5: Session detail view

**Files:**

- Create: `src/webview/views/SessionDetailView.tsx`, `src/webview/views/SessionDetailView.test.tsx`
- Modify: `src/webview/test/dtoFixtures.ts` (append `sessionDetail`, `turnDetail`), `src/webview/App.tsx`,
  `src/webview/App.test.tsx`, `src/webview/styles.css`

**Interfaces:**

- Consumes: `getSession` RPC, `SessionDetail`/`TurnDetail`/`Analysis` (2.2, 2.3), kit (2.1).
- Produces: `SessionDetailView({ id, onBack })`, `sessionDetail(overrides)`, `turnDetail(overrides)`.

- [ ] **Step 1: Add detail fixtures**

Append to `src/webview/test/dtoFixtures.ts`:

```ts
import type { SessionDetail, TurnDetail } from '../../shared/dto';

export function turnDetail(overrides: Partial<TurnDetail> = {}): TurnDetail {
  return {
    index: 1,
    startedAt: 1790000001000,
    state: 'complete',
    systemInitiated: false,
    mode: 'agent',
    userText: 'Fix the timeout race in src/execution/manager.ts',
    assistantText: 'I moved the timer start after the lock is acquired.',
    routing: { kind: 'auto', label: 'Auto → gpt-5.6-luna' },
    model: 'gpt-5.6-luna',
    host: 'copilot',
    inputTokens: exactNumber(24000, 'chatSessions.promptTokens'),
    outputTokens: exactNumber(1700, 'chatSessions.completionTokens'),
    credits: exactNumber(1.126141, 'chatSessions.copilotCredits'),
    reasoningMs: 4200,
    toolRounds: 2,
    compactions: 1,
    toolCalls: [
      { name: 'read_file', status: 'complete' },
      { name: 'replace_string_in_file', status: 'complete' },
    ],
    fileEvents: [{ path: '/repo/src/execution/manager.ts', action: 'edited' }],
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

export function sessionDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 'fx-auto-1',
    workspace: 'alpha',
    title: 'Fix run timeout race',
    day: '2026-09-21',
    startedAt: 1790000001000,
    endedAt: 1790000100000,
    activeMs: 65000,
    captureLevel: 'full',
    inputTokens: exactNumber(54000, 'chatSessions.promptTokens'),
    outputTokens: exactNumber(2600, 'chatSessions.completionTokens'),
    credits: exactNumber(1.626141, 'chatSessions.copilotCredits'),
    analysis: {
      intent: {
        value: 'bugfix',
        provenance: { kind: 'inferred', source: 'keyword rules on the first user prompt' },
      },
      outcome: {
        value: 'Changed 2 files (1 edited, 1 created) — in execution, test.',
        provenance: { kind: 'derived', source: 'file events, terminal tool calls and turn state' },
      },
      areas: {
        value: ['execution', 'test'],
        provenance: { kind: 'derived', source: 'parent directories of changed files' },
      },
      complexity: { value: 'moderate', provenance: { kind: 'inferred', source: 'heuristic' } },
      commandCount: exactNumber(0, 'tool calls whose name mentions a terminal'),
      findings: [
        {
          id: 'long-session',
          message: 'Long sessions carry a growing context.',
          evidence: '12 user turns, 2 context compactions',
          provenance: { kind: 'inferred', source: 'prompt rules' },
        },
      ],
    },
    turns: [
      turnDetail(),
      turnDetail({
        index: 2,
        userText: 'Also add a regression test',
        assistantText: 'Added test/manager.test.ts.',
        inputTokens: exactNumber(30000),
        outputTokens: exactNumber(900),
        credits: exactNumber(0.5),
        toolCalls: [{ name: 'create_file', status: 'complete' }],
        fileEvents: [{ path: '/repo/test/manager.test.ts', action: 'created' }],
        compactions: 0,
        reasoningMs: 0,
        toolRounds: 1,
      }),
    ],
    ...overrides,
  };
}
```

(Merge the new `import type` line into the file's existing import.)

- [ ] **Step 2: Write the failing tests** — `src/webview/views/SessionDetailView.test.tsx`

```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { missing, sessionDetail, turnDetail } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { SessionDetailView } from './SessionDetailView';

const view = (results: Record<string, unknown>, onBack = vi.fn()) =>
  renderWithHost(<SessionDetailView id="fx-auto-1" onBack={onBack} />, results);

describe('SessionDetailView', () => {
  it('shows the header, totals and the analysis with provenance', async () => {
    view({ getSession: sessionDetail() });
    expect(await screen.findByRole('heading', { name: 'Fix run timeout race' })).toBeInTheDocument();
    expect(screen.getByText(/alpha/)).toBeInTheDocument();
    const analysis = screen.getByRole('region', { name: 'Analysis' });
    expect(within(analysis).getByText('bugfix')).toBeInTheDocument();
    expect(within(analysis).getByText(/Changed 2 files/)).toBeInTheDocument();
    expect(within(analysis).getAllByText('Inferred').length).toBeGreaterThan(0);
    expect(within(analysis).getAllByText('Derived').length).toBeGreaterThan(0);
    expect(within(analysis).getByText('Long sessions carry a growing context.')).toBeInTheDocument();
    expect(within(analysis).getByText(/12 user turns/)).toBeInTheDocument();
  });

  it('renders a timeline of turns with model, tokens, credits, tools and files', async () => {
    view({ getSession: sessionDetail() });
    const first = await screen.findByRole('article', { name: 'Turn 1' });
    expect(within(first).getByText('Auto → gpt-5.6-luna')).toBeInTheDocument();
    expect(within(first).getByText('24,000')).toBeInTheDocument();
    expect(within(first).getByText('1,700')).toBeInTheDocument();
    expect(within(first).getByText('1.126')).toBeInTheDocument();
    expect(within(first).getByText('read_file')).toBeInTheDocument();
    expect(within(first).getByText('/repo/src/execution/manager.ts')).toBeInTheDocument();
    expect(within(first).getByText('4.2 s')).toBeInTheDocument();
    expect(within(first).getByText(/1 compaction/)).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Turn 2' })).toBeInTheDocument();
  });

  it('renders prompts and responses as plain text, never as HTML', async () => {
    const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const { container } = view({
      getSession: sessionDetail({ turns: [turnDetail({ userText: hostile, assistantText: hostile })] }),
    });
    expect((await screen.findAllByText(hostile)).length).toBe(2);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('explains missing text at low capture levels and marks system turns and errors', async () => {
    view({
      getSession: sessionDetail({
        captureLevel: 'metrics',
        turns: [
          turnDetail({ userText: null, assistantText: null }),
          turnDetail({
            index: 2,
            systemInitiated: true,
            state: 'failed',
            errorCode: 'rate_limited',
            errorMessage: 'Too many requests',
            inputTokens: missing('chatSessions.promptTokens'),
          }),
        ],
      }),
    });
    const first = await screen.findByRole('article', { name: 'Turn 1' });
    expect(within(first).getAllByText('Not stored at this capture level.').length).toBe(2);
    const second = screen.getByRole('article', { name: 'Turn 2' });
    expect(within(second).getByText('System-initiated')).toBeInTheDocument();
    expect(within(second).getByText('Failed')).toBeInTheDocument();
    expect(within(second).getByText(/rate_limited/)).toBeInTheDocument();
    expect(within(second).getByText('Unavailable')).toBeInTheDocument();
  });

  it('goes back and handles a session that is no longer indexed', async () => {
    const onBack = vi.fn();
    view({ getSession: null }, onBack);
    expect(await screen.findByText('This session is no longer in the index.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '← Sessions' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('shows an error when the extension fails', async () => {
    view({});
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the session: boom');
  });
});
```

Run: `pnpm vitest run src/webview/views/SessionDetailView.test.tsx` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/webview/views/SessionDetailView.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query';
import type { Analysis, SessionDetail, TurnDetail } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { ProvenanceBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { formatCredits, formatDateTime, formatDuration, formatInt } from '../ui/format';
import { Measure } from '../ui/Measure';

const STATE_LABEL: Record<TurnDetail['state'], string> = {
  complete: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
  pending: 'In progress',
  unknown: 'Unknown',
};
const HOST_LABEL: Record<TurnDetail['host'], string> = {
  copilot: 'Copilot',
  byok: 'BYOK / local',
  unknown: 'Unknown host',
};
const NOT_STORED = 'Not stored at this capture level.';

export function SessionDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const rpc = useRpc();
  const query = useQuery({ queryKey: ['session', id], queryFn: () => rpc.call('getSession', { id }) });
  return (
    <section aria-label="Session">
      <Button
        onClick={() => {
          onBack();
        }}
      >
        ← Sessions
      </Button>
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && <p role="alert">Could not load the session: {query.error.message}</p>}
      {query.data === null && <p className="muted">This session is no longer in the index.</p>}
      {query.data && <Detail session={query.data} />}
    </section>
  );
}

function Detail({ session }: { session: SessionDetail }) {
  return (
    <>
      <h2>{session.title ?? 'Untitled session'}</h2>
      <p className="muted">
        {session.workspace} · {formatDateTime(session.startedAt)} · active {formatDuration(session.activeMs)}{' '}
        · capture level: {session.captureLevel}
      </p>
      <dl className="facts">
        <dt>Input tokens</dt>
        <dd>
          <Measure measure={session.inputTokens} format={(value) => formatInt(Number(value))} />
        </dd>
        <dt>Output tokens</dt>
        <dd>
          <Measure measure={session.outputTokens} format={(value) => formatInt(Number(value))} />
        </dd>
        <dt>Credits</dt>
        <dd>
          <Measure measure={session.credits} format={(value) => formatCredits(Number(value))} />
        </dd>
      </dl>
      {session.analysis && <AnalysisCard analysis={session.analysis} />}
      <h3>Timeline</h3>
      {session.turns.map((turn) => (
        <TurnCard key={turn.index} turn={turn} />
      ))}
    </>
  );
}

function AnalysisCard({ analysis }: { analysis: Analysis }) {
  return (
    <section className="card" aria-label="Analysis">
      <h3>Analysis</h3>
      <dl className="facts">
        <dt>Intent</dt>
        <dd>
          <Measure measure={analysis.intent} />
        </dd>
        <dt>Outcome</dt>
        <dd>
          <Measure measure={analysis.outcome} />
        </dd>
        <dt>Areas touched</dt>
        <dd>
          <Measure
            measure={{
              value: analysis.areas.value?.join(', ') ?? null,
              provenance: analysis.areas.provenance,
            }}
          />
        </dd>
        <dt>Complexity</dt>
        <dd>
          <Measure measure={analysis.complexity} />
        </dd>
        <dt>Terminal commands</dt>
        <dd>
          <Measure measure={analysis.commandCount} />
        </dd>
      </dl>
      {analysis.findings.length > 0 && (
        <ul className="findings">
          {analysis.findings.map((finding) => (
            <li key={finding.id}>
              <strong>{finding.message}</strong> <ProvenanceBadge provenance={finding.provenance} />
              <div className="muted">Evidence: {finding.evidence}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TurnCard({ turn }: { turn: TurnDetail }) {
  const extras = [
    turn.reasoningMs > 0 ? `reasoning ${formatDuration(turn.reasoningMs)}` : null,
    turn.toolRounds > 0 ? `${String(turn.toolRounds)} tool round${turn.toolRounds === 1 ? '' : 's'}` : null,
    turn.compactions > 0
      ? `${String(turn.compactions)} compaction${turn.compactions === 1 ? '' : 's'}`
      : null,
  ].filter((item): item is string => item !== null);
  return (
    <article className="turn" aria-label={`Turn ${String(turn.index)}`}>
      <header>
        <strong>Turn {turn.index}</strong>{' '}
        <span className={`state state--${turn.state}`}>{STATE_LABEL[turn.state]}</span>
        {turn.systemInitiated && <span className="tag">System-initiated</span>}
        <div className="muted">
          <span>{turn.routing.label}</span> · {HOST_LABEL[turn.host]}
          {turn.startedAt !== null && ` · ${formatDateTime(turn.startedAt)}`}
        </div>
      </header>
      <p className="label">Prompt</p>
      {turn.userText === null ? (
        <p className="muted">{NOT_STORED}</p>
      ) : (
        <pre className="text">{turn.userText}</pre>
      )}
      <p className="label">Response</p>
      {turn.assistantText === null ? (
        <p className="muted">{NOT_STORED}</p>
      ) : (
        <pre className="text">{turn.assistantText}</pre>
      )}
      <dl className="facts facts--row">
        <dt>Input</dt>
        <dd>
          <Measure measure={turn.inputTokens} format={(value) => formatInt(Number(value))} />
        </dd>
        <dt>Output</dt>
        <dd>
          <Measure measure={turn.outputTokens} format={(value) => formatInt(Number(value))} />
        </dd>
        <dt>Credits</dt>
        <dd>
          <Measure measure={turn.credits} format={(value) => formatCredits(Number(value))} />
        </dd>
      </dl>
      {extras.length > 0 && <p className="muted">{extras.join(' · ')}</p>}
      {turn.toolCalls.length > 0 && (
        <ul className="chips" aria-label="Tool calls">
          {turn.toolCalls.map((call, index) => (
            <li key={`${call.name}-${String(index)}`}>
              {call.name}
              {call.status === 'incomplete' ? ' (incomplete)' : ''}
            </li>
          ))}
        </ul>
      )}
      {turn.fileEvents.length > 0 && (
        <ul className="files" aria-label="File activity">
          {turn.fileEvents.map((event, index) => (
            <li key={`${event.path}-${String(index)}`}>
              <code>{event.path}</code> <span className="muted">{event.action}</span>
            </li>
          ))}
        </ul>
      )}
      {(turn.errorCode !== null || turn.errorMessage !== null) && (
        <p className="error">
          Error {turn.errorCode ?? ''} {turn.errorMessage ?? ''}
        </p>
      )}
    </article>
  );
}
```

Wire it into `src/webview/App.tsx`: keep `const [selected, setSelected] = useState<string | null>(null);` in the
dashboard, render `<SessionDetailView id={selected} onBack={() => setSelected(null)} />` when `selected !== null`
(hiding the list; the list's filters reset when it remounts), and pass `onOpen={setSelected}` to `SessionsView`.
Extend `App.test.tsx` with one test: with `listSessions` returning one row and `getSession` returning
`sessionDetail()`, clicking the row shows the "Fix run timeout race" heading, and "← Sessions" returns to the list.

Append to `src/webview/styles.css`:

```css
h2 {
  margin: 12px 0 4px;
  font-size: 1.15em;
}
h3 {
  margin: 16px 0 6px;
  font-size: 1em;
}
.card {
  padding: 4px 12px 8px;
  border: 1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border, transparent));
  border-radius: 4px;
}
.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 16px;
  margin: 8px 0;
}
.facts dt {
  color: var(--vscode-descriptionForeground);
}
.facts dd {
  margin: 0;
}
.facts--row {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 16px;
}
.facts--row dd {
  margin-right: 12px;
}
.turn {
  padding: 8px 12px;
  margin: 8px 0;
  border-left: 3px solid var(--vscode-focusBorder);
  background: var(--vscode-editorWidget-background, transparent);
}
.label {
  margin: 8px 0 2px;
  color: var(--vscode-descriptionForeground);
  font-size: 0.85em;
  text-transform: uppercase;
}
.text {
  max-height: 20em;
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
}
.tag {
  margin-left: 8px;
  padding: 0 6px;
  border: 1px solid currentColor;
  border-radius: 3px;
  font-size: 0.8em;
}
.chips,
.files,
.findings {
  padding: 0;
  margin: 6px 0;
  list-style: none;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chips li {
  padding: 0 6px;
  border: 1px solid var(--vscode-widget-border, currentColor);
  border-radius: 3px;
  font-family: var(--vscode-editor-font-family);
  font-size: 0.85em;
}
.error {
  color: var(--vscode-errorForeground);
}
```

Run: `pnpm vitest run src/webview` — Expected: PASS.

- [ ] **Step 4: Verify and commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(webview): add session detail with analysis, timeline and plain-text conversation"
```

---

## Task 2.6: Overview and sidebar

**Files:**

- Create: `src/webview/views/OverviewView.tsx`, `src/webview/views/OverviewView.test.tsx`,
  `src/webview/views/SidebarView.tsx`, `src/webview/views/SidebarView.test.tsx`
- Modify: `src/webview/test/dtoFixtures.ts` (append `overview`), `src/webview/App.tsx`, `src/webview/App.test.tsx`,
  `src/webview/styles.css`

**Interfaces:**

- Consumes: `getOverview`, `openDashboard` RPC; `Overview`, `BreakdownRow` (2.2); kit (2.1); `IndexStatus` (2.4).
- Produces: `OverviewView()`, `SidebarView()`, `overview(overrides)` fixture.

- [ ] **Step 1: Add the overview fixture**

Append to `src/webview/test/dtoFixtures.ts`:

```ts
import type { BreakdownRow, Overview } from '../../shared/dto';

export function breakdownRow(overrides: Partial<BreakdownRow> = {}): BreakdownRow {
  return {
    key: 'gpt-5.6-luna',
    label: 'gpt-5.6-luna',
    host: 'copilot',
    sessions: 1,
    turns: 2,
    inputTokens: exactNumber(54000),
    outputTokens: exactNumber(2600),
    credits: exactNumber(1.626141),
    ...overrides,
  };
}

export function overview(overrides: Partial<Overview> = {}): Overview {
  const period = {
    from: '2026-09-01',
    to: '2026-09-30',
    sessions: 2,
    turns: 4,
    inputTokens: {
      value: 59000,
      provenance: {
        kind: 'derived' as const,
        source: 'chatSessions.promptTokens (lower bound: 3 of 4 turns reported it)',
      },
    },
    outputTokens: exactNumber(2650),
    credits: exactNumber(1.626141),
  };
  return {
    today: { ...period, from: '2026-09-30', sessions: 1, turns: 2, inputTokens: exactNumber(54000) },
    month: period,
    failureRate: { value: 1 / 3, provenance: { kind: 'derived', source: 'turns.state' } },
    byModel: [
      breakdownRow(),
      breakdownRow({ key: 'qwen3.5:35b', label: 'qwen3.5:35b', host: 'byok', credits: missing('BYOK') }),
    ],
    byWorkspace: [
      breakdownRow({ key: 'alpha', label: 'alpha', host: null }),
      breakdownRow({ key: 'beta', label: 'beta', host: null }),
    ],
    hostSplit: [
      { host: 'byok', turns: 2, sessions: 1 },
      { host: 'copilot', turns: 2, sessions: 1 },
    ],
    ...overrides,
  };
}
```

(Merge with the file's existing type imports.)

- [ ] **Step 2: Write the failing tests**

`src/webview/views/OverviewView.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { missing, overview } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { OverviewView } from './OverviewView';

describe('OverviewView', () => {
  it('shows today and month totals with provenance', async () => {
    renderWithHost(<OverviewView />, { getOverview: overview() });
    const today = await screen.findByRole('region', { name: 'Today' });
    expect(within(today).getByText('54,000')).toBeInTheDocument();
    expect(within(today).getByText('1.626')).toBeInTheDocument();
    const month = screen.getByRole('region', { name: 'This month' });
    expect(within(month).getByText('59,000')).toBeInTheDocument();
    expect(within(month).getByText('Derived')).toBeInTheDocument();
    expect(within(month).getByText('2,650')).toBeInTheDocument();
  });

  it('shows the failure rate and the host split', async () => {
    renderWithHost(<OverviewView />, { getOverview: overview() });
    expect(await screen.findByText('33%')).toBeInTheDocument();
    const hosts = screen.getByRole('table', { name: 'Usage by host' });
    expect(within(hosts).getByText('Copilot')).toBeInTheDocument();
    expect(within(hosts).getByText('BYOK / local')).toBeInTheDocument();
  });

  it('lists usage by model and by workspace, with unavailable credits shown as unavailable', async () => {
    renderWithHost(<OverviewView />, { getOverview: overview() });
    const models = await screen.findByRole('table', { name: 'Usage by model' });
    expect(within(models).getByText('gpt-5.6-luna')).toBeInTheDocument();
    expect(within(models).getByText('qwen3.5:35b')).toBeInTheDocument();
    expect(within(models).getByText('Unavailable')).toBeInTheDocument();
    const workspaces = screen.getByRole('table', { name: 'Usage by workspace' });
    expect(within(workspaces).getByText('alpha')).toBeInTheDocument();
  });

  it('shows friendly empty states', async () => {
    renderWithHost(<OverviewView />, {
      getOverview: overview({
        byModel: [],
        byWorkspace: [],
        hostSplit: [],
        failureRate: missing('turns.state'),
      }),
    });
    expect(await screen.findByText('No usage recorded this month yet.')).toBeInTheDocument();
  });

  it('shows an error when the extension fails', async () => {
    renderWithHost(<OverviewView />, {});
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the overview: boom');
  });
});
```

`src/webview/views/SidebarView.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { overview } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { SidebarView } from './SidebarView';

const status = {
  sessions: 2,
  turns: 4,
  lastSyncAt: null,
  role: 'leader',
  lastError: null,
  captureLevel: 'summaries',
};

describe('SidebarView', () => {
  it("summarizes today's usage and index status", async () => {
    renderWithHost(<SidebarView />, { getOverview: overview(), getIndexStatus: status });
    expect(await screen.findByText('54,000')).toBeInTheDocument();
    expect(screen.getByText('1.626')).toBeInTheDocument();
    expect(await screen.findByLabelText('Index status')).toHaveTextContent('2 sessions · 4 turns indexed');
  });

  it('opens the dashboard', async () => {
    const { calls } = renderWithHost(<SidebarView />, {
      getOverview: overview(),
      getIndexStatus: status,
      openDashboard: { opened: true },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Open dashboard' }));
    expect(calls.map((call) => call.method)).toContain('openDashboard');
  });
});
```

Run: `pnpm vitest run src/webview/views` — Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the views**

`src/webview/views/OverviewView.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import type { BreakdownRow, Overview, PeriodTotals } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { DataTable, type Column } from '../ui/DataTable';
import { formatCredits, formatInt, formatPercent } from '../ui/format';
import { Measure } from '../ui/Measure';

const HOST_LABEL = { copilot: 'Copilot', byok: 'BYOK / local', unknown: 'Unknown' } as const;
const int = (value: number | string) => formatInt(Number(value));
const credits = (value: number | string) => formatCredits(Number(value));

export function OverviewView() {
  const rpc = useRpc();
  const query = useQuery({ queryKey: ['overview'], queryFn: () => rpc.call('getOverview', {}) });
  return (
    <section aria-label="Overview">
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && <p role="alert">Could not load the overview: {query.error.message}</p>}
      {query.data && <OverviewBody overview={query.data} />}
    </section>
  );
}

function OverviewBody({ overview }: { overview: Overview }) {
  return (
    <>
      <div className="cards">
        <PeriodCard title="Today" totals={overview.today} />
        <PeriodCard title="This month" totals={overview.month} />
      </div>
      <p>
        Failure rate this month:{' '}
        <Measure measure={overview.failureRate} format={(value) => formatPercent(Number(value))} />
      </p>
      {overview.byModel.length === 0 ? (
        <p className="muted">No usage recorded this month yet.</p>
      ) : (
        <>
          <h3>By model</h3>
          <DataTable
            caption="Usage by model"
            columns={modelColumns}
            rows={overview.byModel}
            rowKey={(row) => `${row.key}|${row.host ?? ''}`}
            empty=""
          />
          <h3>By workspace</h3>
          <DataTable
            caption="Usage by workspace"
            columns={workspaceColumns}
            rows={overview.byWorkspace}
            rowKey={(row) => row.key}
            empty=""
          />
          <h3>By host</h3>
          <DataTable
            caption="Usage by host"
            columns={[
              { id: 'host', header: 'Host', cell: (row) => HOST_LABEL[row.host] },
              { id: 'sessions', header: 'Sessions', align: 'end', cell: (row) => formatInt(row.sessions) },
              { id: 'turns', header: 'Turns', align: 'end', cell: (row) => formatInt(row.turns) },
            ]}
            rows={overview.hostSplit}
            rowKey={(row) => row.host}
            empty=""
          />
        </>
      )}
    </>
  );
}

function PeriodCard({ title, totals }: { title: string; totals: PeriodTotals }) {
  return (
    <section className="card" aria-label={title}>
      <h3>{title}</h3>
      <p className="muted">{totals.from === totals.to ? totals.from : `${totals.from} → ${totals.to}`}</p>
      <dl className="facts">
        <dt>Sessions</dt>
        <dd>{formatInt(totals.sessions)}</dd>
        <dt>Turns</dt>
        <dd>{formatInt(totals.turns)}</dd>
        <dt>Input tokens</dt>
        <dd>
          <Measure measure={totals.inputTokens} format={int} />
        </dd>
        <dt>Output tokens</dt>
        <dd>
          <Measure measure={totals.outputTokens} format={int} />
        </dd>
        <dt>Credits</dt>
        <dd>
          <Measure measure={totals.credits} format={credits} />
        </dd>
      </dl>
    </section>
  );
}

const usageColumns: Column<BreakdownRow>[] = [
  { id: 'sessions', header: 'Sessions', align: 'end', cell: (row) => formatInt(row.sessions) },
  { id: 'turns', header: 'Turns', align: 'end', cell: (row) => formatInt(row.turns) },
  {
    id: 'input',
    header: 'Input',
    align: 'end',
    cell: (row) => <Measure measure={row.inputTokens} format={int} />,
  },
  {
    id: 'output',
    header: 'Output',
    align: 'end',
    cell: (row) => <Measure measure={row.outputTokens} format={int} />,
  },
  {
    id: 'credits',
    header: 'Credits',
    align: 'end',
    cell: (row) => <Measure measure={row.credits} format={credits} />,
  },
];
const modelColumns: Column<BreakdownRow>[] = [
  { id: 'model', header: 'Model', cell: (row) => row.label },
  { id: 'host', header: 'Host', cell: (row) => (row.host === null ? '' : HOST_LABEL[row.host]) },
  ...usageColumns,
];
const workspaceColumns: Column<BreakdownRow>[] = [
  { id: 'workspace', header: 'Workspace', cell: (row) => row.label },
  ...usageColumns,
];
```

`src/webview/views/SidebarView.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useRpc } from '../rpcContext';
import { Button } from '../ui/Button';
import { formatCredits, formatInt } from '../ui/format';
import { Measure } from '../ui/Measure';
import { IndexStatus } from './IndexStatus';

export function SidebarView() {
  const rpc = useRpc();
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => rpc.call('getOverview', {}) });
  return (
    <>
      <h1>Copilot Insights</h1>
      {overview.isError && <p role="alert">Could not load the overview: {overview.error.message}</p>}
      {overview.data && (
        <section aria-label="Today">
          <h3>Today</h3>
          <dl className="facts">
            <dt>Input tokens</dt>
            <dd>
              <Measure
                measure={overview.data.today.inputTokens}
                format={(value) => formatInt(Number(value))}
              />
            </dd>
            <dt>Output tokens</dt>
            <dd>
              <Measure
                measure={overview.data.today.outputTokens}
                format={(value) => formatInt(Number(value))}
              />
            </dd>
            <dt>Credits</dt>
            <dd>
              <Measure
                measure={overview.data.today.credits}
                format={(value) => formatCredits(Number(value))}
              />
            </dd>
          </dl>
        </section>
      )}
      <IndexStatus />
      <Button
        variant="primary"
        onClick={() => {
          void rpc.call('openDashboard', {});
        }}
      >
        Open dashboard
      </Button>
    </>
  );
}
```

Replace `src/webview/App.tsx`:

```tsx
import { useState } from 'react';
import { Button } from './ui/Button';
import { IndexStatus } from './views/IndexStatus';
import { OverviewView } from './views/OverviewView';
import { SessionDetailView } from './views/SessionDetailView';
import { SessionsView } from './views/SessionsView';
import { SidebarView } from './views/SidebarView';

export function App({ view }: { view: 'dashboard' | 'sidebar' }) {
  return (
    <main className={`app app--${view}`}>{view === 'sidebar' ? <SidebarView /> : <DashboardView />}</main>
  );
}

function DashboardView() {
  const [tab, setTab] = useState<'overview' | 'sessions'>('overview');
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <h1>Copilot Insights</h1>
      <IndexStatus />
      <nav className="tabs" aria-label="Dashboard sections">
        {(['overview', 'sessions'] as const).map((name) => (
          <Button
            key={name}
            variant={tab === name ? 'primary' : 'secondary'}
            aria-current={tab === name ? 'page' : undefined}
            onClick={() => {
              setTab(name);
              setSelected(null);
            }}
          >
            {name === 'overview' ? 'Overview' : 'Sessions'}
          </Button>
        ))}
      </nav>
      {tab === 'overview' && <OverviewView />}
      {tab === 'sessions' &&
        (selected === null ? (
          <SessionsView onOpen={setSelected} />
        ) : (
          <SessionDetailView
            id={selected}
            onBack={() => {
              setSelected(null);
            }}
          />
        ))}
    </>
  );
}
```

Append to `src/webview/styles.css`:

```css
.tabs {
  display: flex;
  gap: 4px;
  margin: 8px 0 12px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16em, 1fr));
  gap: 12px;
}
```

Update `src/webview/App.test.tsx` for the new shell: the dashboard opens on the Overview tab, so each test host
also provides `getOverview: overview()`; the third test keeps using `findAllByRole('alert')`. Replace the
"open a session" test from Task 2.5 so it first clicks the "Sessions" tab button. Add a test that the sidebar
view renders `SidebarView` (host provides `getOverview` and `getIndexStatus`, heading "Copilot Insights", and a
button "Open dashboard").

Run: `pnpm vitest run src/webview` — Expected: PASS.

- [ ] **Step 4: Verify and commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(webview): add overview dashboard, tabs and sidebar summary"
```

---

## Task 2.7: Clear, export, retention and legacy-data cleanup

**Files:**

- Create: `src/core/clear/clearService.ts`, `clearService.test.ts`, `describeScope.ts`, `describeScope.test.ts`,
  `src/core/export/exportJson.ts`, `exportJson.test.ts`, `src/core/legacy/legacyFiles.ts`, `legacyFiles.test.ts`,
  `src/extension/dataCommands.ts`, `test/integration/commands.test.ts`
- Modify: `src/shared/dto.ts` (add `clearScopeSchema`), `src/shared/protocol.ts`, `src/extension/webviewHost/rpcHost.test.ts`,
  `src/extension/extension.ts`, `package.json`, `src/webview/views/SessionDetailView.tsx` (+test),
  `src/webview/views/SessionsView.tsx` (+test)

**Interfaces:**

- Consumes: `SessionStore.deleteSessions/clearContent`, `IngestStateStore.addTombstones/getTombstones`,
  `getSessionDetail`, `scanChatSessions`, `createFixtureUserDir`, `resolveStorageRoots`.
- Produces (`shared/dto.ts`): `clearScopeSchema` / `ClearScope` =
  `{kind:'session';id} | {kind:'sessionContent';id} | {kind:'beforeDay';day} | {kind:'workspace';workspace} | {kind:'everything'} | {kind:'allContent'}`.
- Produces: `ClearService { count(scope): number; clear(scope): { sessions: number } }`,
  `describeScope(scope, count): { title; detail; confirmLabel; destructive }`,
  `exportIndex(database, now): ExportDocument`, `findLegacyFiles(dir): string[]`, `deleteLegacyFiles(dir): number`.
- Produces (RPC): `clearData({ scope }) → { confirmed, sessions }`, `exportData({}) → { saved }`.
- Retention: the `copilotInsights.retentionDays` setting and purge already exist (Phase 1); this task only
  documents and surfaces them.
- Rules: deletions write `deleted` tombstones; content clears write `content-cleared` tombstones; confirmation
  is a modal in extension code; only this extension's index and its own legacy files are ever touched.

- [ ] **Step 1: Write the failing clear-service tests** — `src/core/clear/clearService.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { createFixtureUserDir } from '../../../test/fixtures/fixtures';
import { seededStore } from '../../../test/fixtures/sessions';
import { resolveStorageRoots } from '../ingest/roots';
import { scanChatSessions } from '../ingest/scanner';
import { IngestStateStore } from '../storage/ingestStateStore';
import { localDay } from '../time';
import { ClearService } from './clearService';

const AUTO_START = 1790000001000;
const BYOK_START = 1790100000000;

function setup() {
  const { database, sessions } = seededStore();
  const state = new IngestStateStore(database);
  return { database, sessions, state, clear: new ClearService(database, sessions, state, () => 42) };
}
const ids = (database: ReturnType<typeof setup>['database']) =>
  (database.db.prepare('SELECT id FROM sessions ORDER BY id').all() as { id: string }[]).map((row) => row.id);

describe('ClearService', () => {
  it('counts without changing anything', () => {
    const { clear, database } = setup();
    expect(clear.count({ kind: 'everything' })).toBe(2);
    expect(clear.count({ kind: 'session', id: 'nope' })).toBe(0);
    expect(ids(database)).toEqual(['fx-auto-1', 'fx-byok-1']);
  });

  it('deletes one session and tombstones it', () => {
    const { clear, database, state } = setup();
    expect(clear.clear({ kind: 'session', id: 'fx-auto-1' })).toEqual({ sessions: 1 });
    expect(ids(database)).toEqual(['fx-byok-1']);
    expect(state.getTombstones()).toEqual({ 'fx-auto-1': 'deleted' });
  });

  it('clears conversation content but keeps telemetry, and tombstones it as content-cleared', () => {
    const { clear, database, state } = setup();
    clear.clear({ kind: 'sessionContent', id: 'fx-auto-1' });
    const row = database.db
      .prepare(
        "SELECT count(user_text) AS text, sum(prompt_tokens) AS tokens FROM turns WHERE session_id = 'fx-auto-1'",
      )
      .get() as { text: number; tokens: number };
    expect(row).toEqual({ text: 0, tokens: 54000 });
    expect(state.getTombstones()).toEqual({ 'fx-auto-1': 'content-cleared' });
  });

  it('deletes by day, by workspace, and everything; clears all content', () => {
    const a = setup();
    a.clear.clear({ kind: 'beforeDay', day: localDay(BYOK_START) });
    expect(ids(a.database)).toEqual(['fx-byok-1']);
    const b = setup();
    b.clear.clear({ kind: 'workspace', workspace: 'alpha' });
    expect(ids(b.database)).toEqual(['fx-byok-1']);
    const c = setup();
    expect(c.clear.clear({ kind: 'everything' })).toEqual({ sessions: 2 });
    expect(ids(c.database)).toEqual([]);
    expect(Object.values(c.state.getTombstones())).toEqual(['deleted', 'deleted']);
    const d = setup();
    d.clear.clear({ kind: 'allContent' });
    expect(ids(d.database)).toEqual(['fx-auto-1', 'fx-byok-1']);
    expect((d.database.db.prepare('SELECT count(user_text) AS n FROM turns').get() as { n: number }).n).toBe(
      0,
    );
    expect(AUTO_START).toBeLessThan(BYOK_START);
  });

  it('stays cleared when the still-existing Copilot files are scanned again', () => {
    const { clear, state } = setup();
    clear.clear({ kind: 'session', id: 'fx-auto-1' });
    clear.clear({ kind: 'sessionContent', id: 'fx-byok-1' });
    const { userDir } = createFixtureUserDir();
    const { results, stats } = scanChatSessions({
      roots: resolveStorageRoots({ userDirs: [userDir] }),
      known: {},
      captureLevel: 'full',
      tombstones: state.getTombstones(),
    });
    expect(results.some((result) => result.session?.id === 'fx-auto-1')).toBe(false);
    expect(stats.deleted).toBe(1);
    const byok = results.find((result) => result.session?.id === 'fx-byok-1');
    expect(byok?.session?.turns.every((turn) => turn.userText === null)).toBe(true);
  });
});
```

`src/core/clear/describeScope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { describeScope } from './describeScope';

describe('describeScope', () => {
  it('words a destructive delete and reassures that Copilot history is untouched', () => {
    const text = describeScope({ kind: 'session', id: 'x' }, 1);
    expect(text).toMatchObject({ destructive: true, confirmLabel: 'Delete session' });
    expect(text.title).toBe('Delete this session from Copilot Insights?');
    expect(text.detail).toContain("Copilot's own chat history is not touched");
  });

  it('words a content clear as non-deleting and pluralizes', () => {
    const text = describeScope({ kind: 'allContent' }, 3);
    expect(text).toMatchObject({ destructive: false, confirmLabel: 'Clear text' });
    expect(text.title).toBe('Clear conversation text from 3 sessions?');
    expect(text.detail).toContain('Tokens, credits, models and file paths are kept');
  });

  it('names the day and workspace', () => {
    expect(describeScope({ kind: 'beforeDay', day: '2026-08-01' }, 12).title).toBe(
      'Delete 12 sessions from before 2026-08-01?',
    );
    expect(describeScope({ kind: 'workspace', workspace: 'alpha' }, 1).title).toBe(
      'Delete 1 session from workspace "alpha"?',
    );
    expect(describeScope({ kind: 'everything' }, 5).title).toBe(
      'Delete all 5 sessions from Copilot Insights?',
    );
  });
});
```

Run: `pnpm vitest run src/core/clear` — Expected: FAIL (modules not found).

- [ ] **Step 2: Implement scopes and the service**

In `src/shared/dto.ts` append:

```ts
// ---- clearing ----
export const clearScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session'), id: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('sessionContent'), id: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('beforeDay'), day: dayString }),
  z.object({ kind: z.literal('workspace'), workspace: z.string().min(1).max(500) }),
  z.object({ kind: z.literal('everything') }),
  z.object({ kind: z.literal('allContent') }),
]);
export type ClearScope = z.infer<typeof clearScopeSchema>;
```

`src/core/clear/clearService.ts`:

```ts
import type { ClearScope } from '../../shared/dto';
import type { Database } from '../storage/database';
import type { IngestStateStore } from '../storage/ingestStateStore';
import type { SessionStore } from '../storage/sessionStore';

/** Scopes that remove sessions entirely (the others only remove conversation text). */
export function deletesSessions(scope: ClearScope): boolean {
  return scope.kind !== 'sessionContent' && scope.kind !== 'allContent';
}

/**
 * Clears this extension's index only. Tombstones make the result survive rescans, because Copilot's own files
 * (which we never modify) still contain the data.
 */
export class ClearService {
  constructor(
    private readonly database: Database,
    private readonly sessions: SessionStore,
    private readonly state: IngestStateStore,
    private readonly now: () => number = Date.now,
  ) {}

  count(scope: ClearScope): number {
    return this.idsFor(scope).length;
  }

  clear(scope: ClearScope): { sessions: number } {
    const ids = this.idsFor(scope);
    if (ids.length === 0) return { sessions: 0 };
    this.database.transaction(() => {
      if (deletesSessions(scope)) {
        this.state.addTombstones(ids, 'deleted', this.now());
        this.sessions.deleteSessions(ids);
      } else {
        this.state.addTombstones(ids, 'content-cleared', this.now());
        this.sessions.clearContent(ids);
      }
    });
    return { sessions: ids.length };
  }

  private idsFor(scope: ClearScope): string[] {
    const { db } = this.database;
    const rows = (() => {
      switch (scope.kind) {
        case 'session':
        case 'sessionContent':
          return db.prepare('SELECT id FROM sessions WHERE id = :id').all({ id: scope.id });
        case 'beforeDay':
          return db.prepare('SELECT id FROM sessions WHERE day < :day').all({ day: scope.day });
        case 'workspace':
          return db
            .prepare('SELECT id FROM sessions WHERE workspace = :workspace')
            .all({ workspace: scope.workspace });
        case 'everything':
        case 'allContent':
          return db.prepare('SELECT id FROM sessions').all();
      }
    })() as unknown as { id: string }[];
    return rows.map((row) => row.id);
  }
}
```

`src/core/clear/describeScope.ts`:

```ts
import type { ClearScope } from '../../shared/dto';
import { deletesSessions } from './clearService';

const sessionsOf = (count: number): string => `${String(count)} session${count === 1 ? '' : 's'}`;

const REASSURE = "Only Copilot Insights' own index is affected; Copilot's own chat history is not touched.";

/** Confirmation-dialog wording, shared by every entry point so the promise is identical everywhere. */
export function describeScope(
  scope: ClearScope,
  count: number,
): { title: string; detail: string; confirmLabel: string; destructive: boolean } {
  const destructive = deletesSessions(scope);
  const title = ((): string => {
    switch (scope.kind) {
      case 'session':
        return 'Delete this session from Copilot Insights?';
      case 'sessionContent':
        return 'Clear conversation text from this session?';
      case 'beforeDay':
        return `Delete ${sessionsOf(count)} from before ${scope.day}?`;
      case 'workspace':
        return `Delete ${sessionsOf(count)} from workspace "${scope.workspace}"?`;
      case 'everything':
        return `Delete all ${sessionsOf(count)} from Copilot Insights?`;
      case 'allContent':
        return `Clear conversation text from ${sessionsOf(count)}?`;
    }
  })();
  const detail = destructive
    ? `${REASSURE} Deleted sessions will not be re-imported.`
    : `${REASSURE} Tokens, credits, models and file paths are kept; prompts, responses, titles and tool arguments are removed.`;
  return {
    title,
    detail,
    confirmLabel: destructive ? (scope.kind === 'session' ? 'Delete session' : 'Delete') : 'Clear text',
    destructive,
  };
}
```

Run: `pnpm vitest run src/core/clear` — Expected: PASS.

- [ ] **Step 3: Export and legacy cleanup (test first)**

`src/core/export/exportJson.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { exportIndex } from './exportJson';

describe('exportIndex', () => {
  it('exports every session with provenance-tagged measurements and no tool arguments', () => {
    const doc = exportIndex(seededStore().database, 1790000000000);
    expect(doc).toMatchObject({ format: 'copilot-insights-export', version: 1 });
    expect(doc.exportedAt).toBe(new Date(1790000000000).toISOString());
    expect(doc.sessions.map((session) => session.id).sort()).toEqual(['fx-auto-1', 'fx-byok-1']);
    expect(doc.sessions[0]?.turns[0]?.inputTokens.provenance).toBeDefined();
    expect(JSON.stringify(doc)).not.toContain('"args"');
  });

  it('respects the stored capture level: no text at metrics', () => {
    const doc = exportIndex(seededStore('metrics').database, 1);
    expect(doc.sessions.every((session) => session.turns.every((turn) => turn.userText === null))).toBe(true);
  });

  it('is an empty document for an empty index', () => {
    const { database } = seededStore();
    database.db.exec('DELETE FROM sessions');
    expect(exportIndex(database, 1).sessions).toEqual([]);
  });
});
```

`src/core/legacy/legacyFiles.test.ts`:

```ts
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deleteLegacyFiles, findLegacyFiles } from './legacyFiles';

describe('legacy v0.2 data', () => {
  it('finds only the known legacy files and deletes exactly those', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-legacy-'));
    for (const name of ['usage.sqlite3', 'usage.sqlite3-wal', 'usage.json', 'insights.db', 'scanner.lock']) {
      writeFileSync(join(dir, name), 'x');
    }
    expect(
      findLegacyFiles(dir)
        .map((file) => file.split(/[\\/]/).pop())
        .sort(),
    ).toEqual(['usage.json', 'usage.sqlite3', 'usage.sqlite3-wal']);
    expect(deleteLegacyFiles(dir)).toBe(3);
    expect(findLegacyFiles(dir)).toEqual([]);
    expect(existsSync(join(dir, 'insights.db'))).toBe(true);
    expect(existsSync(join(dir, 'scanner.lock'))).toBe(true);
  });

  it('is a no-op for a missing directory', () => {
    expect(findLegacyFiles(join(tmpdir(), 'ci-does-not-exist-xyz'))).toEqual([]);
  });
});
```

Run: `pnpm vitest run src/core/export src/core/legacy` — Expected: FAIL.

`src/core/export/exportJson.ts`:

```ts
import type { SessionDetail } from '../../shared/dto';
import type { Database } from '../storage/database';
import { getSessionDetail } from '../query/sessionDetail';

export interface ExportDocument {
  format: 'copilot-insights-export';
  version: 1;
  exportedAt: string;
  sessions: SessionDetail[];
}

/** The whole index as JSON: exactly what the dashboard can show (so no tool arguments), at the stored capture level. */
export function exportIndex(database: Pick<Database, 'db'>, now: number): ExportDocument {
  const ids = (
    database.db.prepare('SELECT id FROM sessions ORDER BY started_at, id').all() as unknown as {
      id: string;
    }[]
  ).map((row) => row.id);
  return {
    format: 'copilot-insights-export',
    version: 1,
    exportedAt: new Date(now).toISOString(),
    sessions: ids.flatMap((id) => getSessionDetail(database, id) ?? []),
  };
}
```

`src/core/legacy/legacyFiles.ts`:

```ts
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Files written by the v0.2 prototype into this extension's own global storage. Nothing else is ever listed. */
export const LEGACY_FILES = [
  'usage.sqlite3',
  'usage.sqlite3-wal',
  'usage.sqlite3-shm',
  'usage.json',
] as const;

export function findLegacyFiles(dir: string): string[] {
  return LEGACY_FILES.map((name) => join(dir, name)).filter((file) => existsSync(file));
}

export function deleteLegacyFiles(dir: string): number {
  const files = findLegacyFiles(dir);
  for (const file of files) rmSync(file, { force: true });
  return files.length;
}
```

Run: `pnpm vitest run src/core` — Expected: PASS.

- [ ] **Step 4: RPC, extension commands and manifest**

Protocol test (append to `src/shared/protocol.test.ts`):

```ts
it('validates clearData scopes and rejects unknown kinds or malformed days', () => {
  const params = rpcSchemas.clearData.params;
  expect(params.safeParse({ scope: { kind: 'everything' } }).success).toBe(true);
  expect(params.safeParse({ scope: { kind: 'session', id: 'abc' } }).success).toBe(true);
  expect(params.safeParse({ scope: { kind: 'beforeDay', day: '2026-9-1' } }).success).toBe(false);
  expect(params.safeParse({ scope: { kind: 'dropTables' } }).success).toBe(false);
});
```

Run: `pnpm vitest run src/shared/protocol.test.ts` — Expected: FAIL. In `protocol.ts` add
(import `clearScopeSchema` from `./dto`):

```ts
  clearData: {
    params: z.object({ scope: clearScopeSchema }),
    result: z.object({ confirmed: z.boolean(), sessions: z.number() }),
  },
  exportData: { params: z.object({}), result: z.object({ saved: z.boolean() }) },
```

Add matching stubs to the handlers map in `rpcHost.test.ts`:
`clearData: () => ({ confirmed: false, sessions: 0 }), exportData: () => ({ saved: false }),`.
Run: `pnpm vitest run src/shared src/extension` — Expected: PASS.

`src/extension/dataCommands.ts` (glue; unit-testable logic lives in core):

```ts
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { ClearScope } from '../shared/dto';
import { ClearService } from '../core/clear/clearService';
import { describeScope } from '../core/clear/describeScope';
import { exportIndex } from '../core/export/exportJson';
import { deleteLegacyFiles, findLegacyFiles } from '../core/legacy/legacyFiles';
import type { Database } from '../core/storage/database';

export interface DataCommandDeps {
  database: Database;
  clear: ClearService;
  storageDir: string;
  globalState: vscode.Memento;
  notifyChanged(): void;
}

const LEGACY_PROMPTED = 'legacyDataPrompted';

/** Confirms with a modal, then clears. Used by the webview RPC and the command palette alike. */
export async function confirmAndClear(
  deps: DataCommandDeps,
  scope: ClearScope,
): Promise<{ confirmed: boolean; sessions: number }> {
  const count = deps.clear.count(scope);
  if (count === 0) {
    void vscode.window.showInformationMessage('Nothing to clear.');
    return { confirmed: false, sessions: 0 };
  }
  const text = describeScope(scope, count);
  const choice = await vscode.window.showWarningMessage(
    text.title,
    { modal: true, detail: text.detail },
    text.confirmLabel,
  );
  if (choice !== text.confirmLabel) return { confirmed: false, sessions: 0 };
  const result = deps.clear.clear(scope);
  deps.notifyChanged();
  return { confirmed: true, sessions: result.sessions };
}

export async function exportToFile(deps: DataCommandDeps): Promise<{ saved: boolean }> {
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(join(deps.storageDir, 'copilot-insights-export.json')),
    filters: { JSON: ['json'] },
    title: 'Export the Copilot Insights index',
  });
  if (target === undefined) return { saved: false };
  const document = exportIndex(deps.database, Date.now());
  await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(document, null, 2), 'utf8'));
  void vscode.window.showInformationMessage(`Exported ${String(document.sessions.length)} sessions.`);
  return { saved: true };
}

export async function clearFromPalette(deps: DataCommandDeps): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'Clear conversation text of all sessions', kind: 'allContent' },
      { label: 'Delete sessions before a date…', kind: 'beforeDay' },
      { label: 'Delete sessions of a workspace…', kind: 'workspace' },
      { label: 'Delete everything', kind: 'everything' },
    ] as const,
    { title: 'Copilot Insights: clear data' },
  );
  if (pick === undefined) return;
  if (pick.kind === 'allContent' || pick.kind === 'everything') {
    await confirmAndClear(deps, { kind: pick.kind });
  } else if (pick.kind === 'beforeDay') {
    const day = await vscode.window.showInputBox({
      prompt: 'Delete sessions started before this day (YYYY-MM-DD)',
      validateInput: (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? undefined : 'Use YYYY-MM-DD'),
    });
    if (day !== undefined) await confirmAndClear(deps, { kind: 'beforeDay', day });
  } else {
    const workspaces = (
      deps.database.db
        .prepare('SELECT DISTINCT workspace FROM sessions ORDER BY workspace')
        .all() as unknown as {
        workspace: string;
      }[]
    ).map((row) => row.workspace);
    const workspace = await vscode.window.showQuickPick(workspaces, { title: 'Workspace to delete' });
    if (workspace !== undefined) await confirmAndClear(deps, { kind: 'workspace', workspace });
  }
}

export async function deleteLegacyData(deps: DataCommandDeps): Promise<void> {
  const files = findLegacyFiles(deps.storageDir);
  if (files.length === 0) {
    void vscode.window.showInformationMessage('No data from the previous version was found.');
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    'Delete data from the previous Copilot Insights version?',
    {
      modal: true,
      detail: `${String(files.length)} file(s) in this extension's own storage (usage.sqlite3 / usage.json). The new version does not use them. Copilot's own files are not touched.`,
    },
    'Delete',
  );
  if (choice === 'Delete') deleteLegacyFiles(deps.storageDir);
}

/** One-time, non-modal offer on startup when old data exists. */
export function offerLegacyCleanup(deps: DataCommandDeps): void {
  if (findLegacyFiles(deps.storageDir).length === 0 || deps.globalState.get(LEGACY_PROMPTED) === true) return;
  void vscode.window
    .showInformationMessage(
      'Copilot Insights found data from the previous version that is no longer used.',
      'Review and delete',
      'Keep',
    )
    .then((choice) => {
      void deps.globalState.update(LEGACY_PROMPTED, true);
      if (choice === 'Review and delete') return deleteLegacyData(deps);
      return undefined;
    });
}
```

Wire it in `src/extension/extension.ts`: create
`const clear = new ClearService(database, sessions, state);` and
`const dataDeps = { database, clear, storageDir, globalState: context.globalState, notifyChanged: () => { dataChanged.fire(); } };`
(before the `handlers` object, after `dataChanged`); add handlers
`clearData: ({ scope }) => confirmAndClear(dataDeps, scope), exportData: () => exportToFile(dataDeps),`;
register commands `copilotInsights.clearData` → `clearFromPalette(dataDeps)`, `copilotInsights.exportData` →
`exportToFile(dataDeps)`, `copilotInsights.deleteLegacyData` → `deleteLegacyData(dataDeps)`; call
`offerLegacyCleanup(dataDeps)` after `controller.start()`.

In `package.json` `contributes.commands` add three entries with `"category": "Copilot Insights"`:
`copilotInsights.clearData` ("Clear Data…"), `copilotInsights.exportData` ("Export Index as JSON…"),
`copilotInsights.deleteLegacyData` ("Delete Data From Previous Version…").

`test/integration/commands.test.ts`:

```ts
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

describe('commands', () => {
  it('registers every Copilot Insights command', async () => {
    await vscode.extensions.getExtension('local.copilot-insights')?.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'copilotInsights.openDashboard',
      'copilotInsights.refreshSessions',
      'copilotInsights.rebuildIndex',
      'copilotInsights.clearData',
      'copilotInsights.exportData',
      'copilotInsights.deleteLegacyData',
    ]) {
      assert.ok(commands.includes(id), `${id} is not registered`);
    }
  });
});
```

Run: `pnpm typecheck && pnpm vitest run src/shared src/extension` — Expected: PASS.

- [ ] **Step 5: Webview entry points (test first)**

In `SessionDetailView.test.tsx` add:

```tsx
it('clears text or deletes the session through the extension, which asks for confirmation', async () => {
  const onBack = vi.fn();
  const user = userEvent.setup();
  const { calls } = view(
    { getSession: sessionDetail(), clearData: { confirmed: true, sessions: 1 } },
    onBack,
  );
  await user.click(await screen.findByRole('button', { name: 'Clear conversation text' }));
  expect(calls.at(-1)).toEqual({
    method: 'clearData',
    params: { scope: { kind: 'sessionContent', id: 'fx-auto-1' } },
  });
  expect(onBack).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Delete session' }));
  expect(calls.at(-1)).toEqual({
    method: 'clearData',
    params: { scope: { kind: 'session', id: 'fx-auto-1' } },
  });
  await vi.waitFor(() => {
    expect(onBack).toHaveBeenCalledOnce();
  });
});

it('stays on the session when the user cancels the confirmation', async () => {
  const onBack = vi.fn();
  const { calls } = view(
    { getSession: sessionDetail(), clearData: { confirmed: false, sessions: 0 } },
    onBack,
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Delete session' }));
  await vi.waitFor(() => {
    expect(calls.some((call) => call.method === 'clearData')).toBe(true);
  });
  expect(onBack).not.toHaveBeenCalled();
});
```

In `SessionsView.test.tsx` add:

```tsx
it('exports through the extension', async () => {
  const { calls } = renderWithHost(<SessionsView onOpen={vi.fn()} debounceMs={0} />, {
    listSessions: { rows: [], total: 0 },
    exportData: { saved: true },
  });
  await userEvent.click(await screen.findByRole('button', { name: 'Export…' }));
  expect(calls.map((call) => call.method)).toContain('exportData');
});
```

Run: `pnpm vitest run src/webview/views` — Expected: FAIL.

In `SessionDetailView.tsx`: `const queryClient = useQueryClient();` in `SessionDetailView`; add a helper

```tsx
const run = async (scope: ClearScope): Promise<boolean> => {
  const result = await rpc.call('clearData', { scope });
  if (result.confirmed) await queryClient.invalidateQueries();
  return result.confirmed;
};
```

and next to the back button render two buttons (only when `query.data` exists):
`<Button onClick={() => { void run({ kind: 'sessionContent', id }); }}>Clear conversation text</Button>` and
`<Button onClick={() => { void run({ kind: 'session', id }).then((deleted) => { if (deleted) onBack(); }); }}>Delete session</Button>`
(import `ClearScope` from `../../shared/dto` and `useQueryClient` from TanStack Query). In `SessionsView.tsx`
add, in the toolbar, `<Button onClick={() => { void rpc.call('exportData', {}); }}>Export…</Button>`.

Run: `pnpm vitest run src/webview` — Expected: PASS.

- [ ] **Step 6: Verify and commit**

```bash
pnpm format && pnpm verify
pnpm test:integration
git add -A
git commit -m "feat: add clear, export and legacy-data cleanup with tombstones and modal confirmation"
```

---

## Task 2.8: GitHub usage sync (port and fix)

**Files:**

- Create: `src/core/github/client.ts`, `client.test.ts`, `usage.ts`, `usage.test.ts`, `usageStore.ts`,
  `usageStore.test.ts`, `src/extension/githubAuth.ts`, `src/webview/views/GithubUsageCard.tsx`,
  `GithubUsageCard.test.tsx`
- Modify: `src/core/storage/migrations.ts` (v3), `src/core/clear/clearService.ts` (+test), `src/shared/dto.ts`,
  `src/shared/protocol.ts`, `src/extension/webviewHost/rpcHost.test.ts`, `src/extension/extension.ts`,
  `package.json`, `src/webview/views/OverviewView.tsx`

**Interfaces:**

- Verified against GitHub docs on 2026-09-30 (https://docs.github.com/en/rest/billing/usage):
  `GET /users/{username}/settings/billing/ai_credit/usage?year=&month=&day=` with header
  `X-GitHub-Api-Version: 2026-03-10`; response `{ timePeriod, user, usageItems: [{ product, sku, model, unitType,
pricePerUnit, grossQuantity, grossAmount, discountQuantity, discountAmount, netQuantity, netAmount }] }`.
  It covers usage billed to the user's **own** account only; users whose Copilot is licensed through an
  organization or enterprise get 404/403 here. The organization endpoint returns org aggregates, not the user's
  own usage, so it is **out of scope** (roadmap task 2.8 said "org reports … keep only the user's own row"; the
  current API makes that unnecessary — record this ruling in `docs/ROADMAP.md`).
  Re-verify the endpoint and version before shipping (Task 2.9).
- Produces: `GithubClient(fetchImpl, token).getJson(path)`, `GithubApiError`, `GITHUB_API`, `API_VERSION`,
  `creditsOf(item)`, `syncGithubUsage(deps): Promise<SyncOutcome>`,
  `GithubUsageStore { upsert(day, account, credits, syncedAt); list(fromDay, toDay); lastSyncedAt() }`.
- Produces (RPC): `getGithubUsage({ days }) → { days: {day, credits: Measured}[]; lastSyncedAt; account }`,
  `syncGithubUsage({}) → { signedIn, synced, unavailable, errors }`.
- Rules: the token is attached only to `https://api.github.com/…` requests built by `GithubClient`; user-supplied
  path segments are `encodeURIComponent`-ed; error messages never include response bodies; sync runs only when
  the user asks (button or command), never on a timer; GitHub credits are shown account-wide and are never
  attributed to sessions.

- [ ] **Step 1: Write the failing client tests (token containment)** — `src/core/github/client.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { API_VERSION, GithubApiError, GithubClient, type FetchLike } from './client';

function recorder(status = 200, body: unknown = { ok: true }) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    requests.push({ url, headers: init.headers });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'Status',
      json: () => Promise.resolve(body),
    });
  };
  return { requests, fetchImpl };
}

describe('GithubClient', () => {
  it('sends the token and API version only to api.github.com', async () => {
    const { requests, fetchImpl } = recorder();
    await new GithubClient(fetchImpl, 'tok').getJson(
      '/users/octo/settings/billing/ai_credit/usage?year=2026',
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      'https://api.github.com/users/octo/settings/billing/ai_credit/usage?year=2026',
    );
    expect(requests[0]?.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'X-GitHub-Api-Version': API_VERSION,
      Accept: 'application/vnd.github+json',
    });
  });

  it.each([
    'https://evil.example/x',
    '//evil.example/x',
    'http://api.github.com/x',
    'users/octo',
    '/\\evil.example',
  ])('refuses to send the token to %s', async (target) => {
    const { requests, fetchImpl } = recorder();
    await expect(new GithubClient(fetchImpl, 'tok').getJson(target)).rejects.toThrow();
    expect(requests).toEqual([]);
  });

  it('reports failures by status only, without echoing the response body', async () => {
    const { fetchImpl } = recorder(403, { message: 'secret-detail' });
    const error = await new GithubClient(fetchImpl, 'tok')
      .getJson('/user')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GithubApiError);
    expect((error as GithubApiError).status).toBe(403);
    expect((error as GithubApiError).message).not.toContain('secret-detail');
    expect((error as GithubApiError).message).not.toContain('tok');
  });
});
```

Run: `pnpm vitest run src/core/github/client.test.ts` — Expected: FAIL.

`src/core/github/client.ts`:

```ts
export const GITHUB_API = 'https://api.github.com';
/** Verified against https://docs.github.com/en/rest/billing/usage on 2026-09-30. */
export const API_VERSION = '2026-03-10';

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }>;

export class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GithubApiError';
  }
}

/** The only place the GitHub token is attached to a request, and only for https://api.github.com. */
export class GithubClient {
  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly token: string,
  ) {}

  async getJson(path: string): Promise<unknown> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
      throw new Error('GitHub API paths must be absolute and relative to api.github.com');
    }
    const url = new URL(path, GITHUB_API);
    if (url.origin !== GITHUB_API) throw new Error('Refusing to send credentials to another host');
    const response = await this.fetchImpl(url.toString(), {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'copilot-insights-vscode',
      },
    });
    if (!response.ok) {
      throw new GithubApiError(
        `GitHub API ${String(response.status)} ${response.statusText}`.trim(),
        response.status,
      );
    }
    return response.json();
  }
}
```

Run: `pnpm vitest run src/core/github/client.test.ts` — Expected: PASS.

- [ ] **Step 2: Migration v3, the store, and the usage parser (test first)**

`src/core/github/usageStore.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Database } from '../storage/database';
import { GithubUsageStore } from './usageStore';

describe('GithubUsageStore', () => {
  it('upserts per day and account, lists a range in order, and reports the last sync', () => {
    const store = new GithubUsageStore(new Database(':memory:'));
    expect(store.lastSyncedAt()).toBeNull();
    store.upsert('2026-09-02', 'octo', 2.5, 100);
    store.upsert('2026-09-01', 'octo', 1, 100);
    store.upsert('2026-09-02', 'octo', 3, 200);
    expect(store.list('2026-09-01', '2026-09-30')).toEqual([
      { day: '2026-09-01', credits: 1 },
      { day: '2026-09-02', credits: 3 },
    ]);
    expect(store.list('2026-09-02', '2026-09-02')).toHaveLength(1);
    expect(store.lastSyncedAt()).toBe(200);
    expect(store.account()).toBe('octo');
  });
});
```

Run: `pnpm vitest run src/core/github/usageStore.test.ts` — Expected: FAIL. Append migration v3:

```ts
  `
  CREATE TABLE github_daily_usage (
    day TEXT NOT NULL,
    account TEXT NOT NULL,
    credits REAL NOT NULL,
    synced_at INTEGER NOT NULL,
    PRIMARY KEY (day, account)
  );
  `,
```

`src/core/github/usageStore.ts`:

```ts
import type { Database } from '../storage/database';

export class GithubUsageStore {
  constructor(private readonly database: Pick<Database, 'db'>) {}

  upsert(day: string, account: string, credits: number, syncedAt: number): void {
    this.database.db
      .prepare(
        `INSERT INTO github_daily_usage (day, account, credits, synced_at) VALUES (:day, :account, :credits, :syncedAt)
         ON CONFLICT(day, account) DO UPDATE SET credits = excluded.credits, synced_at = excluded.synced_at`,
      )
      .run({ day, account, credits, syncedAt });
  }

  list(fromDay: string, toDay: string): { day: string; credits: number }[] {
    return this.database.db
      .prepare(
        'SELECT day, credits FROM github_daily_usage WHERE day >= :fromDay AND day <= :toDay ORDER BY day',
      )
      .all({ fromDay, toDay }) as unknown as { day: string; credits: number }[];
  }

  lastSyncedAt(): number | null {
    const row = this.database.db
      .prepare('SELECT max(synced_at) AS at FROM github_daily_usage')
      .get() as unknown as {
      at: number | null;
    };
    return row.at;
  }

  account(): string | null {
    const row = this.database.db
      .prepare('SELECT account FROM github_daily_usage ORDER BY synced_at DESC LIMIT 1')
      .get() as unknown as { account: string } | undefined;
    return row?.account ?? null;
  }
}
```

`src/core/github/usage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Database } from '../storage/database';
import { GithubApiError, GithubClient, type FetchLike } from './client';
import { creditsOf, syncGithubUsage } from './usage';
import { GithubUsageStore } from './usageStore';

describe('creditsOf', () => {
  it('reads credit-denominated quantities, preferring gross over net', () => {
    expect(creditsOf({ unitType: 'ai-credits', grossQuantity: 12, netQuantity: 4 })).toBe(12);
    expect(creditsOf({ unitType: 'credits', netQuantity: 3 })).toBe(3);
  });

  it('derives credits from dollars only for the documented 1-cent credit price', () => {
    expect(creditsOf({ unitType: 'requests', pricePerUnit: 0.01, grossAmount: 0.5 })).toBeCloseTo(50);
  });

  it('ignores items that are not credits and tolerates garbage', () => {
    expect(creditsOf({ unitType: 'minutes', grossQuantity: 9 })).toBe(0);
    expect(creditsOf({ unitType: 'credits', grossQuantity: 'lots' })).toBe(0);
    expect(creditsOf({})).toBe(0);
  });
});

function fakeGithub(handler: (url: string) => { status: number; body?: unknown }) {
  const urls: string[] = [];
  const fetchImpl: FetchLike = (url) => {
    urls.push(url);
    const { status, body } = handler(url);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'S',
      json: () => Promise.resolve(body),
    });
  };
  return { urls, client: new GithubClient(fetchImpl, 'tok') };
}

const deps = (client: GithubClient) => {
  const store = new GithubUsageStore(new Database(':memory:'));
  return { store, args: { client, user: 'octo', store, today: '2026-09-03', days: 3, now: () => 555 } };
};

describe('syncGithubUsage', () => {
  it('fetches each day, sums credit items and stores them', async () => {
    const { urls, client } = fakeGithub((url) => ({
      status: 200,
      body: {
        usageItems: [
          { unitType: 'ai-credits', grossQuantity: url.includes('day=3') ? 5 : 1 },
          { unitType: 'minutes', grossQuantity: 100 },
        ],
      },
    }));
    const { store, args } = deps(client);
    expect(await syncGithubUsage(args)).toEqual({ synced: 3, unavailable: false, errors: [] });
    expect(store.list('2026-09-01', '2026-09-03')).toEqual([
      { day: '2026-09-01', credits: 1 },
      { day: '2026-09-02', credits: 1 },
      { day: '2026-09-03', credits: 5 },
    ]);
    expect(
      urls.every((url) =>
        url.startsWith('https://api.github.com/users/octo/settings/billing/ai_credit/usage?'),
      ),
    ).toBe(true);
    expect(urls).toContain(
      'https://api.github.com/users/octo/settings/billing/ai_credit/usage?year=2026&month=9&day=3',
    );
  });

  it('encodes the username so it cannot change the request path or host', async () => {
    const { urls, client } = fakeGithub(() => ({ status: 200, body: { usageItems: [] } }));
    const { args } = deps(client);
    await syncGithubUsage({ ...args, user: '../../orgs/x', days: 1 });
    expect(urls[0]).toContain('/users/..%2F..%2Forgs%2Fx/settings/');
    expect(new URL(urls[0] ?? '').host).toBe('api.github.com');
  });

  it('reports "unavailable" once when usage is billed elsewhere (403/404) and stops', async () => {
    const { urls, client } = fakeGithub(() => ({ status: 404 }));
    const { args } = deps(client);
    const outcome = await syncGithubUsage(args);
    expect(outcome).toMatchObject({ synced: 0, unavailable: true });
    expect(urls.length).toBeLessThanOrEqual(args.days);
  });

  it('keeps going after a transient failure and lists the failed day', async () => {
    const { client } = fakeGithub((url) =>
      url.includes('day=2')
        ? { status: 500 }
        : { status: 200, body: { usageItems: [{ unitType: 'credits', grossQuantity: 2 }] } },
    );
    const { store, args } = deps(client);
    const outcome = await syncGithubUsage(args);
    expect(outcome.synced).toBe(2);
    expect(outcome.errors).toEqual(['2026-09-02: GitHub API 500 S']);
    expect(store.list('2026-09-01', '2026-09-03').map((row) => row.day)).toEqual([
      '2026-09-01',
      '2026-09-03',
    ]);
  });

  it('tolerates a malformed response body', async () => {
    const { client } = fakeGithub(() => ({ status: 200, body: 'not an object' }));
    const { store, args } = deps(client);
    expect((await syncGithubUsage({ ...args, days: 1 })).synced).toBe(1);
    expect(store.list('2026-09-01', '2026-09-03')).toEqual([{ day: '2026-09-03', credits: 0 }]);
  });

  it('exposes the API error type for callers', () => {
    expect(new GithubApiError('x', 401).status).toBe(401);
  });
});
```

Run: `pnpm vitest run src/core/github` — Expected: FAIL.

`src/core/github/usage.ts`:

```ts
import { z } from 'zod';
import { daysAgo } from '../time';
import { GithubApiError, type GithubClient } from './client';
import type { GithubUsageStore } from './usageStore';

// Lenient: a field of the wrong type becomes undefined instead of failing the whole response.
const lenientNumber = z.number().optional().catch(undefined);
const usageItem = z.looseObject({
  unitType: z.string().optional().catch(undefined),
  grossQuantity: lenientNumber,
  netQuantity: lenientNumber,
  quantity: lenientNumber,
  pricePerUnit: lenientNumber,
  grossAmount: lenientNumber,
});
const usageResponse = z.looseObject({ usageItems: z.array(usageItem).catch([]) });

export type UsageItem = z.input<typeof usageItem>;

/** Credits consumed by one billing line: credit-denominated quantity, else dollars at the 1-cent credit price. */
export function creditsOf(item: UsageItem): number {
  const parsed = usageItem.parse(item);
  if (parsed.unitType !== undefined && /credit/i.test(parsed.unitType)) {
    return parsed.grossQuantity ?? parsed.netQuantity ?? parsed.quantity ?? 0;
  }
  if (parsed.pricePerUnit === 0.01 && parsed.grossAmount !== undefined) return parsed.grossAmount / 0.01;
  return 0;
}

export interface SyncOutcome {
  synced: number;
  unavailable: boolean;
  errors: string[];
}

export interface SyncDeps {
  client: GithubClient;
  user: string;
  store: GithubUsageStore;
  today: string;
  days: number;
  now(): number;
}

/** Fetches the last `days` days of the user's own billed AI credits. Individual billing only. */
export async function syncGithubUsage(deps: SyncDeps): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { synced: 0, unavailable: false, errors: [] };
  for (let offset = deps.days - 1; offset >= 0; offset--) {
    const day = daysAgo(deps.today, offset);
    const [year, month, date] = day.split('-').map(Number);
    const path =
      `/users/${encodeURIComponent(deps.user)}/settings/billing/ai_credit/usage` +
      `?year=${String(year)}&month=${String(month)}&day=${String(date)}`;
    try {
      const body = usageResponse.safeParse(await deps.client.getJson(path));
      const items = body.success ? body.data.usageItems : [];
      const credits = items.reduce((sum, item) => sum + creditsOf(item), 0);
      deps.store.upsert(day, deps.user, credits, deps.now());
      outcome.synced++;
    } catch (error) {
      if (error instanceof GithubApiError && (error.status === 403 || error.status === 404)) {
        // Usage billed to an organization/enterprise is not exposed here; retrying every day would only repeat it.
        outcome.unavailable = true;
        return outcome;
      }
      outcome.errors.push(`${day}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return outcome;
}
```

Run: `pnpm vitest run src/core/github src/core/storage` — Expected: PASS.

- [ ] **Step 3: Clearing everything also drops the cached GitHub usage (test first)**

Append to `clearService.test.ts` inside the describe:

```ts
it('also drops cached GitHub usage when everything is deleted', () => {
  const { clear, database } = setup();
  database.db.prepare("INSERT INTO github_daily_usage VALUES ('2026-09-01', 'octo', 1, 1)").run();
  clear.clear({ kind: 'sessionContent', id: 'fx-auto-1' });
  expect((database.db.prepare('SELECT count(*) AS n FROM github_daily_usage').get() as { n: number }).n).toBe(
    1,
  );
  clear.clear({ kind: 'everything' });
  expect((database.db.prepare('SELECT count(*) AS n FROM github_daily_usage').get() as { n: number }).n).toBe(
    0,
  );
});
```

Run — Expected: FAIL. In `ClearService.clear`, inside the transaction's delete branch, add
`if (scope.kind === 'everything') this.database.db.exec('DELETE FROM github_daily_usage');`. Run — Expected: PASS.

- [ ] **Step 4: RPC, auth glue and the Overview card**

DTO additions (`src/shared/dto.ts`):

```ts
// ---- GitHub billed usage ----
export const githubUsageParams = z.object({ days: z.number().int().min(1).max(62) });
export const githubUsageSchema = z.object({
  days: z.array(z.object({ day: z.string(), credits: measuredNumber })),
  lastSyncedAt: z.number().nullable(),
  account: z.string().nullable(),
});
export type GithubUsage = z.infer<typeof githubUsageSchema>;
export const githubSyncSchema = z.object({
  signedIn: z.boolean(),
  synced: z.number(),
  unavailable: z.boolean(),
  errors: z.array(z.string()),
});
export type GithubSync = z.infer<typeof githubSyncSchema>;
```

Protocol entries (and handler stubs in `rpcHost.test.ts`):

```ts
  getGithubUsage: { params: githubUsageParams, result: githubUsageSchema },
  syncGithubUsage: { params: z.object({}), result: githubSyncSchema },
```

`src/extension/githubAuth.ts`:

```ts
import * as vscode from 'vscode';

/** `read:user` is enough for the user's own billing endpoint. Interactive only when the user asked to sync. */
export async function githubSession(interactive: boolean): Promise<vscode.AuthenticationSession | undefined> {
  return vscode.authentication.getSession(
    'github',
    ['read:user'],
    interactive ? { createIfNone: true } : { silent: true },
  );
}
```

In `extension.ts`: `const github = new GithubUsageStore(database);` and handlers:

```ts
    getGithubUsage: ({ days }) => {
      const today = localDay();
      return {
        days: github.list(daysAgo(today, days - 1), today).map((row) => ({
          day: row.day,
          credits: exact(row.credits, 'GitHub billing API: ai_credit/usage (account-wide, all devices)'),
        })),
        lastSyncedAt: github.lastSyncedAt(),
        account: github.account(),
      };
    },
    syncGithubUsage: async () => {
      const session = await githubSession(true);
      if (session === undefined) return { signedIn: false, synced: 0, unavailable: false, errors: [] };
      const client = new GithubClient(fetch, session.accessToken);
      const outcome = await syncGithubUsage({ client, user: session.account.label, store: github, today: localDay(), days: 31, now: Date.now });
      dataChanged.fire();
      return { signedIn: true, ...outcome };
    },
```

(Imports: `GithubClient`, `syncGithubUsage`, `GithubUsageStore`, `exact`, `daysAgo`, `githubSession`. `fetch`
matches `FetchLike` structurally; if TypeScript objects, wrap it:
`(url, init) => fetch(url, init)`.) Register command `copilotInsights.syncGithubUsage` running the same handler
and showing a message with the outcome; add it to `package.json` commands ("Sync GitHub Usage").

`GithubUsageCard.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { exactNumber } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { GithubUsageCard } from './GithubUsageCard';

const usage = {
  days: [
    { day: '2026-09-29', credits: exactNumber(3.5, 'github') },
    { day: '2026-09-30', credits: exactNumber(1, 'github') },
  ],
  lastSyncedAt: 1790000000000,
  account: 'octo',
};

describe('GithubUsageCard', () => {
  it('lists billed credits per day, labelled account-wide and never per session', async () => {
    renderWithHost(<GithubUsageCard />, { getGithubUsage: usage });
    const card = await screen.findByRole('region', { name: 'GitHub billed credits' });
    expect(within(card).getByText('3.5')).toBeInTheDocument();
    expect(within(card).getAllByText('Exact').length).toBe(2);
    expect(within(card).getByText(/all devices and clients/)).toBeInTheDocument();
    expect(within(card).getByText(/octo/)).toBeInTheDocument();
  });

  it('invites the first sync when nothing is stored', async () => {
    renderWithHost(<GithubUsageCard />, { getGithubUsage: { days: [], lastSyncedAt: null, account: null } });
    expect(await screen.findByText(/Not synced yet/)).toBeInTheDocument();
  });

  it('syncs on demand and explains each outcome', async () => {
    const user = userEvent.setup();
    const { rerender, calls } = renderWithHost(<GithubUsageCard />, {
      getGithubUsage: usage,
      syncGithubUsage: { signedIn: true, synced: 0, unavailable: true, errors: [] },
    });
    await user.click(await screen.findByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText(/billed to an organization or enterprise/)).toBeInTheDocument();
    expect(calls.map((call) => call.method)).toContain('syncGithubUsage');
    rerender(<GithubUsageCard />);
  });

  it('says so when the user is not signed in', async () => {
    renderWithHost(<GithubUsageCard />, {
      getGithubUsage: usage,
      syncGithubUsage: { signedIn: false, synced: 0, unavailable: false, errors: [] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText('Sign in to GitHub in VS Code to sync.')).toBeInTheDocument();
  });
});
```

Run: `pnpm vitest run src/webview/views/GithubUsageCard.test.tsx` — Expected: FAIL. (Remove the
unneeded `rerender` lines if lint flags them.)

`src/webview/views/GithubUsageCard.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRpc } from '../rpcContext';
import { Button } from '../ui/Button';
import { DataTable } from '../ui/DataTable';
import { formatCredits, formatDateTime } from '../ui/format';
import { Measure } from '../ui/Measure';

export function GithubUsageCard() {
  const rpc = useRpc();
  const queryClient = useQueryClient();
  const usage = useQuery({
    queryKey: ['githubUsage'],
    queryFn: () => rpc.call('getGithubUsage', { days: 14 }),
  });
  const sync = useMutation({
    mutationFn: () => rpc.call('syncGithubUsage', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['githubUsage'] }),
  });
  const message = ((): string | null => {
    if (sync.isError) return `Sync failed: ${sync.error.message}`;
    if (!sync.data) return null;
    if (!sync.data.signedIn) return 'Sign in to GitHub in VS Code to sync.';
    if (sync.data.unavailable) {
      return 'GitHub does not expose usage for this account here. Usage billed to an organization or enterprise is not available.';
    }
    if (sync.data.errors.length > 0)
      return `Synced ${String(sync.data.synced)} days; ${String(sync.data.errors.length)} failed.`;
    return `Synced ${String(sync.data.synced)} days.`;
  })();
  return (
    <section className="card" aria-label="GitHub billed credits">
      <h3>GitHub billed credits</h3>
      <p className="muted">
        Account-wide usage from GitHub billing, covering all devices and clients. It is not attributed to
        individual sessions.
      </p>
      {usage.data && usage.data.days.length > 0 ? (
        <DataTable
          caption="GitHub billed credits by day"
          columns={[
            { id: 'day', header: 'Day', cell: (row) => row.day },
            {
              id: 'credits',
              header: 'Credits',
              align: 'end',
              cell: (row) => (
                <Measure measure={row.credits} format={(value) => formatCredits(Number(value))} />
              ),
            },
          ]}
          rows={usage.data.days}
          rowKey={(row) => row.day}
          empty=""
        />
      ) : (
        usage.data && <p className="muted">Not synced yet.</p>
      )}
      {usage.data?.lastSyncedAt != null && (
        <p className="muted">
          Last synced {formatDateTime(usage.data.lastSyncedAt)}
          {usage.data.account !== null ? ` as ${usage.data.account}` : ''}
        </p>
      )}
      <Button
        disabled={sync.isPending}
        onClick={() => {
          sync.mutate();
        }}
      >
        Sync now
      </Button>
      {message !== null && <p role="status">{message}</p>}
    </section>
  );
}
```

Render `<GithubUsageCard />` at the bottom of `OverviewBody` in `OverviewView.tsx`, and give the OverviewView
and App tests a `getGithubUsage: { days: [], lastSyncedAt: null, account: null }` result so they do not error.

Run: `pnpm vitest run src/webview` and `pnpm typecheck` — Expected: PASS.

- [ ] **Step 5: Verify and commit**

Record the ruling in `docs/ROADMAP.md` (Phase 2 section, task 2.8): individual billing only; org endpoints
return aggregates, not the user's own row.

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(github): add opt-in GitHub billed-credit sync with token containment"
```

---

## Task 2.9: Real-data check, docs and phase exit

**Files:**

- Create: `scripts/smokeQueries.ts`
- Modify: `scripts/smokeReal.ts`, `README.md`, `CHANGELOG.md`, `docs/ROADMAP.md`, `package.json` (version 0.4.0)

**Interfaces:**

- Consumes: everything from Tasks 2.1–2.8; the existing `smokeReal.ts` normalization loop (read the file first
  and reuse its list of normalized sessions and its aggregate `promptTokens` counter).
- Produces: `checkQueryLayer(sessions: NormalizedSession[], expected: { promptTokens: number; credits: number }): string[]`
  returning a list of failures (empty = OK).

- [ ] **Step 1: Prove the query layer on this machine's real data**

`scripts/smokeQueries.ts`: build an in-memory `Database`, `SessionStore.replaceSession` every normalized session
at capture level `summaries`, then page through `InsightsQueries.listSessions` (limit 100) and assert, returning
failure strings rather than throwing:

- number of rows equals the number of sessions stored;
- the sum of every row's `inputTokens.value` equals `expected.promptTokens` (rows whose provenance is `derived`
  or `exact` both count; `unavailable` rows contribute 0), and likewise credits against `expected.credits`
  (tolerance 1e-6);
- no row with `credits.provenance.kind === 'exact'` has `credits.value === null`;
- `getSession` succeeds for the first 25 ids and never returns text at level `metrics` (re-run the load once at
  `metrics` and check `userText === null` everywhere);
- print **aggregates only**: row count, how many rows are exact/derived/unavailable for tokens and credits,
  and the analysis intent histogram (counts per intent). Never print titles, text, paths or workspaces.

Call it from `smokeReal.ts` after the existing checks; a non-empty failure list prints `FAIL: …` per item and
exits 1. Run: `pnpm smoke:real` — Expected: the existing `OK: all N requests became turns.` plus
`OK: query layer matches parsed totals` and a histogram. If a total mismatches, debug with
superpowers:systematic-debugging; do not loosen the check.

- [ ] **Step 2: Documentation and version**

- `README.md`: replace "temporarily unavailable" wording with a features section (Overview, Sessions, Session
  detail with analysis and provenance badges, clear/export/retention, opt-in GitHub sync), the privacy summary
  (capture levels, tombstones, what is and is not sent), the commands list, and the settings list. Keep the
  Development section.
- `CHANGELOG.md`: add `## 0.4.0 — parity dashboard` with the user-visible changes.
- `package.json`: `"version": "0.4.0"`.
- `docs/ROADMAP.md`: mark Phase 2 done in the phase table; record decisions **D14** (session list uses
  paging with "Load more" instead of virtualization: 50 rows per page keeps the DOM small and stays accessible)
  and **D15** (analysis cached in `session_analysis`, invalidated on ingest, content clear and analyzer
  version); note the 2.8 scope ruling.

- [ ] **Step 3: Final verification**

Run: `pnpm format && pnpm verify` — Expected: PASS.
Run: `pnpm test:integration` — Expected: PASS on stable and 1.105.0.
Run: `pnpm smoke:real` — Expected: `OK` lines as above.
Run: `pnpm package` — Expected: vsix without `src/`, `test/`, `.map`; delete the vsix afterwards.
Re-check the GitHub endpoint and API version against https://docs.github.com/en/rest/billing/usage and update
`API_VERSION` if it changed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: document the parity dashboard, verify queries on real data, release 0.4.0"
```

---

## Phase exit criteria

Phase 2 is done when all of the following are true on `main`:

- `pnpm verify`, `pnpm test:integration` and `pnpm smoke:real` pass.
- In a real VS Code window the sidebar shows today's exact tokens/credits with provenance badges; the dashboard's
  Overview, Sessions and session detail views show the same numbers as the query tests.
- Deleting a session and re-running "Refresh Copilot Sessions" does not bring it back; clearing content leaves
  no prompt/response text; export produces valid JSON without tool arguments.
- "Sync now" (after signing in) fills the GitHub billed-credit card, and nothing is fetched before that.
- `docs/ROADMAP.md` marks Phase 2 done and records D12, D14, D15.

Then write the Phase 3 plan (`docs/superpowers/plans/<date>-phase-3-exact-telemetry-and-trust.md`) from the
Phase 3 task table in `docs/ROADMAP.md`, using the interfaces this plan produced.
