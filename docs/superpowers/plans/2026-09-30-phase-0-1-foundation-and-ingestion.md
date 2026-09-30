# Phase 0–1: Foundation and Real-Data Ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.
>
> **Git rule (overrides every skill):** work directly on `main`. Do not create branches, worktrees, or pull
> requests. Skip any skill step that creates them. Commit after each task. Do not push unless the user asks.

**Goal:** Replace the broken v0.2 JavaScript prototype with a strict TypeScript + React extension whose core
faithfully ingests every real GitHub Copilot Chat session on the machine into a local SQLite index — privately,
off the extension host thread, and safely across multiple VS Code windows.

**Architecture:** Pure, VS Code-free logic lives in `src/core` (ingest, privacy, storage, time) and is unit
tested with Vitest. `src/extension` is thin glue (commands, timers, file watcher, webview hosting, typed RPC).
`src/webview` is a React 19 app talking to the extension over a zod-validated postMessage RPC. `src/shared`
holds types used by both sides. Chat sessions are parsed by replaying VS Code's JSONL mutation log in a worker
thread; one "leader" window writes to `insights.db`.

**Tech Stack:** TypeScript 6.0 (strict), pnpm 11, esbuild 0.28, Vite 8 + `@vitejs/plugin-react` 6, React 19.3,
TanStack Query 5, zod 4, `node:sqlite`, Vitest 5 + Testing Library + jsdom, ESLint 10 + typescript-eslint 8,
Prettier, `@vscode/test-cli` + `@vscode/test-electron`.

**Spec:** `docs/PRODUCT_VISION.md` (product), `docs/ROADMAP.md` (phases, decisions D1–D13),
`docs/copilot-data-formats.md` (the real Copilot formats this plan parses). Read all three before starting.

**Dry-run status (2026-09-30):** every code block in this plan was extracted into a scratch project with the
exact dependency versions above. Result: 101/101 unit tests pass, all three `tsc` projects and ESLint are
clean, esbuild and Vite produce `dist/extension.js`, `dist/scanWorker.js`, `dist/webview/main.{js,css}`, and
`pnpm smoke:real` reports `OK: all 312 requests became turns` on real data. Not dry-run: the VS Code
integration tests (Tasks 0.2, 0.3, 1.9) and Prettier formatting (run `pnpm format` as each task says).

## Global Constraints

- Work on `main` only; one Conventional Commit per task; never push without being asked.
- Before every commit: `pnpm format && pnpm verify` must pass.
- `engines.vscode` is `^1.105.0`; `@types/vscode` is pinned to `1.105.0`.
- TypeScript `~6.0.3` (typescript-eslint supports `<6.1.0`). Do not install TypeScript 7.
- Layering: `shared` → nothing environment-specific; `core` → `node:*`, `zod`, `shared`; `extension` →
  `vscode`, `core`, `shared`; `webview` → `react`, browser, `shared` (enforced by ESLint).
- No network access and no AI provider calls anywhere in Phases 0–1.
- Never print, log, or commit real prompt/response text, tool arguments, titles, or file contents. Fixtures
  are synthetic.
- Default capture level is `summaries`. `metrics` stores no text, titles, error messages, or tool arguments.
- Secrets are redacted before storage at every capture level.
- Webview CSP: `default-src 'none'`, scripts only with a per-load nonce, styles only from `webview.cspSource`;
  no inline `<script>`/`<style>`, no `dangerouslySetInnerHTML`.
- No heavy parsing on the extension host thread: production scans run in `dist/scanWorker.js`.
- The database file is `insights.db` in the extension's global storage. The legacy `usage.sqlite3` is left
  untouched in these phases (Phase 2 offers to delete it).

## Review Focus

These are the inputs most likely to hurt a real user that the vision implies but does not spell out. Each has
a test in the task that owns the code.

1. **Copilot is writing the session file while we scan it** (truncated last line) → parse everything before it,
   re-parse on the next change. Tests: Task 1.2 (replay) and Task 1.6 (scanner).
2. **Very large sessions** (hundreds of thousands of array items appended in one entry) → no call-stack
   overflow from spreading. Test: Task 1.2.
3. **The same session id appears in two files** (workspace moved or copied) → exactly one stored session, no
   orphaned turns. Test: Task 1.5.
4. **The user lowers the capture level after content was stored** (e.g. `full` → `metrics`) → previously stored
   text is scrubbed, even for sessions whose source file no longer exists. Tests: Task 1.5 and Task 1.8.
5. **Two VS Code windows are open** → only one writes; the other refreshes from the shared index. Tests:
   Task 1.7 (lock) and Task 1.8 (follower).

## File Structure

```
.github/workflows/ci.yml            CI: install, verify, integration tests (xvfb)
.vscode/launch.json, tasks.json      F5 debugging with a pre-launch build
.vscode-test.mjs                     integration test runner config (VS Code stable + 1.105.0)
.vscodeignore, .gitignore, .prettierrc.json, .prettierignore
pnpm-workspace.yaml                  approves esbuild's build script (pnpm 11)
esbuild.mjs                          bundles extension, scan worker, integration tests, smoke script
vite.config.mjs                      bundles the React webview to dist/webview/main.{js,css}
vitest.config.mjs                    unit test projects: node + webview (jsdom)
eslint.config.mjs                    strict type-checked lint + layering rules
tsconfig.json                        extension/core/shared/scripts/test (Node types)
scripts/smokeReal.ts                 real-data verification, aggregate output only
src/shared/provenance.ts             Measured<T>, exact/derived/inferred/unavailable
src/shared/protocol.ts               RPC method schemas and message unions
src/core/json.ts                     isRecord
src/core/time.ts                     localDay, daysAgo, retentionCutoff
src/core/ingest/types.ts             NormalizedSession/NormalizedTurn and friends
src/core/ingest/mutationLog.ts       replay VS Code's chat-session mutation log
src/core/ingest/chatSessionSchema.ts lenient zod schemas for the request fields we read
src/core/ingest/chatSession.ts       normalize replayed state into sessions/turns
src/core/ingest/roots.ts             where chat sessions live (profiles, empty windows, extra roots)
src/core/ingest/scanner.ts           list files, fingerprint, parse, apply capture level, honour tombstones
src/core/ingest/scanWorker.ts        worker-thread entry
src/core/ingest/runScan.ts           run a scan in a worker (or in-process for tests)
src/core/ingest/writerLock.ts        one writing window at a time
src/core/ingest/ingestService.ts     orchestrates scan → write → retention → notify
src/core/ingest/indexStatus.ts       status DTO for the webview
src/core/privacy/redact.ts           secret redaction
src/core/privacy/captureLevel.ts     metrics/summaries/full
src/core/storage/database.ts         node:sqlite wrapper, pragmas, migrations, transactions
src/core/storage/migrations.ts       schema v1
src/core/storage/sessionStore.ts     sessions/turns/tool_calls/file_events
src/core/storage/ingestStateStore.ts scan fingerprints, tombstones, meta
src/extension/extension.ts           composition root
src/extension/config.ts              typed settings
src/extension/ingestController.ts    timers, file watcher, config reactions
src/extension/webviewHost/*.ts           HTML/CSP, RPC host, dashboard panel, sidebar view
src/webview/*                        React app, RPC client, styles, tests
test/fixtures/                       synthetic chat-session fixtures + helpers
test/integration/                    tests that run inside VS Code
```

---

## Task 0.1: Toolchain, skeleton, and provenance types

**Files:**

- Restore from git history: `LICENSE`, `media/icon.svg` (the only non-code assets worth keeping)
- Create: `package.json`, `.gitignore`, `.vscodeignore`, `.vscode/launch.json`, `pnpm-workspace.yaml`, `.vscode/tasks.json`, `tsconfig.json`, `esbuild.mjs`, `vitest.config.mjs`, `eslint.config.mjs`,
  `.prettierrc.json`, `.prettierignore`, `src/extension/extension.ts`, `src/shared/provenance.ts`,
  `src/shared/provenance.test.ts`

**Interfaces:**

- Produces: `ProvenanceKind`, `Provenance`, `Measured<T>`, `exact`, `derived`, `inferred`, `unavailable`,
  `weakest(...kinds)`, `sumMeasured(items, source)` from `src/shared/provenance.ts`.

- [ ] **Step 1: Confirm the clean slate and restore the two assets**

The v0.2 JavaScript prototype was deleted from the working tree before this plan started (it stays in git
history at commit `46a53c9`; nothing in it is reused). Only Markdown files remain. Restore the license and the
activity-bar icon that `package.json` references:

```bash
ls                                   # expect: CHANGELOG.md CLAUDE.md README.md docs
mkdir -p media
git show 46a53c9:LICENSE > LICENSE
git show 46a53c9:media/icon.svg > media/icon.svg
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "copilot-insights",
  "displayName": "Copilot Insights",
  "description": "Local observability and optimization for native GitHub Copilot Chat sessions in VS Code.",
  "version": "0.3.0",
  "publisher": "local",
  "license": "MIT",
  "private": true,
  "repository": {
    "type": "git",
    "url": "https://github.com/sudh33rg/copilot-insights"
  },
  "packageManager": "pnpm@11.11.0",
  "engines": {
    "vscode": "^1.105.0"
  },
  "extensionKind": ["ui"],
  "categories": ["Other", "Machine Learning"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {},
  "scripts": {
    "build": "node esbuild.mjs",
    "build:prod": "node esbuild.mjs --production",
    "watch": "node esbuild.mjs --watch",
    "typecheck": "tsc -p tsconfig.json",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "verify": "pnpm run typecheck && pnpm run lint && pnpm run format:check && pnpm run test && pnpm run build",
    "vscode:prepublish": "pnpm run build:prod",
    "package": "vsce package --no-dependencies"
  }
}
```

- [ ] **Step 3: Install development dependencies**

pnpm 11 fails the install (`ERR_PNPM_IGNORED_BUILDS`) when a dependency's build script is not approved, and
`pnpm approve-builds` is interactive. Approve esbuild up front with `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esbuild: true
```

```bash
pnpm add -D typescript@~6.0.3 @types/node@22 @types/vscode@1.105.0 esbuild vitest eslint @eslint/js typescript-eslint globals prettier @vscode/vsce
```

Expected: `pnpm-lock.yaml` updated and esbuild's postinstall reported as `Done`.

- [ ] **Step 4: Write the config files**

`.gitignore`:

```gitignore
node_modules/
dist/
out/
coverage/
.vscode-test/
*.vsix
*.zip
.DS_Store
```

`.vscodeignore`:

```gitignore
**
!dist/**
dist/**/*.map
!media/**
!package.json
!README.md
!CHANGELOG.md
!LICENSE
```

`.prettierrc.json`:

```json
{
  "singleQuote": true,
  "printWidth": 110,
  "trailingComma": "all"
}
```

`.prettierignore`:

```gitignore
dist/
out/
coverage/
.vscode-test/
pnpm-lock.yaml
test/fixtures/
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/extension", "src/core", "src/shared", "scripts", "test"],
  "exclude": ["src/webview", "test/integration"]
}
```

`esbuild.mjs`:

```js
// Bundles extension-host code. The React webview is built separately by Vite (vite.config.mjs).
import { globSync } from 'node:fs';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const integration = process.argv.includes('--integration');

/** @type {import('esbuild').BuildOptions} */
const node = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  external: ['vscode'],
};

/** @type {import('esbuild').BuildOptions[]} */
const builds = [{ ...node, entryPoints: { extension: 'src/extension/extension.ts' }, outdir: 'dist' }];

if (integration) {
  builds.push({
    ...node,
    entryPoints: globSync('test/integration/**/*.test.ts'),
    outdir: 'out/integration',
    external: ['vscode', 'mocha'],
  });
}

const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
if (watch) {
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all(contexts.map((context) => context.rebuild()));
  await Promise.all(contexts.map((context) => context.dispose()));
}
```

`vitest.config.mjs`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/{core,shared,extension}/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
    ],
  },
});
```

`eslint.config.mjs`:

```js
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const layer = (message, paths, patterns) => ({
  'no-restricted-imports': ['error', { paths, patterns: [{ group: patterns, message }] }],
});

export default defineConfig([
  globalIgnores(['dist/**', 'out/**', 'coverage/**', '.vscode-test/**', 'node_modules/**']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: layer(
      'shared must stay environment-neutral (no vscode, node, react, or other layers).',
      ['vscode', 'react', 'react-dom'],
      ['node:*', '**/core/**', '**/extension/**', '**/webview/**'],
    ),
  },
  {
    files: ['src/core/**/*.ts'],
    rules: layer(
      'core may import only node:*, zod, core and shared.',
      ['vscode', 'react', 'react-dom'],
      ['**/extension/**', '**/webview/**'],
    ),
  },
  {
    files: ['src/extension/**/*.ts'],
    rules: layer('extension must not import the webview.', ['react', 'react-dom'], ['**/webview/**']),
  },
]);
```

`.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Copilot Insights",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "build"
    }
  ]
}
```

`.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "build",
      "type": "shell",
      "command": "pnpm run build",
      "group": { "kind": "build", "isDefault": true },
      "problemMatcher": []
    }
  ]
}
```

- [ ] **Step 5: Write the failing provenance test** — `src/shared/provenance.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { derived, exact, inferred, sumMeasured, unavailable, weakest } from './provenance';

describe('provenance', () => {
  it('builds tagged values', () => {
    expect(exact(5, 'a')).toEqual({ value: 5, provenance: { kind: 'exact', source: 'a' } });
    expect(derived(1, 'rule').provenance.kind).toBe('derived');
    expect(inferred('x', 'rule').provenance.kind).toBe('inferred');
    expect(unavailable('no data')).toEqual({
      value: null,
      provenance: { kind: 'unavailable', source: 'no data' },
    });
  });

  it('weakest picks the least trustworthy kind', () => {
    expect(weakest('exact', 'derived')).toBe('derived');
    expect(weakest('exact', 'inferred', 'derived')).toBe('inferred');
    expect(weakest()).toBe('unavailable');
  });

  it('sums exact values as exact', () => {
    expect(sumMeasured([exact(2, 'a'), exact(3, 'a')], 'total')).toEqual({
      value: 5,
      provenance: { kind: 'exact', source: 'total' },
    });
  });

  it('treats a partial sum as at most derived', () => {
    expect(sumMeasured([exact(2, 'a'), unavailable('missing')], 'total').provenance.kind).toBe('derived');
    expect(sumMeasured([inferred(2, 'a'), unavailable('missing')], 'total').provenance.kind).toBe('inferred');
  });

  it('reports a sum without known values as unavailable', () => {
    expect(sumMeasured([unavailable('x')], 'total')).toEqual({
      value: null,
      provenance: { kind: 'unavailable', source: 'total' },
    });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run src/shared/provenance.test.ts`
Expected: FAIL — cannot resolve `./provenance`.

- [ ] **Step 7: Implement `src/shared/provenance.ts`**

```ts
/** How much a value can be trusted. See docs/PRODUCT_VISION.md §7. */
export type ProvenanceKind = 'exact' | 'derived' | 'inferred' | 'unavailable';

/** Where a value came from; `source` names the concrete field or rule, e.g. "chatSessions.copilotCredits". */
export interface Provenance {
  readonly kind: ProvenanceKind;
  readonly source: string;
}

export interface Measured<T> {
  readonly value: T | null;
  readonly provenance: Provenance;
}

export const exact = <T>(value: T, source: string): Measured<T> => ({
  value,
  provenance: { kind: 'exact', source },
});
export const derived = <T>(value: T, source: string): Measured<T> => ({
  value,
  provenance: { kind: 'derived', source },
});
export const inferred = <T>(value: T, source: string): Measured<T> => ({
  value,
  provenance: { kind: 'inferred', source },
});
export const unavailable = <T>(source: string): Measured<T> => ({
  value: null,
  provenance: { kind: 'unavailable', source },
});

const STRENGTH: Record<ProvenanceKind, number> = { exact: 3, derived: 2, inferred: 1, unavailable: 0 };

/** Combining values keeps the weakest provenance so estimates never masquerade as exact telemetry. */
export function weakest(...kinds: readonly ProvenanceKind[]): ProvenanceKind {
  let result: ProvenanceKind | null = null;
  for (const kind of kinds) {
    if (result === null || STRENGTH[kind] < STRENGTH[result]) result = kind;
  }
  return result ?? 'unavailable';
}

/** Sums known values. A sum that skipped unavailable items is a lower bound, so it is at most `derived`. */
export function sumMeasured(items: readonly Measured<number>[], source: string): Measured<number> {
  const known = items.filter((item): item is Measured<number> & { value: number } => item.value !== null);
  if (known.length === 0) return unavailable(source);
  const kinds = known.map((item) => item.provenance.kind);
  const kind = known.length < items.length ? weakest('derived', ...kinds) : weakest(...kinds);
  return { value: known.reduce((sum, item) => sum + item.value, 0), provenance: { kind, source } };
}
```

- [ ] **Step 8: Write the extension skeleton** — `src/extension/extension.ts`

```ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Copilot Insights', { log: true });
  context.subscriptions.push(log);
  log.info(`Copilot Insights ${extensionVersion(context)} activated`);
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}

function extensionVersion(context: vscode.ExtensionContext): string {
  const manifest = context.extension.packageJSON as { version?: unknown };
  return typeof manifest.version === 'string' ? manifest.version : 'dev';
}
```

- [ ] **Step 9: Verify**

Run: `pnpm format && pnpm verify`
Expected: typecheck, lint, format check, 5 passing tests, and `dist/extension.js` built.

Manual check: press F5 in VS Code, open the Output view, choose "Copilot Insights", and confirm the
"activated" line.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: set up TypeScript toolchain and provenance types"
```

---

## Task 0.2: Integration test harness and CI

**Files:**

- Create: `.vscode-test.mjs`, `test/integration/tsconfig.json`, `test/integration/activation.test.ts`,
  `.github/workflows/ci.yml`
- Modify: `package.json` (scripts), `tsconfig.json` is unchanged (it already excludes `test/integration`)

**Interfaces:**

- Produces: `pnpm test:integration`; integration tests are bundled to `out/integration/*.test.js`.

- [ ] **Step 1: Install the harness**

```bash
pnpm add -D @vscode/test-cli @vscode/test-electron mocha @types/mocha
```

- [ ] **Step 2: Add scripts to `package.json`**

Add to `"scripts"`:

```json
"test:integration": "pnpm run build && node esbuild.mjs --integration && vscode-test",
```

Change `"typecheck"` to:

```json
"typecheck": "tsc -p tsconfig.json && tsc -p test/integration/tsconfig.json",
```

- [ ] **Step 3: Configure the runner** — `.vscode-test.mjs`

```js
import { defineConfig } from '@vscode/test-cli';

const base = {
  files: 'out/integration/**/*.test.js',
  launchArgs: ['--disable-extensions'],
  mocha: { timeout: 30_000 },
};

// Run against the newest VS Code and the oldest version we support (engines.vscode).
export default defineConfig([
  { ...base, label: 'stable', version: 'stable' },
  { ...base, label: 'floor', version: '1.105.0' },
]);
```

`test/integration/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "types": ["node", "mocha"] },
  "include": ["."],
  "exclude": []
}
```

- [ ] **Step 4: Write the integration tests** — `test/integration/activation.test.ts`

```ts
import * as assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as vscode from 'vscode';

const EXTENSION_ID = 'local.copilot-insights';

describe('extension host environment', () => {
  it('activates the extension', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test instance`);
    await extension.activate();
    assert.equal(extension.isActive, true);
  });

  it('provides node:sqlite with JSON functions (decision D3)', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (x INTEGER)');
    db.prepare('INSERT INTO t (x) VALUES (?)').run(41);
    const row = db.prepare("SELECT x + 1 AS y, json_array_length('[1,2]') AS n FROM t").get();
    assert.deepEqual({ ...row }, { y: 42, n: 2 });
    db.close();
  });

  it('reports whether FTS5 is compiled in (input to the Phase 2 search design)', () => {
    const db = new DatabaseSync(':memory:');
    let fts5 = true;
    try {
      db.exec('CREATE VIRTUAL TABLE f USING fts5(body)');
    } catch {
      fts5 = false;
    }
    db.close();
    console.log(`[capabilities] vscode=${vscode.version} fts5=${String(fts5)}`);
  });
});
```

- [ ] **Step 5: Run the integration tests**

Run: `pnpm test:integration`
Expected: both the `stable` and `floor` runs pass 3 tests. Record the printed `fts5=` values for both versions
under "Decisions" in `docs/ROADMAP.md` (add a line `D3a: FTS5 available at floor: yes/no`). If `node:sqlite`
fails at the floor, stop and report to the user: decision D3 must be revisited before continuing.

- [ ] **Step 6: Add CI** — `.github/workflows/ci.yml`

```yaml
name: ci
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm verify
      - run: xvfb-run -a pnpm test:integration
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: PASS.

```bash
git add -A
git commit -m "test: add VS Code integration harness (stable + 1.105 floor) and CI workflow"
```

---

## Task 0.3: React webview shell with typed RPC

**Files:**

- Create: `src/shared/protocol.ts`, `src/shared/protocol.test.ts`, `src/extension/webviewHost/webviewHtml.ts`,
  `src/extension/webviewHost/webviewHtml.test.ts`, `src/extension/webviewHost/rpcHost.ts`,
  `src/extension/webviewHost/rpcHost.test.ts`, `src/extension/webviewHost/attachWebview.ts`,
  `src/extension/webviewHost/dashboardPanel.ts`, `src/extension/webviewHost/sidebarProvider.ts`,
  `src/webview/tsconfig.json`, `src/webview/main.tsx`, `src/webview/App.tsx`, `src/webview/App.test.tsx`,
  `src/webview/rpcClient.ts`, `src/webview/rpcClient.test.ts`, `src/webview/rpcContext.tsx`,
  `src/webview/vscodeTransport.ts`, `src/webview/styles.css`, `src/webview/test/setup.ts`, `vite.config.mjs`,
  `test/integration/dashboard.test.ts`
- Modify: `package.json`, `vitest.config.mjs`, `eslint.config.mjs`, `src/extension/extension.ts`

**Interfaces:**

- Produces (`src/shared/protocol.ts`): `rpcSchemas` (method → `{ params, result }` zod schemas), `RpcMethod`,
  `RpcParams<M>`, `RpcResult<M>`, `webviewToHost` (zod), `HostEvent`, `HostToWebview`, `isRpcMethod(name)`.
- Produces (`src/extension/webviewHost/rpcHost.ts`): `RpcHandlers`, `WebviewLike`,
  `class RpcHost { constructor(webview, handlers, onError?); emit(event); dispose() }`.
- Produces (`src/webview/rpcClient.ts`): `Transport`,
  `class RpcClient { call<M>(method, params): Promise<RpcResult<M>>; onEvent(listener): () => void }`.
- Produces: `DashboardPanel { show(); notifyDataChanged(); dispose() }`,
  `SidebarProvider { static viewId; notifyDataChanged(); dispose() }`.

- [ ] **Step 1: Install webview dependencies**

```bash
pnpm add react react-dom zod @tanstack/react-query
pnpm add -D vite @vitejs/plugin-react @types/react @types/react-dom jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event eslint-plugin-react-hooks
```

If pnpm warns about optional peer dependencies of `@vitejs/plugin-react` (`babel-plugin-react-compiler`,
`@rolldown/plugin-babel`, `oxc-transform-react`), ignore them: they are only needed for the React Compiler,
which is out of scope.

- [ ] **Step 2: Update `package.json`**

Replace `"contributes": {}` with:

```json
"contributes": {
  "commands": [
    {
      "command": "copilotInsights.openDashboard",
      "title": "Open Dashboard",
      "category": "Copilot Insights",
      "icon": "$(graph)"
    }
  ],
  "viewsContainers": {
    "activitybar": [{ "id": "copilotInsights", "title": "Copilot Insights", "icon": "media/icon.svg" }]
  },
  "views": {
    "copilotInsights": [{ "id": "copilotInsights.sidebar", "name": "Overview", "type": "webview" }]
  },
  "menus": {
    "view/title": [
      {
        "command": "copilotInsights.openDashboard",
        "when": "view == copilotInsights.sidebar",
        "group": "navigation@1"
      }
    ]
  }
},
```

Replace these scripts:

```json
"build": "node esbuild.mjs && vite build --config vite.config.mjs",
"build:prod": "node esbuild.mjs --production && vite build --config vite.config.mjs",
"watch": "node esbuild.mjs --watch",
"watch:webview": "vite build --config vite.config.mjs --watch",
"typecheck": "tsc -p tsconfig.json && tsc -p test/integration/tsconfig.json && tsc -p src/webview/tsconfig.json",
```

- [ ] **Step 3: Configure the webview build and tests**

`vite.config.mjs`:

```js
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds the webview into fixed names the extension references: dist/webview/main.js and main.css.
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist/webview',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rolldownOptions: {
      input: fileURLToPath(new URL('./src/webview/main.tsx', import.meta.url)),
      output: {
        entryFileNames: 'main.js',
        chunkFileNames: 'chunk-[hash].js',
        assetFileNames: (asset) =>
          (asset.names ?? []).some((name) => name.endsWith('.css'))
            ? 'main.css'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
```

`src/webview/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": [".", "../shared"]
}
```

Replace `vitest.config.mjs`:

```js
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/{core,shared,extension}/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'webview',
          environment: 'jsdom',
          include: ['src/webview/**/*.test.{ts,tsx}'],
          setupFiles: ['src/webview/test/setup.ts'],
        },
      },
    ],
  },
});
```

`src/webview/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
```

In `eslint.config.mjs`, add the import at the top:

```js
import reactHooks from 'eslint-plugin-react-hooks';
```

and append this block to the array:

```js
  {
    files: ['src/webview/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      ...layer(
        'The webview may only import from src/webview and src/shared.',
        ['vscode'],
        ['node:*', '**/core/**', '**/extension/**'],
      ),
    },
  },
```

- [ ] **Step 4: Write the failing protocol test** — `src/shared/protocol.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { isRpcMethod, webviewToHost } from './protocol';

describe('protocol', () => {
  it('accepts well-formed RPC requests and the ready signal', () => {
    expect(webviewToHost.safeParse({ kind: 'rpc', id: 1, method: 'ping', params: {} }).success).toBe(true);
    expect(webviewToHost.safeParse({ kind: 'ready' }).success).toBe(true);
  });

  it('rejects malformed messages', () => {
    expect(webviewToHost.safeParse({ kind: 'rpc', id: -1, method: 'ping' }).success).toBe(false);
    expect(webviewToHost.safeParse('ping').success).toBe(false);
    expect(webviewToHost.safeParse({ kind: 'other' }).success).toBe(false);
  });

  it('recognises only declared methods', () => {
    expect(isRpcMethod('ping')).toBe(true);
    expect(isRpcMethod('toString')).toBe(false);
    expect(isRpcMethod('__proto__')).toBe(false);
  });
});
```

Run: `pnpm vitest run src/shared/protocol.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 5: Implement `src/shared/protocol.ts`**

```ts
import { z } from 'zod';

/** Every RPC method the webview may call. Params are validated in the extension before dispatch. */
export const rpcSchemas = {
  ping: {
    params: z.object({}),
    result: z.object({ version: z.string(), now: z.number() }),
  },
} as const;

export type RpcMethod = keyof typeof rpcSchemas;
export type RpcParams<M extends RpcMethod> = z.infer<(typeof rpcSchemas)[M]['params']>;
export type RpcResult<M extends RpcMethod> = z.infer<(typeof rpcSchemas)[M]['result']>;

export const webviewToHost = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rpc'),
    id: z.number().int().nonnegative(),
    method: z.string(),
    params: z.unknown(),
  }),
  z.object({ kind: z.literal('ready') }),
]);
export type WebviewToHost = z.infer<typeof webviewToHost>;

export interface HostEvent {
  name: 'dataChanged';
}

export type HostToWebview =
  | { kind: 'rpc-result'; id: number; ok: true; result: unknown }
  | { kind: 'rpc-result'; id: number; ok: false; error: string }
  | { kind: 'event'; event: HostEvent };

export function isRpcMethod(name: string): name is RpcMethod {
  return Object.hasOwn(rpcSchemas, name);
}
```

Run: `pnpm vitest run src/shared/protocol.test.ts` — Expected: PASS.

- [ ] **Step 6: Write the failing HTML test** — `src/extension/webviewHost/webviewHtml.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { createNonce, renderWebviewHtml } from './webviewHtml';

const html = renderWebviewHtml({
  cspSource: 'vscode-webview://abc',
  scriptUri: 'vscode-webview://abc/main.js',
  styleUri: 'vscode-webview://abc/main.css',
  nonce: 'N0NCE',
  view: 'sidebar',
  title: 'Copilot <Insights>',
});

describe('renderWebviewHtml', () => {
  it('uses a strict nonce-based CSP', () => {
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-N0NCE'");
    expect(html).toContain('style-src vscode-webview://abc');
    expect(html).not.toContain('unsafe-inline');
    expect(html).not.toContain('unsafe-eval');
  });

  it('loads the bundle with the nonce and marks the view', () => {
    expect(html).toContain(
      '<script type="module" nonce="N0NCE" src="vscode-webview://abc/main.js"></script>',
    );
    expect(html).toContain('<div id="root" data-view="sidebar"></div>');
    expect(html).toContain('<title>Copilot &lt;Insights&gt;</title>');
  });

  it('creates unpredictable nonces', () => {
    expect(createNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(createNonce());
  });
});
```

Run: `pnpm vitest run src/extension/webviewHost/webviewHtml.test.ts` — Expected: FAIL.

- [ ] **Step 7: Implement `src/extension/webviewHost/webviewHtml.ts`**

```ts
import { randomBytes } from 'node:crypto';

export type WebviewKind = 'dashboard' | 'sidebar';

export interface WebviewHtmlOptions {
  cspSource: string;
  scriptUri: string;
  styleUri: string;
  nonce: string;
  view: WebviewKind;
  title: string;
}

export function renderWebviewHtml(options: WebviewHtmlOptions): string {
  const csp = [
    "default-src 'none'",
    `img-src ${options.cspSource} data:`,
    `style-src ${options.cspSource}`,
    `font-src ${options.cspSource}`,
    `script-src 'nonce-${options.nonce}'`,
  ].join('; ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${escapeHtml(options.styleUri)}">
<title>${escapeHtml(options.title)}</title>
</head>
<body>
<div id="root" data-view="${options.view}"></div>
<script type="module" nonce="${options.nonce}" src="${escapeHtml(options.scriptUri)}"></script>
</body>
</html>`;
}

export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}
```

Run: `pnpm vitest run src/extension/webviewHost/webviewHtml.test.ts` — Expected: PASS.

- [ ] **Step 8: Write the failing RPC host test** — `src/extension/webviewHost/rpcHost.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import type { HostToWebview } from '../../shared/protocol';
import { RpcHost, type RpcHandlers } from './rpcHost';

function fakeWebview() {
  const posted: HostToWebview[] = [];
  let listener: ((message: unknown) => void) | undefined;
  return {
    posted,
    async send(message: unknown) {
      listener?.(message);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    webview: {
      postMessage: (message: HostToWebview) => {
        posted.push(message);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (next: (message: unknown) => void) => {
        listener = next;
        return {
          dispose: () => {
            listener = undefined;
          },
        };
      },
    },
  };
}

// Every RPC method needs a handler here; add one when protocol.ts gains a method.
const handlers: RpcHandlers = { ping: () => ({ version: '1.2.3', now: 7 }) };

describe('RpcHost', () => {
  it('answers a valid request', async () => {
    const fake = fakeWebview();
    new RpcHost(fake.webview, handlers);
    await fake.send({ kind: 'rpc', id: 4, method: 'ping', params: {} });
    expect(fake.posted).toEqual([
      { kind: 'rpc-result', id: 4, ok: true, result: { version: '1.2.3', now: 7 } },
    ]);
  });

  it('rejects unknown methods and invalid params', async () => {
    const fake = fakeWebview();
    new RpcHost(fake.webview, handlers);
    await fake.send({ kind: 'rpc', id: 1, method: 'dropTables', params: {} });
    await fake.send({ kind: 'rpc', id: 2, method: 'ping', params: 'x' });
    expect(fake.posted).toEqual([
      { kind: 'rpc-result', id: 1, ok: false, error: 'Unknown method: dropTables' },
      { kind: 'rpc-result', id: 2, ok: false, error: 'Invalid params for ping' },
    ]);
  });

  it('reports handler failures without crashing', async () => {
    const fake = fakeWebview();
    const onError = vi.fn();
    new RpcHost(fake.webview, { ...handlers, ping: () => Promise.reject(new Error('boom')) }, onError);
    await fake.send({ kind: 'rpc', id: 3, method: 'ping', params: {} });
    expect(fake.posted).toEqual([{ kind: 'rpc-result', id: 3, ok: false, error: 'boom' }]);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('ignores malformed messages and emits events', async () => {
    const fake = fakeWebview();
    const host = new RpcHost(fake.webview, handlers);
    await fake.send({ nonsense: true });
    host.emit({ name: 'dataChanged' });
    expect(fake.posted).toEqual([{ kind: 'event', event: { name: 'dataChanged' } }]);
  });

  it('stops listening after dispose', async () => {
    const fake = fakeWebview();
    new RpcHost(fake.webview, handlers).dispose();
    await fake.send({ kind: 'rpc', id: 5, method: 'ping', params: {} });
    expect(fake.posted).toEqual([]);
  });
});
```

Run: `pnpm vitest run src/extension/webviewHost/rpcHost.test.ts` — Expected: FAIL.

- [ ] **Step 9: Implement `src/extension/webviewHost/rpcHost.ts`**

```ts
import {
  isRpcMethod,
  rpcSchemas,
  webviewToHost,
  type HostEvent,
  type HostToWebview,
  type RpcMethod,
  type RpcParams,
  type RpcResult,
} from '../../shared/protocol';

export type RpcHandlers = {
  [M in RpcMethod]: (params: RpcParams<M>) => RpcResult<M> | Promise<RpcResult<M>>;
};

/** The subset of vscode.Webview the RPC host needs; keeps this file testable without VS Code. */
export interface WebviewLike {
  postMessage(message: HostToWebview): PromiseLike<boolean>;
  onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void };
}

export class RpcHost {
  private readonly subscription: { dispose(): void };

  constructor(
    private readonly webview: WebviewLike,
    private readonly handlers: RpcHandlers,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {
    this.subscription = webview.onDidReceiveMessage((message) => {
      void this.handle(message);
    });
  }

  emit(event: HostEvent): void {
    void this.webview.postMessage({ kind: 'event', event });
  }

  dispose(): void {
    this.subscription.dispose();
  }

  private async handle(raw: unknown): Promise<void> {
    const message = webviewToHost.safeParse(raw);
    if (!message.success || message.data.kind !== 'rpc') return;
    const { id, method, params } = message.data;
    if (!isRpcMethod(method)) {
      await this.reply({ kind: 'rpc-result', id, ok: false, error: `Unknown method: ${method}` });
      return;
    }
    const parsed = rpcSchemas[method].params.safeParse(params);
    if (!parsed.success) {
      await this.reply({ kind: 'rpc-result', id, ok: false, error: `Invalid params for ${method}` });
      return;
    }
    try {
      // Params were validated against this method's schema above, so the widening cast is safe.
      const handler = this.handlers[method] as (validated: unknown) => unknown;
      const result = await handler(parsed.data);
      await this.reply({ kind: 'rpc-result', id, ok: true, result });
    } catch (error) {
      this.onError(error);
      await this.reply({
        kind: 'rpc-result',
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async reply(message: HostToWebview): Promise<void> {
    await this.webview.postMessage(message);
  }
}
```

Run: `pnpm vitest run src/extension/webviewHost/rpcHost.test.ts` — Expected: PASS.

- [ ] **Step 10: Write the failing RPC client test** — `src/webview/rpcClient.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import type { HostToWebview } from '../shared/protocol';
import { RpcClient, type Transport } from './rpcClient';

function fakeTransport() {
  const sent: unknown[] = [];
  let listener: ((message: HostToWebview) => void) | undefined;
  const transport: Transport = {
    post: (message) => {
      sent.push(message);
    },
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  };
  return { transport, sent, deliver: (message: HostToWebview) => listener?.(message) };
}

describe('RpcClient', () => {
  it('correlates responses by id', async () => {
    const fake = fakeTransport();
    const client = new RpcClient(fake.transport);
    const first = client.call('ping', {});
    const second = client.call('ping', {});
    expect(fake.sent).toEqual([
      { kind: 'rpc', id: 1, method: 'ping', params: {} },
      { kind: 'rpc', id: 2, method: 'ping', params: {} },
    ]);
    fake.deliver({ kind: 'rpc-result', id: 2, ok: true, result: { version: 'b', now: 2 } });
    fake.deliver({ kind: 'rpc-result', id: 1, ok: false, error: 'nope' });
    await expect(second).resolves.toEqual({ version: 'b', now: 2 });
    await expect(first).rejects.toThrow('nope');
  });

  it('delivers host events to subscribers until they unsubscribe', () => {
    const fake = fakeTransport();
    const client = new RpcClient(fake.transport);
    const listener = vi.fn();
    const unsubscribe = client.onEvent(listener);
    fake.deliver({ kind: 'event', event: { name: 'dataChanged' } });
    unsubscribe();
    fake.deliver({ kind: 'event', event: { name: 'dataChanged' } });
    expect(listener).toHaveBeenCalledOnce();
  });
});
```

Run: `pnpm vitest run src/webview/rpcClient.test.ts` — Expected: FAIL.

- [ ] **Step 11: Implement the client side**

`src/webview/rpcClient.ts`:

```ts
import type { HostEvent, HostToWebview, RpcMethod, RpcParams, RpcResult } from '../shared/protocol';

export interface Transport {
  post(message: unknown): void;
  subscribe(listener: (message: HostToWebview) => void): () => void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class RpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: HostEvent) => void>();

  constructor(private readonly transport: Transport) {
    transport.subscribe((message) => {
      if (message.kind === 'event') {
        for (const listener of this.listeners) listener(message.event);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error));
    });
  }

  call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
    const id = this.nextId++;
    return new Promise<RpcResult<M>>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => {
          resolve(value as RpcResult<M>);
        },
        reject,
      });
      this.transport.post({ kind: 'rpc', id, method, params });
    });
  }

  onEvent(listener: (event: HostEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
```

`src/webview/vscodeTransport.ts`:

```ts
import type { HostToWebview } from '../shared/protocol';
import type { Transport } from './rpcClient';

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export function createVsCodeTransport(): Transport {
  const api = acquireVsCodeApi();
  return {
    post: (message) => {
      api.postMessage(message);
    },
    subscribe: (listener) => {
      const handler = (event: MessageEvent<HostToWebview>): void => {
        listener(event.data);
      };
      window.addEventListener('message', handler);
      return () => {
        window.removeEventListener('message', handler);
      };
    },
  };
}
```

`src/webview/rpcContext.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { RpcClient } from './rpcClient';

const RpcContext = createContext<RpcClient | null>(null);

export function RpcProvider({ client, children }: { client: RpcClient; children: ReactNode }) {
  return <RpcContext value={client}>{children}</RpcContext>;
}

export function useRpc(): RpcClient {
  const client = useContext(RpcContext);
  if (client === null) throw new Error('useRpc must be used inside <RpcProvider>');
  return client;
}
```

Run: `pnpm vitest run src/webview/rpcClient.test.ts` — Expected: PASS.

- [ ] **Step 12: Write the failing App test** — `src/webview/App.test.tsx`

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HostToWebview } from '../shared/protocol';
import { App } from './App';
import { RpcClient, type Transport } from './rpcClient';
import { RpcProvider } from './rpcContext';

export function fakeHost(results: Record<string, unknown>): Transport {
  let listener: ((message: HostToWebview) => void) | undefined;
  return {
    post: (message) => {
      const { id, method } = message as { id: number; method: string };
      queueMicrotask(() => {
        listener?.(
          method in results
            ? { kind: 'rpc-result', id, ok: true, result: results[method] }
            : { kind: 'rpc-result', id, ok: false, error: 'boom' },
        );
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

export function renderApp(transport: Transport) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RpcProvider client={new RpcClient(transport)}>
        <App view="dashboard" />
      </RpcProvider>
    </QueryClientProvider>,
  );
}

describe('App', () => {
  it('shows the connected extension version', async () => {
    renderApp(fakeHost({ ping: { version: '9.9.9', now: 1 } }));
    expect(await screen.findByText('Connected to extension v9.9.9')).toBeInTheDocument();
  });

  it('shows an error when the extension fails', async () => {
    renderApp(fakeHost({}));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});
```

Run: `pnpm vitest run src/webview/App.test.tsx` — Expected: FAIL.

- [ ] **Step 13: Implement the React app**

`src/webview/App.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useRpc } from './rpcContext';

export function App({ view }: { view: 'dashboard' | 'sidebar' }) {
  const rpc = useRpc();
  const ping = useQuery({ queryKey: ['ping'], queryFn: () => rpc.call('ping', {}) });
  return (
    <main className={`app app--${view}`}>
      <h1>Copilot Insights</h1>
      {ping.isPending && <p className="muted">Loading…</p>}
      {ping.isError && <p role="alert">Could not reach the extension: {ping.error.message}</p>}
      {ping.data && <p>Connected to extension v{ping.data.version}</p>}
    </main>
  );
}
```

`src/webview/main.tsx`:

```tsx
import './styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { RpcClient } from './rpcClient';
import { RpcProvider } from './rpcContext';
import { createVsCodeTransport } from './vscodeTransport';

const container = document.getElementById('root');
if (container === null) throw new Error('Missing #root element');

const client = new RpcClient(createVsCodeTransport());
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });
// dataChanged is the only host event today: refetch whatever is on screen.
client.onEvent(() => {
  void queryClient.invalidateQueries();
});

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RpcProvider client={client}>
        <App view={container.dataset.view === 'sidebar' ? 'sidebar' : 'dashboard'} />
      </RpcProvider>
    </QueryClientProvider>
  </StrictMode>,
);
```

`src/webview/styles.css`:

```css
:root {
  color-scheme: light dark;
}

body {
  margin: 0;
  background: var(--vscode-editor-background);
  color: var(--vscode-foreground);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

.app {
  padding: 16px 20px;
}

.app--sidebar {
  padding: 12px;
  background: var(--vscode-sideBar-background);
}

h1 {
  margin: 0 0 8px;
  font-size: 1.3em;
}

.muted {
  color: var(--vscode-descriptionForeground);
}

[role='alert'] {
  color: var(--vscode-errorForeground);
}
```

Run: `pnpm vitest run src/webview` — Expected: PASS.

- [ ] **Step 14: Host the webview in VS Code**

`src/extension/webviewHost/attachWebview.ts`:

```ts
import * as vscode from 'vscode';
import { RpcHost, type RpcHandlers } from './rpcHost';
import { createNonce, renderWebviewHtml, type WebviewKind } from './webviewHtml';

export function attachWebview(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  view: WebviewKind,
  handlers: RpcHandlers,
  log: vscode.LogOutputChannel,
): RpcHost {
  const root = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  webview.options = { enableScripts: true, localResourceRoots: [root] };
  webview.html = renderWebviewHtml({
    cspSource: webview.cspSource,
    scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.js')).toString(),
    styleUri: webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.css')).toString(),
    nonce: createNonce(),
    view,
    title: 'Copilot Insights',
  });
  return new RpcHost(webview, handlers, (error) => {
    log.error(error instanceof Error ? error : String(error));
  });
}
```

`src/extension/webviewHost/dashboardPanel.ts`:

```ts
import * as vscode from 'vscode';
import { attachWebview } from './attachWebview';
import type { RpcHandlers, RpcHost } from './rpcHost';

export class DashboardPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private rpc: RpcHost | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: RpcHandlers,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'copilotInsights.dashboard',
      'Copilot Insights',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
      },
    );
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg');
    this.rpc = attachWebview(panel.webview, this.extensionUri, 'dashboard', this.handlers, this.log);
    panel.onDidDispose(() => {
      this.rpc?.dispose();
      this.rpc = undefined;
      this.panel = undefined;
    });
    this.panel = panel;
  }

  notifyDataChanged(): void {
    this.rpc?.emit({ name: 'dataChanged' });
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
```

`src/extension/webviewHost/sidebarProvider.ts`:

```ts
import * as vscode from 'vscode';
import { attachWebview } from './attachWebview';
import type { RpcHandlers, RpcHost } from './rpcHost';

export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'copilotInsights.sidebar';
  private rpc: RpcHost | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: RpcHandlers,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.rpc?.dispose();
    this.rpc = attachWebview(view.webview, this.extensionUri, 'sidebar', this.handlers, this.log);
    view.onDidDispose(() => {
      this.rpc?.dispose();
      this.rpc = undefined;
    });
  }

  notifyDataChanged(): void {
    this.rpc?.emit({ name: 'dataChanged' });
  }

  dispose(): void {
    this.rpc?.dispose();
  }
}
```

Replace `src/extension/extension.ts`:

```ts
import * as vscode from 'vscode';
import { DashboardPanel } from './webviewHost/dashboardPanel';
import type { RpcHandlers } from './webviewHost/rpcHost';
import { SidebarProvider } from './webviewHost/sidebarProvider';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Copilot Insights', { log: true });
  const version = extensionVersion(context);
  const handlers: RpcHandlers = { ping: () => ({ version, now: Date.now() }) };
  const dashboard = new DashboardPanel(context.extensionUri, handlers, log);
  const sidebar = new SidebarProvider(context.extensionUri, handlers, log);
  context.subscriptions.push(
    log,
    dashboard,
    sidebar,
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar),
    vscode.commands.registerCommand('copilotInsights.openDashboard', () => {
      dashboard.show();
    }),
  );
  log.info(`Copilot Insights ${version} activated`);
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}

function extensionVersion(context: vscode.ExtensionContext): string {
  const manifest = context.extension.packageJSON as { version?: unknown };
  return typeof manifest.version === 'string' ? manifest.version : 'dev';
}
```

- [ ] **Step 15: Add the dashboard integration test** — `test/integration/dashboard.test.ts`

```ts
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

describe('dashboard', () => {
  it('opens a Copilot Insights editor tab', async () => {
    await vscode.commands.executeCommand('copilotInsights.openDashboard');
    const labels = vscode.window.tabGroups.all.flatMap((group) => group.tabs.map((tab) => tab.label));
    assert.ok(labels.includes('Copilot Insights'), `open tabs: ${labels.join(', ')}`);
  });
});
```

- [ ] **Step 16: Verify**

Run: `pnpm format && pnpm verify`
Expected: PASS, and `ls dist/webview` shows `main.js` and `main.css`.

Run: `pnpm test:integration`
Expected: PASS on `stable` and `floor`.

Manual check (F5): run "Copilot Insights: Open Dashboard". The tab shows "Connected to extension v0.3.0", and
the Webview Developer Tools console shows no CSP errors.

- [ ] **Step 17: Commit**

```bash
git add -A
git commit -m "feat: add React webview shell with CSP and zod-validated RPC"
```

---

## Task 1.1: Time utilities

**Files:**

- Create: `src/core/time.ts`, `src/core/time.test.ts`

**Interfaces:**

- Produces: `localDay(ms?: number): string`, `daysAgo(day: string, count: number): string`,
  `retentionCutoff(retentionDays: number, today: string): string | null`.

- [ ] **Step 1: Write the failing test** — `src/core/time.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { daysAgo, localDay, retentionCutoff } from './time';

describe('time', () => {
  it('formats the local calendar day', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
    expect(localDay(new Date(2026, 11, 31, 0, 1).getTime())).toBe('2026-12-31');
  });

  it('moves across month, leap-day and DST boundaries', () => {
    expect(daysAgo('2026-03-01', 1)).toBe('2026-02-28');
    expect(daysAgo('2024-03-01', 1)).toBe('2024-02-29');
    expect(daysAgo('2026-03-09', 1)).toBe('2026-03-08');
    expect(daysAgo('2026-10-26', 1)).toBe('2026-10-25');
    expect(daysAgo('2026-09-30', -1)).toBe('2026-10-01');
  });

  it('rejects malformed days', () => {
    expect(() => daysAgo('2026-9-1', 1)).toThrow(RangeError);
  });

  it('computes the retention cutoff, or null when retention is off', () => {
    expect(retentionCutoff(30, '2026-09-30')).toBe('2026-08-31');
    expect(retentionCutoff(0, '2026-09-30')).toBeNull();
    expect(retentionCutoff(-5, '2026-09-30')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/core/time.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/core/time.ts`**

```ts
/** Local calendar day (YYYY-MM-DD) for a timestamp, in the machine's current time zone. */
export function localDay(ms: number = Date.now()): string {
  const date = new Date(ms);
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day `count` days before `day` (negative moves forward). UTC noon keeps DST from skipping a day. */
export function daysAgo(day: string, count: number): string {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

/** First day to keep for a retention window; sessions with an earlier day are purged. Null disables retention. */
export function retentionCutoff(retentionDays: number, today: string): string | null {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return null;
  return daysAgo(today, retentionDays);
}

function parseDay(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError(`Invalid day: ${day}`);
  return new Date(`${day}T12:00:00Z`);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/core/time.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(core): add local-day and retention utilities"
```

---

## Task 1.2: Mutation-log replayer

**Files:**

- Create: `src/core/json.ts`, `src/core/ingest/mutationLog.ts`, `src/core/ingest/mutationLog.test.ts`

**Interfaces:**

- Produces (`src/core/json.ts`): `isRecord(value: unknown): value is Record<string, unknown>` (plain objects,
  not arrays).
- Produces (`mutationLog.ts`): `applyMutation(state: unknown, entry: unknown): unknown`,
  `replayMutationLog(text: string): ReplayResult`, `loadChatSessionState(file: string): ReplayResult`,
  `interface ReplayResult { state: unknown; entries: number; badLines: number }`.

- [ ] **Step 1: Write the failing test** — `src/core/ingest/mutationLog.test.ts`

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyMutation, loadChatSessionState, replayMutationLog } from './mutationLog';

const lines = (...entries: unknown[]): string => entries.map((entry) => JSON.stringify(entry)).join('\n');

describe('replayMutationLog', () => {
  it('replaces state with kind 0 and sets nested values with kind 1', () => {
    const { state } = replayMutationLog(
      lines(
        { kind: 0, v: { sessionId: 's1', requests: [] } },
        { kind: 1, k: ['customTitle'], v: 'Title' },
        { kind: 1, k: ['inputState', 'inputText'], v: 'draft' },
      ),
    );
    expect(state).toEqual({
      sessionId: 's1',
      requests: [],
      customTitle: 'Title',
      inputState: { inputText: 'draft' },
    });
  });

  it('appends with kind 2 and truncates to i before appending', () => {
    const { state } = replayMutationLog(
      lines(
        { kind: 0, v: { requests: [] } },
        { kind: 2, k: ['requests'], v: [{ id: 'a', response: [] }] },
        { kind: 2, k: ['requests', 0, 'response'], v: [{ value: 'one' }, { value: 'two' }] },
        { kind: 2, k: ['requests', 0, 'response'], i: 1, v: [{ value: 'TWO' }] },
      ),
    );
    expect(state).toEqual({ requests: [{ id: 'a', response: [{ value: 'one' }, { value: 'TWO' }] }] });
  });

  it('appends without truncating when i is beyond the array length', () => {
    const { state } = replayMutationLog(
      lines({ kind: 0, v: { list: [1] } }, { kind: 2, k: ['list'], i: 5, v: [2] }),
    );
    expect(state).toEqual({ list: [1, 2] });
  });

  it('deletes object keys and array items with kind 3', () => {
    const state = { a: { b: 1, c: 2 }, list: [1, 2, 3] };
    applyMutation(state, { kind: 3, k: ['a', 'b'] });
    applyMutation(state, { kind: 3, k: ['list', 1] });
    expect(state).toEqual({ a: { c: 2 }, list: [1, 3] });
  });

  it('creates missing containers with the right type', () => {
    const state: Record<string, unknown> = {};
    applyMutation(state, { kind: 1, k: ['requests', 0, 'result'], v: { ok: true } });
    expect(Array.isArray(state.requests)).toBe(true);
    expect(state).toEqual({ requests: [{ result: { ok: true } }] });
  });

  it('refuses prototype-polluting key paths', () => {
    const { state } = replayMutationLog(
      lines(
        { kind: 0, v: {} },
        { kind: 1, k: ['__proto__', 'polluted'], v: true },
        { kind: 1, k: ['constructor', 'prototype', 'polluted'], v: true },
      ),
    );
    expect(state).toEqual({});
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('counts and skips a truncated last line (file still being written)', () => {
    const result = replayMutationLog(`${lines({ kind: 0, v: { requests: [] } })}\n{"kind":1,"k":[`);
    expect(result).toEqual({ state: { requests: [] }, entries: 1, badLines: 1 });
  });

  it('ignores mutations that arrive before any snapshot', () => {
    expect(replayMutationLog(lines({ kind: 1, k: ['x'], v: 1 })).state).toBeNull();
  });

  it('handles very large appends without spreading arguments', () => {
    const big = Array.from({ length: 200_000 }, (_, index) => index);
    const { state } = replayMutationLog(
      lines({ kind: 0, v: { list: [] } }, { kind: 2, k: ['list'], v: big }),
    );
    expect((state as { list: number[] }).list).toHaveLength(200_000);
  });
});

describe('loadChatSessionState', () => {
  it('loads legacy single-snapshot .json files', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ci-mlog-')), 'legacy.json');
    writeFileSync(file, JSON.stringify({ sessionId: 'legacy', requests: [{ requestId: 'r' }] }));
    expect(loadChatSessionState(file)).toEqual({
      state: { sessionId: 'legacy', requests: [{ requestId: 'r' }] },
      entries: 1,
      badLines: 0,
    });
  });

  it('replays .jsonl files', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ci-mlog-')), 's.jsonl');
    writeFileSync(file, lines({ kind: 0, v: { requests: [] } }, { kind: 1, k: ['customTitle'], v: 'T' }));
    expect(loadChatSessionState(file).state).toEqual({ requests: [], customTitle: 'T' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/core/ingest/mutationLog.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/core/json.ts`:

```ts
/** True for plain JSON objects (not arrays, not null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

`src/core/ingest/mutationLog.ts`:

```ts
import { readFileSync } from 'node:fs';

// VS Code persists each chat session as an append-only JSONL mutation log. See docs/copilot-data-formats.md.
//   {kind:0, v}        replace the whole state (initial snapshot)
//   {kind:1, k, v}     set the value at key path k
//   {kind:2, k, v, i?} array at k: truncate to length i (when given), then append the items of v
//   {kind:3, k}        delete the value at key path k (not yet observed in real files)

type PathKey = string | number;
type Container = Record<PathKey, unknown>;

// Keys come from files on disk; never let them reach an object's prototype.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface ReplayResult {
  state: unknown;
  entries: number;
  badLines: number;
}

export function applyMutation(state: unknown, entry: unknown): unknown {
  if (!isContainer(entry)) return state;
  if (entry.kind === 0) return entry.v ?? null;
  const path = entry.k;
  if (!isContainer(state) || !isPath(path)) return state;
  const last = path.at(-1);
  if (last === undefined) return state;
  const parent = parentOf(state, path);
  switch (entry.kind) {
    case 1:
      parent[last] = entry.v;
      break;
    case 2:
      appendItems(parent, last, entry.v, entry.i);
      break;
    case 3:
      removeKey(parent, last);
      break;
    default:
      break;
  }
  return state;
}

export function replayMutationLog(text: string): ReplayResult {
  let state: unknown = null;
  let entries = 0;
  let badLines = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    entries++;
    state = applyMutation(state, entry);
  }
  return { state, entries, badLines };
}

/** Older VS Code builds wrote one JSON snapshot (*.json); newer builds write the JSONL mutation log. */
export function loadChatSessionState(file: string): ReplayResult {
  const text = readFileSync(file, 'utf8');
  if (!/\.json$/i.test(file)) return replayMutationLog(text);
  try {
    return { state: JSON.parse(text) as unknown, entries: 1, badLines: 0 };
  } catch {
    return { state: null, entries: 0, badLines: 1 };
  }
}

function isContainer(value: unknown): value is Container {
  return typeof value === 'object' && value !== null;
}

function isPath(value: unknown): value is PathKey[] {
  return Array.isArray(value) && value.length > 0 && value.every(isPathKey);
}

function isPathKey(key: unknown): key is PathKey {
  if (typeof key === 'string') return !FORBIDDEN_KEYS.has(key);
  return typeof key === 'number' && Number.isInteger(key) && key >= 0;
}

function parentOf(root: Container, path: readonly PathKey[]): Container {
  let node = root;
  const parents = path.slice(0, -1);
  for (const [index, key] of parents.entries()) {
    const next = node[key];
    if (isContainer(next)) {
      node = next;
      continue;
    }
    const created = (typeof path[index + 1] === 'number' ? [] : {}) as Container;
    node[key] = created;
    node = created;
  }
  return node;
}

function appendItems(parent: Container, key: PathKey, items: unknown, truncateTo: unknown): void {
  const current = parent[key];
  const array: unknown[] = Array.isArray(current) ? current : [];
  parent[key] = array;
  if (
    typeof truncateTo === 'number' &&
    Number.isInteger(truncateTo) &&
    truncateTo >= 0 &&
    truncateTo < array.length
  ) {
    array.length = truncateTo;
  }
  // Push one by one: spreading a 100k-item array into push() overflows the call stack.
  if (Array.isArray(items)) for (const item of items) array.push(item);
}

function removeKey(parent: Container, key: PathKey): void {
  if (Array.isArray(parent) && typeof key === 'number') parent.splice(key, 1);
  else Reflect.deleteProperty(parent, key);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/core/ingest/mutationLog.test.ts` — Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(ingest): replay VS Code chat-session mutation logs safely"
```

---

## Task 1.3: Synthetic fixtures and the chat-session normalizer

**Files:**

- Create: `test/fixtures/README.md`, `test/fixtures/fixtures.ts`,
  `test/fixtures/chatSessions/auto-agent-session.jsonl`, `test/fixtures/chatSessions/byok-failed-session.jsonl`,
  `test/fixtures/chatSessions/empty-session.jsonl`, `src/core/ingest/types.ts`,
  `src/core/ingest/chatSessionSchema.ts`, `src/core/ingest/chatSession.ts`, `src/core/ingest/chatSession.test.ts`

**Interfaces:**

- Consumes: `replayMutationLog` (Task 1.2), `isRecord` (Task 1.2).
- Produces (`types.ts`): `TurnState`, `SelectionMode`, `SelectionSource`, `ModelHost`, `FileAction`,
  `TombstoneKind = 'deleted' | 'content-cleared'`, `ToolCall`, `FileEvent`, `Compaction`, `PromptShare`,
  `NormalizedTurn`, `NormalizedSession` (exact fields below).
- Produces (`chatSession.ts`): `normalizeChatSession(state: unknown, context: { file: string; workspace: string }):
NormalizedSession | null`, `modelHost(modelId: string | null): ModelHost`, `modelNameFromId(id: string): string`,
  `toolFileAction(toolName: string): FileAction`.
- Produces (`test/fixtures/fixtures.ts`): `CHAT_SESSION_FIXTURES: string`, `fixturePath(name: string): string`.

- [ ] **Step 1: Add the synthetic fixtures**

These mirror `docs/copilot-data-formats.md`. They contain no real user data. Each line must stay a single line.

`test/fixtures/chatSessions/auto-agent-session.jsonl`:

```jsonl
{"kind":0,"v":{"version":3,"creationDate":1790000000000,"initialLocation":"panel","responderUsername":"GitHub Copilot","sessionId":"fx-auto-1","hasPendingEdits":false,"requests":[],"pendingRequests":[],"inputState":{"inputText":""}}}
{"kind":1,"k":["inputState","inputText"],"v":"draft text that must never be stored"}
{"kind":1,"k":["customTitle"],"v":"Fix run timeout race"}
{"kind":2,"k":["requests"],"v":[{"requestId":"req-1","timestamp":1790000001000,"message":{"text":"Fix the timeout race in src/execution/manager.ts","parts":[]},"variableData":{"variables":[]},"modelId":"copilot/auto","modeInfo":{"kind":"agent","isBuiltin":true},"modelState":{"value":0},"response":[],"responseId":"resp-1","contentReferences":[],"codeCitations":[],"timeSpentWaiting":0,"agent":{"id":"github.copilot.editsAgent"}}]}
{"kind":2,"k":["requests",0,"response"],"v":[{"kind":"autoModeResolution","resolved":{"id":"gpt-5.6-luna","name":"GPT-5.6 Luna"}},{"kind":"thinking","value":"","id":"th-1","reasoningDurationMs":1200},{"kind":"toolInvocationSerialized","toolId":"copilot_readFile","toolCallId":"toolu_inv_1","isComplete":true,"isConfirmed":{"type":1},"invocationMessage":{"value":"Reading manager.ts","uris":{"file:///repo/src/execution/manager.ts":{"$mid":1}}},"pastTenseMessage":{"value":"Read manager.ts","uris":{}}}]}
{"kind":2,"k":["requests",0,"response"],"v":[{"kind":"textEditGroup","uri":{"$mid":1,"fsPath":"/repo/src/execution/manager.ts","path":"/repo/src/execution/manager.ts","scheme":"file"},"edits":[[]],"done":true},{"value":"Fixed the initialization race by awaiting the lock before start.","supportThemeIcons":false}]}
{"kind":1,"k":["requests",0,"result"],"v":{"timings":{"totalElapsed":8000},"metadata":{"responseId":"llm-resp-1","sessionId":"fx-auto-1","agentId":"github.copilot.editsAgent","resolvedModel":"gpt-5.6-luna","promptTokens":24000,"outputTokens":1700,"toolCallRounds":[{"id":"round-1","timestamp":1790000002000,"response":"","toolInputRetry":0,"toolCalls":[{"id":"call-1","name":"read_file","arguments":"{\"filePath\":\"/repo/src/execution/manager.ts\",\"startLine\":1,\"endLine\":80}"}]},{"id":"round-2","timestamp":1790000004000,"response":"","toolInputRetry":1,"toolCalls":[{"id":"call-2","name":"replace_string_in_file","arguments":"{\"filePath\":\"/repo/src/execution/manager.ts\",\"oldString\":\"start()\",\"newString\":\"await lock; start()\"}"}]}],"summaries":[{"toolCallRoundId":"round-2","text":"compacted history","usage":{},"model":"gpt-5.6-mini","summarizationMode":"full","numRounds":2,"numRoundsSinceLastSummarization":2,"durationMs":900,"source":"agent","outcome":"success","contextLengthBefore":98000}]}}}
{"kind":1,"k":["requests",0,"promptTokens"],"v":24000}
{"kind":1,"k":["requests",0,"completionTokens"],"v":1700}
{"kind":1,"k":["requests",0,"copilotCredits"],"v":1.126141}
{"kind":1,"k":["requests",0,"elapsedMs"],"v":8000}
{"kind":1,"k":["requests",0,"promptTokenDetails"],"v":[{"category":"System","label":"System Instructions","percentageOfPrompt":12},{"category":"System","label":"Tool Definitions","percentageOfPrompt":40},{"category":"User Context","label":"Messages","percentageOfPrompt":35},{"category":"User Context","label":"Files","percentageOfPrompt":13}]}
{"kind":1,"k":["requests",0,"modelState"],"v":{"value":1,"completedAt":1790000009000}}
{"kind":2,"k":["requests"],"v":[{"requestId":"req-2","timestamp":1790000060000,"message":{"text":"Also add a regression test","parts":[]},"modelId":"copilot/auto","modeInfo":{"kind":"agent"},"modelState":{"value":1,"completedAt":1790000070000},"response":[{"kind":"autoModeResolution","resolved":{"id":"gpt-5.6-luna","name":"GPT-5.6 Luna"}},{"value":"Added a regression test in test/manager.test.ts.","supportThemeIcons":false}],"result":{"metadata":{"responseId":"llm-resp-2","resolvedModel":"gpt-5.6-luna","promptTokens":30000,"outputTokens":900,"toolCallRounds":[{"id":"round-3","timestamp":1790000061000,"response":"","toolInputRetry":0,"toolCalls":[{"id":"call-3","name":"create_file","arguments":"{\"filePath\":\"/repo/test/manager.test.ts\",\"content\":\"const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';\"}"}]}]}},"promptTokens":30000,"completionTokens":900,"copilotCredits":0.5,"elapsedMs":10000,"editedFileEvents":[{"uri":{"$mid":1,"fsPath":"/repo/src/execution/manager.ts","path":"/repo/src/execution/manager.ts","scheme":"file"},"eventKind":1}]}]}
{"kind":2,"k":["requests",1,"response"],"i":1,"v":[{"value":"Added a regression test in test/manager.test.ts and ran it.","supportThemeIcons":false}]}
```

`test/fixtures/chatSessions/byok-failed-session.jsonl`:

```jsonl
{"kind":0,"v":{"version":3,"creationDate":1790100000000,"initialLocation":"panel","responderUsername":"","sessionId":"fx-byok-1","hasPendingEdits":false,"requests":[{"requestId":"req-a","timestamp":1790100000000,"message":{"text":"Explain the retry policy","parts":[]},"modelId":"ollama/Ollama/qwen3.5:35b","modeInfo":{"kind":"ask"},"modelState":{"value":3,"completedAt":1790100003000},"response":[],"result":{"errorDetails":{"code":"failed","message":"Sorry, your request failed. Please try again.","responseIsIncomplete":true},"metadata":{}},"elapsedMs":3000},{"requestId":"req-b","timestamp":1790100100000,"message":{"text":"`npm test` completed","parts":[]},"isSystemInitiated":true,"systemInitiatedLabel":"`npm test` completed","modelId":"ollama/Ollama/qwen3.5:35b","modelState":{"value":2,"completedAt":1790100101000},"response":[{"kind":"brandNewPartKind","value":"x"},{"value":"Tests finished."}],"result":{"metadata":{"promptTokens":5000,"outputTokens":50}},"promptTokens":5000,"completionTokens":50,"elapsedMs":1000,"futureField":1},"not-an-object"],"pendingRequests":[]}}
{"kind":1,"k":["inputState"],"v":{"inputText":""}}
```

`test/fixtures/chatSessions/empty-session.jsonl`:

```jsonl
{"kind":0,"v":{"version":3,"creationDate":1790200000000,"initialLocation":"panel","responderUsername":"","sessionId":"fx-empty-1","hasPendingEdits":false,"requests":[],"pendingRequests":[]}}
{"kind":1,"k":["inputState","inputText"],"v":"never sent"}
```

`test/fixtures/README.md`:

```markdown
# Test fixtures

Synthetic files that follow the real Copilot formats documented in `docs/copilot-data-formats.md`.
They must never contain real prompts, code, paths, or tokens from a user's machine. When Copilot's format
changes, add a new fixture that reproduces the change instead of copying a real file.

- `chatSessions/auto-agent-session.jsonl` — Copilot Auto agent session, two turns, exact tokens/credits,
  tool rounds, compaction, a secret inside tool arguments, truncate-then-append update, edit outcome events.
- `chatSessions/byok-failed-session.jsonl` — bring-your-own-key model, failed turn, system-initiated turn,
  unknown response part kind and request key, and one invalid request entry.
- `chatSessions/empty-session.jsonl` — a chat that was opened but never used.
```

`test/fixtures/fixtures.ts`:

```ts
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Synthetic fixtures that mirror docs/copilot-data-formats.md. Never replace them with real user data. */
export const CHAT_SESSION_FIXTURES = fileURLToPath(new URL('./chatSessions/', import.meta.url));

export function fixturePath(name: string): string {
  return join(CHAT_SESSION_FIXTURES, name);
}
```

- [ ] **Step 2: Write the failing normalizer test** — `src/core/ingest/chatSession.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixturePath } from '../../../test/fixtures/fixtures';
import { modelHost, modelNameFromId, normalizeChatSession, toolFileAction } from './chatSession';
import { replayMutationLog } from './mutationLog';

function load(name: string) {
  const file = fixturePath(name);
  return normalizeChatSession(replayMutationLog(readFileSync(file, 'utf8')).state, {
    file,
    workspace: 'alpha',
  });
}

describe('normalizeChatSession', () => {
  it('returns null for a session without requests', () => {
    expect(load('empty-session.jsonl')).toBeNull();
  });

  it('rebuilds an Auto agent session with exact usage, credits and routing', () => {
    const session = load('auto-agent-session.jsonl');
    expect(session).toMatchObject({
      id: 'fx-auto-1',
      workspace: 'alpha',
      title: 'Fix run timeout race',
      location: 'panel',
      startedAt: 1790000001000,
      endedAt: 1790000070000,
      activeMs: 18000,
      diagnostics: { unknownPartKinds: [], unknownRequestKeys: [], invalidRequests: 0 },
    });
    expect(session?.turns).toHaveLength(2);
    expect(session?.turns[0]).toMatchObject({
      index: 1,
      requestId: 'req-1',
      responseId: 'llm-resp-1',
      state: 'complete',
      startedAt: 1790000001000,
      endedAt: 1790000009000,
      elapsedMs: 8000,
      mode: 'agent',
      userText: 'Fix the timeout race in src/execution/manager.ts',
      assistantText: 'Fixed the initialization race by awaiting the lock before start.',
      requestedModel: 'copilot/auto',
      resolvedModel: 'gpt-5.6-luna',
      resolvedModelSource: 'exact:autoModeResolution',
      selectionMode: 'AUTO',
      selectionSource: 'COPILOT_AUTO',
      modelHost: 'copilot',
      promptTokens: 24000,
      completionTokens: 1700,
      credits: 1.126141,
      reasoningBlocks: 1,
      reasoningMs: 1200,
      toolRounds: 2,
      toolInputRetries: 1,
      maxToolCallsExceeded: false,
      errorCode: null,
      compactions: [
        { contextLengthBefore: 98000, model: 'gpt-5.6-mini', durationMs: 900, outcome: 'success' },
      ],
    });
    expect(session?.turns[0]?.promptComposition).toContainEqual({
      category: 'System',
      label: 'Tool Definitions',
      percent: 40,
    });
    expect(session?.turns[0]?.toolCalls.map((call) => [call.name, call.origin])).toEqual([
      ['read_file', 'toolCallRound'],
      ['replace_string_in_file', 'toolCallRound'],
    ]);
    expect(session?.turns[0]?.toolCalls[0]?.args).toMatchObject({
      filePath: '/repo/src/execution/manager.ts',
    });
    expect(session?.turns[0]?.fileEvents).toEqual([
      { path: '/repo/src/execution/manager.ts', action: 'read', source: 'tool:copilot_readFile' },
      { path: '/repo/src/execution/manager.ts', action: 'edited', source: 'textEditGroup' },
    ]);
  });

  it('applies truncate-then-append updates and records later edit outcomes', () => {
    const second = load('auto-agent-session.jsonl')?.turns[1];
    expect(second).toMatchObject({
      assistantText: 'Added a regression test in test/manager.test.ts and ran it.',
      credits: 0.5,
      promptTokens: 30000,
      completionTokens: 900,
    });
    expect(second?.fileEvents).toEqual([
      { path: '/repo/test/manager.test.ts', action: 'created', source: 'toolArgs:create_file' },
      { path: '/repo/src/execution/manager.ts', action: 'kept', source: 'editedFileEvents' },
    ]);
  });

  it('handles BYOK models, failures, system-initiated turns and schema drift', () => {
    const session = load('byok-failed-session.jsonl');
    expect(session?.diagnostics).toEqual({
      unknownPartKinds: ['brandNewPartKind'],
      unknownRequestKeys: ['futureField'],
      invalidRequests: 1,
    });
    expect(session?.activeMs).toBe(4000);
    expect(session?.turns[0]).toMatchObject({
      state: 'failed',
      errorCode: 'failed',
      errorMessage: 'Sorry, your request failed. Please try again.',
      modelHost: 'byok',
      requestedModel: 'ollama/Ollama/qwen3.5:35b',
      resolvedModel: 'qwen3.5:35b',
      resolvedModelSource: 'derived:modelId',
      selectionMode: 'MANUAL',
      selectionSource: 'USER',
      promptTokens: null,
      credits: null,
      mode: 'ask',
      assistantText: null,
    });
    expect(session?.turns[1]).toMatchObject({
      state: 'cancelled',
      systemInitiated: true,
      assistantText: 'Tests finished.',
      promptTokens: 5000,
    });
  });

  it('falls back to the file name when the state has no sessionId', () => {
    const session = normalizeChatSession(
      { requests: [{ requestId: 'r', message: { text: 'hi' } }] },
      { file: '/x/chatSessions/abc-123.jsonl', workspace: 'w' },
    );
    expect(session?.id).toBe('abc-123');
    expect(session?.turns[0]?.state).toBe('unknown');
  });
});

describe('model and tool helpers', () => {
  it('classifies providers', () => {
    expect(modelHost('copilot/auto')).toBe('copilot');
    expect(modelHost('m365-copilot/x')).toBe('byok');
    expect(modelHost('gpt-4o')).toBe('unknown');
    expect(modelHost(null)).toBe('unknown');
  });

  it('extracts model names', () => {
    expect(modelNameFromId('copilot/gpt-5.6')).toBe('gpt-5.6');
    expect(modelNameFromId('nvidia-nim/NVIDIA NIM/nvidia/nemotron-3')).toBe('nvidia/nemotron-3');
    expect(modelNameFromId('plain')).toBe('plain');
  });

  it('maps tool names to file actions', () => {
    expect(toolFileAction('copilot_readFile')).toBe('read');
    expect(toolFileAction('create_file')).toBe('created');
    expect(toolFileAction('replace_string_in_file')).toBe('edited');
    expect(toolFileAction('delete_file')).toBe('deleted');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run src/core/ingest/chatSession.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement the types** — `src/core/ingest/types.ts`

```ts
export type TurnState = 'pending' | 'complete' | 'cancelled' | 'failed' | 'unknown';
export type SelectionMode = 'AUTO' | 'MANUAL' | 'UNKNOWN';
/** Who chose the model. COPILOT_INTERNAL (utility models) arrives with debug-log parsing in Phase 3. */
export type SelectionSource = 'COPILOT_AUTO' | 'USER' | 'UNKNOWN';
/** `copilot` = Copilot-hosted (billed in Copilot credits); `byok` = any other provider prefix. */
export type ModelHost = 'copilot' | 'byok' | 'unknown';
export type FileAction = 'read' | 'edited' | 'created' | 'deleted' | 'kept' | 'undone' | 'user-modified';
export type TombstoneKind = 'deleted' | 'content-cleared';

export interface ToolCall {
  callId: string | null;
  name: string;
  args: Record<string, unknown> | null;
  origin: 'toolCallRound' | 'invocation';
  status: 'complete' | 'incomplete' | 'unknown';
}

export interface FileEvent {
  path: string;
  action: FileAction;
  source: string;
}

export interface Compaction {
  contextLengthBefore: number | null;
  model: string | null;
  durationMs: number | null;
  outcome: string | null;
}

export interface PromptShare {
  category: string;
  label: string;
  percent: number | null;
}

export interface NormalizedTurn {
  index: number;
  requestId: string | null;
  responseId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  elapsedMs: number | null;
  state: TurnState;
  systemInitiated: boolean;
  hidden: boolean;
  mode: string | null;
  userText: string | null;
  assistantText: string | null;
  requestedModel: string | null;
  resolvedModel: string | null;
  resolvedModelSource: string;
  selectionMode: SelectionMode;
  selectionSource: SelectionSource;
  modelHost: ModelHost;
  promptTokens: number | null;
  completionTokens: number | null;
  credits: number | null;
  promptComposition: PromptShare[];
  reasoningBlocks: number;
  reasoningMs: number;
  toolCalls: ToolCall[];
  fileEvents: FileEvent[];
  compactions: Compaction[];
  toolRounds: number;
  toolInputRetries: number;
  maxToolCallsExceeded: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface SessionDiagnostics {
  unknownPartKinds: string[];
  unknownRequestKeys: string[];
  invalidRequests: number;
}

export interface NormalizedSession {
  id: string;
  sourceFile: string;
  workspace: string;
  title: string | null;
  location: string | null;
  startedAt: number;
  endedAt: number;
  activeMs: number;
  turns: NormalizedTurn[];
  diagnostics: SessionDiagnostics;
}
```

- [ ] **Step 5: Implement the lenient schemas** — `src/core/ingest/chatSessionSchema.ts`

```ts
import { z } from 'zod';

// Copilot's formats are undocumented. A field with an unexpected type becomes undefined instead of
// rejecting the whole request; unknown keys pass through and are reported as schema drift.
const str = z.string().optional().catch(undefined);
const num = z.number().optional().catch(undefined);
const bool = z.boolean().optional().catch(undefined);
const list = z.array(z.unknown()).optional().catch(undefined);
const uri = z.looseObject({ fsPath: str, path: str }).optional().catch(undefined);

export const requestSchema = z.looseObject({
  requestId: str,
  timestamp: num,
  message: z.looseObject({ text: str }).optional().catch(undefined),
  modelId: str,
  modeInfo: z.looseObject({ kind: str }).optional().catch(undefined),
  modelState: z.looseObject({ value: num, completedAt: num }).optional().catch(undefined),
  elapsedMs: num,
  promptTokens: num,
  completionTokens: num,
  copilotCredits: num,
  promptTokenDetails: z
    .array(z.looseObject({ category: str, label: str, percentageOfPrompt: num }))
    .optional()
    .catch(undefined),
  editedFileEvents: z
    .array(z.looseObject({ uri, eventKind: num }))
    .optional()
    .catch(undefined),
  isSystemInitiated: bool,
  hiddenFromTranscript: bool,
  response: list,
  result: z
    .looseObject({
      errorDetails: z.looseObject({ code: str, message: str }).optional().catch(undefined),
      timings: z.looseObject({ totalElapsed: num }).optional().catch(undefined),
      metadata: z
        .looseObject({
          responseId: str,
          resolvedModel: str,
          promptTokens: num,
          outputTokens: num,
          maxToolCallsExceeded: bool,
          toolCallRounds: list,
          summaries: list,
        })
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
});
export type ChatRequest = z.infer<typeof requestSchema>;
export type EditedFileEvent = NonNullable<ChatRequest['editedFileEvents']>[number];

export const toolCallRoundSchema = z.looseObject({ id: str, toolInputRetry: num, toolCalls: list });
export const toolCallSchema = z.looseObject({ id: str, name: str, arguments: z.unknown() });
export const summarySchema = z.looseObject({
  contextLengthBefore: num,
  model: str,
  durationMs: num,
  outcome: str,
});

export const markdownPartSchema = z.looseObject({ value: z.string() });
export const autoModePartSchema = z.looseObject({ resolved: z.looseObject({ id: z.string() }) });
export const thinkingPartSchema = z.looseObject({ reasoningDurationMs: num });
export const toolInvocationPartSchema = z.looseObject({
  toolId: str,
  toolCallId: str,
  isComplete: bool,
  invocationMessage: z
    .looseObject({ uris: z.record(z.string(), z.unknown()).optional().catch(undefined) })
    .optional()
    .catch(undefined),
});
export const uriPartSchema = z.looseObject({ uri, isEdit: bool });
```

- [ ] **Step 6: Implement the normalizer** — `src/core/ingest/chatSession.ts`

```ts
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../json';
import {
  autoModePartSchema,
  markdownPartSchema,
  requestSchema,
  summarySchema,
  thinkingPartSchema,
  toolCallRoundSchema,
  toolCallSchema,
  toolInvocationPartSchema,
  uriPartSchema,
  type ChatRequest,
  type EditedFileEvent,
} from './chatSessionSchema';
import type {
  Compaction,
  FileAction,
  FileEvent,
  ModelHost,
  NormalizedSession,
  NormalizedTurn,
  SelectionMode,
  SelectionSource,
  ToolCall,
  TurnState,
} from './types';

// modelState.value, confirmed against result.errorDetails on real data.
const TURN_STATES: Partial<Record<number, TurnState>> = {
  0: 'pending',
  1: 'complete',
  2: 'cancelled',
  3: 'failed',
};
// VS Code ChatRequestEditedFileEventKind: 1 Keep, 2 Undo, 3 UserModification.
const EDIT_EVENT_ACTIONS: Partial<Record<number, FileAction>> = {
  1: 'kept',
  2: 'undone',
  3: 'user-modified',
};

const KNOWN_PART_KINDS = new Set([
  'thinking',
  'toolInvocationSerialized',
  'inlineReference',
  'textEditGroup',
  'undoStop',
  'codeblockUri',
  'mcpServersStarting',
  'progressTaskSerialized',
  'elicitationSerialized',
  'autoModeResolution',
  'workspaceEdit',
  'confirmation',
]);

const KNOWN_REQUEST_KEYS = new Set([
  'requestId',
  'timestamp',
  'responseId',
  'modelState',
  'contentReferences',
  'codeCitations',
  'timeSpentWaiting',
  'modeInfo',
  'response',
  'message',
  'variableData',
  'agent',
  'modelId',
  'result',
  'elapsedMs',
  'followups',
  'completionTokens',
  'promptTokens',
  'outputBuffer',
  'promptTokenDetails',
  'responseMarkdownInfo',
  'responseTimestamp',
  'editedFileEvents',
  'hiddenFromTranscript',
  'confirmation',
  'isSystemInitiated',
  'systemInitiatedLabel',
  'terminalExecutionId',
  'copilotCredits',
]);

export interface NormalizeContext {
  file: string;
  workspace: string;
}

export function normalizeChatSession(state: unknown, context: NormalizeContext): NormalizedSession | null {
  if (!isRecord(state) || !Array.isArray(state.requests) || state.requests.length === 0) return null;
  const unknownPartKinds = new Set<string>();
  const unknownRequestKeys = new Set<string>();
  let invalidRequests = 0;
  const turns: NormalizedTurn[] = [];
  for (const raw of state.requests as unknown[]) {
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      invalidRequests++;
      continue;
    }
    for (const key of Object.keys(parsed.data)) if (!KNOWN_REQUEST_KEYS.has(key)) unknownRequestKeys.add(key);
    turns.push(normalizeTurn(parsed.data, turns.length + 1, unknownPartKinds));
  }
  if (turns.length === 0) return null;

  const starts = turns.map((turn) => turn.startedAt).filter((value): value is number => value !== null);
  const creationDate = typeof state.creationDate === 'number' ? state.creationDate : 0;
  const startedAt = starts.length > 0 ? Math.min(...starts) : creationDate;
  const endedAt = Math.max(startedAt, ...turns.map((turn) => turn.endedAt ?? 0));
  const sessionId = typeof state.sessionId === 'string' && state.sessionId !== '' ? state.sessionId : null;
  return {
    id: sessionId ?? basename(context.file).replace(/\.jsonl?$/i, ''),
    sourceFile: context.file,
    workspace: context.workspace,
    title: nonEmpty(typeof state.customTitle === 'string' ? state.customTitle : undefined),
    location: typeof state.initialLocation === 'string' ? state.initialLocation : null,
    startedAt,
    endedAt,
    activeMs: turns.reduce((sum, turn) => sum + (turn.elapsedMs ?? 0), 0),
    turns,
    diagnostics: {
      unknownPartKinds: [...unknownPartKinds].sort(),
      unknownRequestKeys: [...unknownRequestKeys].sort(),
      invalidRequests,
    },
  };
}

function normalizeTurn(request: ChatRequest, index: number, unknownPartKinds: Set<string>): NormalizedTurn {
  const parts = request.response ?? [];
  for (const part of parts) {
    if (isRecord(part) && typeof part.kind === 'string' && !KNOWN_PART_KINDS.has(part.kind))
      unknownPartKinds.add(part.kind);
  }
  const meta = request.result?.metadata;
  const startedAt = request.timestamp ?? null;
  const elapsedMs = request.elapsedMs ?? request.result?.timings?.totalElapsed ?? null;
  const completedAt = request.modelState?.completedAt ?? null;
  const endedAt =
    completedAt ?? (startedAt !== null && elapsedMs !== null ? startedAt + elapsedMs : startedAt);
  const rounds = parseRounds(meta?.toolCallRounds);
  const toolCalls = collectToolCalls(rounds, parts);
  const reasoning = parsePartsOfKind(parts, 'thinking', thinkingPartSchema);
  const stateValue = request.modelState?.value;
  const errorDetails = request.result?.errorDetails;
  return {
    index,
    requestId: request.requestId ?? null,
    responseId: meta?.responseId ?? null,
    startedAt,
    endedAt,
    elapsedMs,
    state: stateValue === undefined ? 'unknown' : (TURN_STATES[stateValue] ?? 'unknown'),
    systemInitiated: request.isSystemInitiated === true,
    hidden: request.hiddenFromTranscript === true,
    mode: request.modeInfo?.kind ?? null,
    userText: nonEmpty(request.message?.text),
    assistantText: nonEmpty(assistantText(parts)),
    ...modelRouting(request.modelId ?? null, parts, meta?.resolvedModel ?? null),
    promptTokens: request.promptTokens ?? meta?.promptTokens ?? null,
    completionTokens: request.completionTokens ?? meta?.outputTokens ?? null,
    credits: request.copilotCredits ?? null,
    promptComposition: (request.promptTokenDetails ?? []).map((detail) => ({
      category: detail.category ?? '',
      label: detail.label ?? '',
      percent: detail.percentageOfPrompt ?? null,
    })),
    reasoningBlocks: reasoning.length,
    reasoningMs: reasoning.reduce((sum, block) => sum + (block.reasoningDurationMs ?? 0), 0),
    toolCalls,
    fileEvents: collectFileEvents(parts, toolCalls, request.editedFileEvents ?? []),
    compactions: parseCompactions(meta?.summaries),
    toolRounds: rounds.length,
    toolInputRetries: rounds.reduce((sum, round) => sum + round.toolInputRetry, 0),
    maxToolCallsExceeded: meta?.maxToolCallsExceeded === true,
    errorCode: errorDetails ? (errorDetails.code ?? 'unknown') : null,
    errorMessage: errorDetails?.message ?? null,
  };
}

interface Routing {
  requestedModel: string | null;
  resolvedModel: string | null;
  resolvedModelSource: string;
  selectionMode: SelectionMode;
  selectionSource: SelectionSource;
  modelHost: ModelHost;
}

function modelRouting(
  requestedModel: string | null,
  parts: readonly unknown[],
  metadataModel: string | null,
): Routing {
  const autoResolved =
    parsePartsOfKind(parts, 'autoModeResolution', autoModePartSchema)[0]?.resolved.id ?? null;
  const isAuto = autoResolved !== null || (requestedModel !== null && /(^|\/)auto$/i.test(requestedModel));
  const isManual = !isAuto && requestedModel !== null;
  let resolvedModel: string | null = null;
  let resolvedModelSource = 'unavailable';
  if (autoResolved !== null) {
    resolvedModel = autoResolved;
    resolvedModelSource = 'exact:autoModeResolution';
  } else if (metadataModel !== null && metadataModel !== '') {
    resolvedModel = metadataModel;
    resolvedModelSource = 'exact:result.metadata.resolvedModel';
  } else if (isManual) {
    resolvedModel = modelNameFromId(requestedModel);
    resolvedModelSource = 'derived:modelId';
  }
  return {
    requestedModel,
    resolvedModel,
    resolvedModelSource,
    selectionMode: isAuto ? 'AUTO' : isManual ? 'MANUAL' : 'UNKNOWN',
    selectionSource: isAuto ? 'COPILOT_AUTO' : isManual ? 'USER' : 'UNKNOWN',
    modelHost: modelHost(requestedModel),
  };
}

export function modelHost(modelId: string | null): ModelHost {
  if (!modelId?.includes('/')) return 'unknown';
  return modelId.startsWith('copilot/') ? 'copilot' : 'byok';
}

/** "copilot/gpt-5.6" → "gpt-5.6"; "<vendor>/<provider label>/<model>" → "<model>". */
export function modelNameFromId(modelId: string): string {
  const segments = modelId.split('/');
  if (segments.length === 1) return modelId;
  if (segments[0] === 'copilot' || segments.length === 2) return segments.slice(1).join('/');
  return segments.slice(2).join('/');
}

export function toolFileAction(toolName: string): FileAction {
  if (/delete|remove/i.test(toolName)) return 'deleted';
  if (/create_?file|new_?file/i.test(toolName)) return 'created';
  if (/edit|replace|insert|write|patch|apply/i.test(toolName)) return 'edited';
  return 'read';
}

interface Round {
  toolInputRetry: number;
  calls: { id: string | null; name: string; args: Record<string, unknown> | null }[];
}

function parseRounds(raw: readonly unknown[] | undefined): Round[] {
  return (raw ?? []).flatMap((value) => {
    const round = toolCallRoundSchema.safeParse(value);
    if (!round.success) return [];
    const calls = (round.data.toolCalls ?? []).flatMap((entry) => {
      const call = toolCallSchema.safeParse(entry);
      return call.success
        ? [{ id: call.data.id ?? null, name: call.data.name ?? 'tool', args: parseArgs(call.data.arguments) }]
        : [];
    });
    return [{ toolInputRetry: round.data.toolInputRetry ?? 0, calls }];
  });
}

function parseArgs(raw: unknown): Record<string, unknown> | null {
  if (isRecord(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : { value };
  } catch {
    return { raw };
  }
}

function collectToolCalls(rounds: readonly Round[], parts: readonly unknown[]): ToolCall[] {
  const fromRounds = rounds.flatMap((round) =>
    round.calls.map((call): ToolCall => ({
      callId: call.id,
      name: call.name,
      args: call.args,
      origin: 'toolCallRound',
      status: 'unknown',
    })),
  );
  if (fromRounds.length > 0) return fromRounds;
  // Some builds/agents record only UI invocation parts. Their ids never match toolCallRounds ids, so the
  // two lists are never merged (see docs/copilot-data-formats.md).
  return parsePartsOfKind(parts, 'toolInvocationSerialized', toolInvocationPartSchema).map(
    (invocation): ToolCall => ({
      callId: invocation.toolCallId ?? null,
      name: invocation.toolId ?? 'tool',
      args: null,
      origin: 'invocation',
      status:
        invocation.isComplete === undefined ? 'unknown' : invocation.isComplete ? 'complete' : 'incomplete',
    }),
  );
}

function collectFileEvents(
  parts: readonly unknown[],
  toolCalls: readonly ToolCall[],
  editedFileEvents: readonly EditedFileEvent[],
): FileEvent[] {
  const events: FileEvent[] = [];
  const add = (path: string | null, action: FileAction, source: string): void => {
    if (path === null || path === '') return;
    if (!events.some((event) => event.path === path && event.action === action))
      events.push({ path, action, source });
  };
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part.kind === 'toolInvocationSerialized') {
      const invocation = toolInvocationPartSchema.safeParse(part);
      if (!invocation.success) continue;
      const toolId = invocation.data.toolId ?? 'unknown';
      for (const uri of Object.keys(invocation.data.invocationMessage?.uris ?? {})) {
        add(fileUriToPath(uri), toolFileAction(toolId), `tool:${toolId}`);
      }
    } else if (part.kind === 'textEditGroup' || part.kind === 'codeblockUri') {
      const edit = uriPartSchema.safeParse(part);
      if (edit.success && (part.kind === 'textEditGroup' || edit.data.isEdit === true)) {
        add(edit.data.uri?.fsPath ?? edit.data.uri?.path ?? null, 'edited', part.kind);
      }
    }
  }
  for (const call of toolCalls) {
    const target = call.args?.filePath;
    if (typeof target === 'string') add(target, toolFileAction(call.name), `toolArgs:${call.name}`);
  }
  for (const event of editedFileEvents) {
    const action = event.eventKind === undefined ? undefined : EDIT_EVENT_ACTIONS[event.eventKind];
    if (action !== undefined) add(event.uri?.fsPath ?? event.uri?.path ?? null, action, 'editedFileEvents');
  }
  return events;
}

function parseCompactions(raw: readonly unknown[] | undefined): Compaction[] {
  return (raw ?? []).flatMap((value) => {
    const summary = summarySchema.safeParse(value);
    return summary.success
      ? [
          {
            contextLengthBefore: summary.data.contextLengthBefore ?? null,
            model: summary.data.model ?? null,
            durationMs: summary.data.durationMs ?? null,
            outcome: summary.data.outcome ?? null,
          },
        ]
      : [];
  });
}

function assistantText(parts: readonly unknown[]): string {
  return parts
    .flatMap((part) => {
      if (isRecord(part) && part.kind !== undefined) return [];
      const markdown = markdownPartSchema.safeParse(part);
      return markdown.success ? [markdown.data.value] : [];
    })
    .join('\n');
}

function parsePartsOfKind<T>(
  parts: readonly unknown[],
  kind: string,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
): T[] {
  return parts.flatMap((part) => {
    if (!isRecord(part) || part.kind !== kind) return [];
    const parsed = schema.safeParse(part);
    return parsed.success ? [parsed.data] : [];
  });
}

function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith('file:')) return null;
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : null;
}
```

- [ ] **Step 7: Run it to verify it passes**

Run: `pnpm vitest run src/core/ingest/chatSession.test.ts` — Expected: PASS (8 tests).

- [ ] **Step 8: Commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(ingest): normalize real Copilot chat sessions with exact usage, credits and routing"
```

---

## Task 1.4: Privacy — secret redaction and capture levels

**Files:**

- Create: `src/core/privacy/redact.ts`, `src/core/privacy/redact.test.ts`, `src/core/privacy/captureLevel.ts`,
  `src/core/privacy/captureLevel.test.ts`

**Interfaces:**

- Consumes: `NormalizedSession`, `NormalizedTurn` (Task 1.3).
- Produces (`redact.ts`): `redactSecrets(text: string): string`, `redactDeep(value: unknown): unknown`.
- Produces (`captureLevel.ts`): `type CaptureLevel = 'metrics' | 'summaries' | 'full'`, `CAPTURE_LEVELS`,
  `isCaptureLevel(value: unknown): value is CaptureLevel`,
  `SUMMARY_LIMITS: { user: 260; assistant: 420; error: 200; title: 120 }`,
  `applyCaptureLevel(session: NormalizedSession, level: CaptureLevel): NormalizedSession`,
  `truncate(value: string, limit: number): string`.

- [ ] **Step 1: Write the failing tests**

`src/core/privacy/redact.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { redactDeep, redactSecrets } from './redact';

describe('redactSecrets', () => {
  it.each([
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789 end', 'token [REDACTED:github-token] end'],
    ['pat github_pat_11ABCDEFGHIJKLMNOPQRSTUV_xyz', 'pat [REDACTED:github-token]'],
    ['key AKIAABCDEFGHIJKLMNOP', 'key [REDACTED:aws-access-key]'],
    ['sk-abcdefghijklmnopqrstuvwx', '[REDACTED:api-key]'],
    ['xoxb-1234567890-abcdef', '[REDACTED:slack-token]'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk', '[REDACTED:jwt]'],
    ['password = "hunter2hunter2"', 'password = "[REDACTED:secret]"'],
    ['-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----', '[REDACTED:private-key]'],
  ])('redacts %s', (input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it('does not double-redact an already redacted assignment', () => {
    expect(redactSecrets("token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'")).toBe(
      "token = '[REDACTED:github-token]'",
    );
  });

  it('leaves ordinary text alone', () => {
    expect(redactSecrets('Fixed the race in src/execution/manager.ts')).toBe(
      'Fixed the race in src/execution/manager.ts',
    );
  });

  it('redacts nested values', () => {
    expect(redactDeep({ a: ['sk-abcdefghijklmnopqrstuvwx', 3], b: { c: 'ok' } })).toEqual({
      a: ['[REDACTED:api-key]', 3],
      b: { c: 'ok' },
    });
  });
});
```

`src/core/privacy/captureLevel.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixturePath } from '../../../test/fixtures/fixtures';
import { normalizeChatSession } from '../ingest/chatSession';
import { replayMutationLog } from '../ingest/mutationLog';
import { applyCaptureLevel, isCaptureLevel, truncate } from './captureLevel';

const loaded = normalizeChatSession(
  replayMutationLog(readFileSync(fixturePath('auto-agent-session.jsonl'), 'utf8')).state,
  { file: 'f', workspace: 'w' },
);
if (loaded === null) throw new Error('fixture failed to load');
const session = loaded;

describe('applyCaptureLevel', () => {
  it('full keeps text and arguments but redacts secrets', () => {
    const full = applyCaptureLevel(session, 'full');
    expect(full.turns[0]?.userText).toBe(session.turns[0]?.userText);
    expect(JSON.stringify(full.turns[1]?.toolCalls[0]?.args)).toContain('[REDACTED:github-token]');
    expect(JSON.stringify(full)).not.toContain('ghp_');
  });

  it('summaries truncates text and drops tool arguments', () => {
    const long = {
      ...session,
      turns: session.turns.map((turn) => ({ ...turn, assistantText: 'x'.repeat(1000) })),
    };
    const summaries = applyCaptureLevel(long, 'summaries');
    expect(summaries.turns[0]?.assistantText).toHaveLength(420);
    expect(summaries.turns.flatMap((turn) => turn.toolCalls).every((call) => call.args === null)).toBe(true);
    expect(summaries.title).toBe('Fix run timeout race');
  });

  it('metrics keeps no conversation content but keeps telemetry', () => {
    const metrics = applyCaptureLevel(session, 'metrics');
    expect(metrics.title).toBeNull();
    for (const turn of metrics.turns) {
      expect(turn.userText).toBeNull();
      expect(turn.assistantText).toBeNull();
      expect(turn.errorMessage).toBeNull();
      expect(turn.toolCalls.every((call) => call.args === null)).toBe(true);
    }
    expect(metrics.turns[0]?.promptTokens).toBe(24000);
    expect(metrics.turns[0]?.credits).toBe(1.126141);
    expect(metrics.turns[0]?.fileEvents).toHaveLength(2);
  });

  it('does not mutate its input', () => {
    applyCaptureLevel(session, 'metrics');
    expect(session.turns[0]?.userText).toBe('Fix the timeout race in src/execution/manager.ts');
  });
});

describe('helpers', () => {
  it('validates capture levels', () => {
    expect(isCaptureLevel('full')).toBe(true);
    expect(isCaptureLevel('everything')).toBe(false);
  });

  it('truncates on one line with an ellipsis', () => {
    expect(truncate('a  b\n c', 10)).toBe('a b c');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/core/privacy` — Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/core/privacy/redact.ts`:

```ts
const PATTERNS: readonly (readonly [name: string, pattern: RegExp])[] = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ['api-key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
];

// `password = "…"`, `apiKey: '…'`, etc. Over-redaction is acceptable; leaking is not.
const ASSIGNMENT =
  /\b((?:api[_-]?key|secret|token|password|passwd|client[_-]?secret)["']?\s*[:=]\s*["']?)([^\s"'`]{8,})/gi;

export function redactSecrets(text: string): string {
  let result = text;
  for (const [name, pattern] of PATTERNS) result = result.replace(pattern, `[REDACTED:${name}]`);
  return result.replace(ASSIGNMENT, (match: string, prefix: string, value: string) =>
    value.startsWith('[REDACTED') ? match : `${prefix}[REDACTED:secret]`,
  );
}

export function redactDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (typeof value !== 'object' || value === null || depth > 32) return value;
  if (Array.isArray(value)) return value.map((item: unknown) => redactDeep(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, depth + 1)]));
}
```

`src/core/privacy/captureLevel.ts`:

```ts
import type { NormalizedSession, NormalizedTurn } from '../ingest/types';
import { redactDeep, redactSecrets } from './redact';

export type CaptureLevel = 'metrics' | 'summaries' | 'full';
export const CAPTURE_LEVELS: readonly CaptureLevel[] = ['metrics', 'summaries', 'full'];
export const SUMMARY_LIMITS = { user: 260, assistant: 420, error: 200, title: 120 } as const;

export function isCaptureLevel(value: unknown): value is CaptureLevel {
  return typeof value === 'string' && (CAPTURE_LEVELS as readonly string[]).includes(value);
}

/**
 * full      – text and tool arguments, secrets redacted
 * summaries – one-line truncated text, secrets redacted, no tool arguments
 * metrics   – no text, titles, error messages, or tool arguments; telemetry and file paths only
 */
export function applyCaptureLevel(session: NormalizedSession, level: CaptureLevel): NormalizedSession {
  return {
    ...session,
    title: captureText(session.title, level, SUMMARY_LIMITS.title),
    turns: session.turns.map((turn) => captureTurn(turn, level)),
  };
}

function captureTurn(turn: NormalizedTurn, level: CaptureLevel): NormalizedTurn {
  return {
    ...turn,
    userText: captureText(turn.userText, level, SUMMARY_LIMITS.user),
    assistantText: captureText(turn.assistantText, level, SUMMARY_LIMITS.assistant),
    errorMessage: captureText(turn.errorMessage, level, SUMMARY_LIMITS.error),
    toolCalls: turn.toolCalls.map((call) => ({
      ...call,
      args:
        level === 'full' && call.args !== null ? (redactDeep(call.args) as Record<string, unknown>) : null,
    })),
  };
}

function captureText(value: string | null, level: CaptureLevel, limit: number): string | null {
  if (value === null || level === 'metrics') return null;
  // Redact before truncating so a secret cut in half cannot slip past the patterns.
  const redacted = redactSecrets(value);
  return level === 'full' ? redacted : truncate(redacted, limit);
}

export function truncate(value: string, limit: number): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length <= limit ? oneLine : `${oneLine.slice(0, limit - 1).trimEnd()}…`;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run src/core/privacy` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(privacy): redact secrets and enforce capture levels before storage"
```

---

## Task 1.5: SQLite storage

**Files:**

- Create: `src/core/storage/database.ts`, `src/core/storage/database.test.ts`, `src/core/storage/migrations.ts`,
  `src/core/storage/sessionStore.ts`, `src/core/storage/sessionStore.test.ts`,
  `src/core/storage/ingestStateStore.ts`, `src/core/storage/ingestStateStore.test.ts`

**Interfaces:**

- Consumes: `NormalizedSession` (1.3), `CaptureLevel`, `SUMMARY_LIMITS`, `applyCaptureLevel` (1.4),
  `localDay`, `daysAgo` (1.1), `TombstoneKind` (1.3).
- Produces (`database.ts`): `type SqlValue`, `class Database { readonly db: DatabaseSync; constructor(filename);
transaction<T>(fn: () => T): T; close() }`.
- Produces (`sessionStore.ts`): `SessionFilter`, `StoredSession`, `StoredTurn`, `class SessionStore {
replaceSession(session, captureLevel, ingestedAt): void; getSession(id): StoredSession | null;
listSessionIds(filter?): string[]; deleteSessions(ids): void; clearContent(ids): void;
downgradeStoredContent(level): void; purgeBefore(day): number; counts(): { sessions: number; turns: number } }`.
- Produces (`ingestStateStore.ts`): `class IngestStateStore { getFingerprints(): Record<string, string>;
setFingerprint(file, fingerprint, sessionId, scannedAt): void; addTombstones(ids, kind, createdAt): void;
getTombstones(): Record<string, TombstoneKind>; getMeta(key): string | null; setMeta(key, value): void }`.

- [ ] **Step 1: Write the failing database test** — `src/core/storage/database.test.ts`

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Database } from './database';
import { MIGRATIONS } from './migrations';

const userVersion = (database: Database): number =>
  (database.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

describe('Database', () => {
  it('migrates once and records the schema version', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ci-db-')), 'insights.db');
    const first = new Database(file);
    expect(userVersion(first)).toBe(MIGRATIONS.length);
    first.close();
    const reopened = new Database(file);
    expect(userVersion(reopened)).toBe(MIGRATIONS.length);
    reopened.close();
  });

  it('enables foreign keys', () => {
    const database = new Database(':memory:');
    expect((database.db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(
      1,
    );
  });

  it('rolls back a failed transaction and supports nesting', () => {
    const database = new Database(':memory:');
    expect(() => {
      database.transaction(() => {
        database.db.prepare("INSERT INTO meta (key, value) VALUES ('a', '1')").run();
        database.transaction(() =>
          database.db.prepare("INSERT INTO meta (key, value) VALUES ('b', '2')").run(),
        );
        throw new Error('boom');
      });
    }).toThrow('boom');
    expect(database.db.prepare('SELECT count(*) AS n FROM meta').get()).toEqual({ n: 0 });
  });
});
```

Run: `pnpm vitest run src/core/storage/database.test.ts` — Expected: FAIL.

Note: rows returned by `node:sqlite` have a null prototype. `toEqual` ignores prototypes, so the last
assertion works; use `{ ...row }` with `node:assert` elsewhere.

- [ ] **Step 2: Implement the database and schema**

`src/core/storage/migrations.ts`:

```ts
/** Append-only. Never edit a migration that has shipped; add a new one. Index + 1 = PRAGMA user_version. */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    source_file TEXT NOT NULL,
    workspace TEXT NOT NULL,
    title TEXT,
    location TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    active_ms INTEGER NOT NULL,
    day TEXT NOT NULL,
    capture_level TEXT NOT NULL,
    unknown_part_kinds TEXT NOT NULL DEFAULT '[]',
    unknown_request_keys TEXT NOT NULL DEFAULT '[]',
    invalid_requests INTEGER NOT NULL DEFAULT 0,
    ingested_at INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_day ON sessions(day);
  CREATE INDEX idx_sessions_workspace ON sessions(workspace);

  CREATE TABLE turns (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    request_id TEXT,
    response_id TEXT,
    started_at INTEGER,
    ended_at INTEGER,
    elapsed_ms INTEGER,
    day TEXT,
    state TEXT NOT NULL,
    system_initiated INTEGER NOT NULL,
    hidden INTEGER NOT NULL,
    mode TEXT,
    user_text TEXT,
    assistant_text TEXT,
    requested_model TEXT,
    resolved_model TEXT,
    resolved_model_source TEXT NOT NULL,
    selection_mode TEXT NOT NULL,
    selection_source TEXT NOT NULL,
    model_host TEXT NOT NULL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    credits REAL,
    prompt_composition TEXT NOT NULL DEFAULT '[]',
    reasoning_blocks INTEGER NOT NULL DEFAULT 0,
    reasoning_ms INTEGER NOT NULL DEFAULT 0,
    tool_rounds INTEGER NOT NULL DEFAULT 0,
    tool_input_retries INTEGER NOT NULL DEFAULT 0,
    max_tool_calls_exceeded INTEGER NOT NULL DEFAULT 0,
    compactions TEXT NOT NULL DEFAULT '[]',
    error_code TEXT,
    error_message TEXT,
    PRIMARY KEY (session_id, idx)
  );
  CREATE INDEX idx_turns_day ON turns(day);
  CREATE INDEX idx_turns_response ON turns(response_id);

  CREATE TABLE tool_calls (
    session_id TEXT NOT NULL,
    turn_idx INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    call_id TEXT,
    name TEXT NOT NULL,
    args TEXT,
    origin TEXT NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY (session_id, turn_idx, seq),
    FOREIGN KEY (session_id, turn_idx) REFERENCES turns(session_id, idx) ON DELETE CASCADE
  );

  CREATE TABLE file_events (
    session_id TEXT NOT NULL,
    turn_idx INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    path TEXT NOT NULL,
    action TEXT NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (session_id, turn_idx, seq),
    FOREIGN KEY (session_id, turn_idx) REFERENCES turns(session_id, idx) ON DELETE CASCADE
  );
  CREATE INDEX idx_file_events_path ON file_events(path);

  CREATE TABLE tombstones (
    session_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('deleted', 'content-cleared')),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE scan_state (
    file TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    session_id TEXT,
    scanned_at INTEGER NOT NULL
  );

  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];
```

`src/core/storage/database.ts`:

```ts
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations';

/** Values node:sqlite accepts as parameters. */
export type SqlValue = null | number | bigint | string | Uint8Array;

export class Database {
  readonly db: DatabaseSync;
  private depth = 0;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    // WAL lets other windows read while the leader writes; busy_timeout rides out brief lock contention.
    this.db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;',
    );
    this.migrate();
  }

  /** Runs `fn` atomically. Nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth--;
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Already closed.
    }
  }

  private migrate(): void {
    const current = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    for (const [index, sql] of MIGRATIONS.entries()) {
      if (index < current) continue;
      this.transaction(() => {
        this.db.exec(sql);
        this.db.exec(`PRAGMA user_version = ${index + 1}`);
      });
    }
  }
}
```

Run: `pnpm vitest run src/core/storage/database.test.ts` — Expected: PASS.

- [ ] **Step 3: Write the failing session-store test** — `src/core/storage/sessionStore.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixturePath } from '../../../test/fixtures/fixtures';
import { normalizeChatSession } from '../ingest/chatSession';
import { replayMutationLog } from '../ingest/mutationLog';
import type { NormalizedSession } from '../ingest/types';
import { applyCaptureLevel } from '../privacy/captureLevel';
import { daysAgo, localDay } from '../time';
import { Database } from './database';
import { SessionStore } from './sessionStore';

function fixture(): NormalizedSession {
  const session = normalizeChatSession(
    replayMutationLog(readFileSync(fixturePath('auto-agent-session.jsonl'), 'utf8')).state,
    { file: 'a.jsonl', workspace: 'w' },
  );
  if (session === null) throw new Error('fixture failed to load');
  return applyCaptureLevel(session, 'full');
}

function newStore() {
  const database = new Database(':memory:');
  return { database, sessions: new SessionStore(database) };
}

describe('SessionStore', () => {
  it('stores sessions with turns, tool calls and file events', () => {
    const { sessions } = newStore();
    sessions.replaceSession(fixture(), 'full', 1);
    const stored = sessions.getSession('fx-auto-1');
    expect(stored).toMatchObject({
      id: 'fx-auto-1',
      workspace: 'w',
      title: 'Fix run timeout race',
      captureLevel: 'full',
      activeMs: 18000,
      day: localDay(1790000001000),
    });
    expect(stored?.turns).toHaveLength(2);
    expect(stored?.turns[0]).toMatchObject({
      promptTokens: 24000,
      credits: 1.126141,
      resolvedModel: 'gpt-5.6-luna',
      selectionMode: 'AUTO',
      modelHost: 'copilot',
      systemInitiated: false,
    });
    expect(stored?.turns[0]?.toolCalls.map((call) => call.name)).toEqual([
      'read_file',
      'replace_string_in_file',
    ]);
    expect(stored?.turns[1]?.fileEvents.map((event) => event.action)).toEqual(['created', 'kept']);
    expect(sessions.counts()).toEqual({ sessions: 1, turns: 2 });
  });

  it('replaces a session completely when the same id arrives again from another file', () => {
    const { sessions } = newStore();
    const session = fixture();
    sessions.replaceSession(session, 'full', 1);
    sessions.replaceSession(
      { ...session, sourceFile: 'moved.jsonl', turns: session.turns.slice(0, 1) },
      'full',
      2,
    );
    expect(sessions.counts()).toEqual({ sessions: 1, turns: 1 });
    expect(sessions.getSession('fx-auto-1')?.turns[0]?.toolCalls).toHaveLength(2);
  });

  it('clears conversation content but keeps telemetry', () => {
    const { sessions } = newStore();
    sessions.replaceSession(fixture(), 'full', 1);
    sessions.clearContent(['fx-auto-1']);
    const stored = sessions.getSession('fx-auto-1');
    expect(stored?.title).toBeNull();
    expect(stored?.captureLevel).toBe('metrics');
    expect(stored?.turns.every((turn) => turn.userText === null && turn.assistantText === null)).toBe(true);
    expect(stored?.turns.flatMap((turn) => turn.toolCalls).every((call) => call.args === null)).toBe(true);
    expect(stored?.turns[0]?.promptTokens).toBe(24000);
  });

  it('downgrades stored full content to summaries', () => {
    const { sessions } = newStore();
    const session = fixture();
    const long = {
      ...session,
      turns: session.turns.map((turn) => ({ ...turn, assistantText: 'y'.repeat(1000) })),
    };
    sessions.replaceSession(long, 'full', 1);
    sessions.downgradeStoredContent('summaries');
    const stored = sessions.getSession('fx-auto-1');
    expect(stored?.captureLevel).toBe('summaries');
    expect(stored?.turns[0]?.assistantText).toHaveLength(420);
    expect(stored?.turns.flatMap((turn) => turn.toolCalls).every((call) => call.args === null)).toBe(true);
  });

  it('downgrades stored content to metrics', () => {
    const { sessions } = newStore();
    sessions.replaceSession(fixture(), 'full', 1);
    sessions.downgradeStoredContent('metrics');
    expect(sessions.getSession('fx-auto-1')?.turns[0]?.userText).toBeNull();
  });

  it('filters, deletes and purges', () => {
    const { sessions } = newStore();
    const session = fixture();
    const day = localDay(session.startedAt);
    sessions.replaceSession(session, 'full', 1);
    sessions.replaceSession({ ...session, id: 'other', workspace: 'x' }, 'full', 1);
    expect(sessions.listSessionIds({ workspace: 'x' })).toEqual(['other']);
    expect(sessions.listSessionIds({ fromDay: daysAgo(day, -1) })).toEqual([]);
    expect(sessions.listSessionIds({ fromDay: day, toDay: day }).sort()).toEqual(['fx-auto-1', 'other']);
    sessions.deleteSessions(['other']);
    expect(sessions.counts()).toEqual({ sessions: 1, turns: 2 });
    expect(sessions.purgeBefore(day)).toBe(0);
    expect(sessions.purgeBefore(daysAgo(day, -1))).toBe(1);
    expect(sessions.counts()).toEqual({ sessions: 0, turns: 0 });
  });

  it('writes nothing when the surrounding transaction fails', () => {
    const { database, sessions } = newStore();
    expect(() => {
      database.transaction(() => {
        sessions.replaceSession(fixture(), 'full', 1);
        throw new Error('boom');
      });
    }).toThrow('boom');
    expect(sessions.counts()).toEqual({ sessions: 0, turns: 0 });
  });
});
```

Run: `pnpm vitest run src/core/storage/sessionStore.test.ts` — Expected: FAIL.

- [ ] **Step 4: Implement `src/core/storage/sessionStore.ts`**

```ts
import type { StatementSync } from 'node:sqlite';
import type { NormalizedSession, NormalizedTurn } from '../ingest/types';
import { SUMMARY_LIMITS, type CaptureLevel } from '../privacy/captureLevel';
import { localDay } from '../time';
import type { Database, SqlValue } from './database';

export interface SessionFilter {
  fromDay?: string;
  toDay?: string;
  workspace?: string;
}

export interface StoredToolCall {
  name: string;
  args: unknown;
  origin: string;
  status: string;
}

export interface StoredFileEvent {
  path: string;
  action: string;
  source: string;
}

export interface StoredTurn {
  index: number;
  day: string | null;
  state: string;
  systemInitiated: boolean;
  userText: string | null;
  assistantText: string | null;
  requestedModel: string | null;
  resolvedModel: string | null;
  selectionMode: string;
  modelHost: string;
  promptTokens: number | null;
  completionTokens: number | null;
  credits: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  toolCalls: StoredToolCall[];
  fileEvents: StoredFileEvent[];
}

export interface StoredSession {
  id: string;
  workspace: string;
  title: string | null;
  day: string;
  startedAt: number;
  endedAt: number;
  activeMs: number;
  captureLevel: string;
  turns: StoredTurn[];
}

const SESSION_COLUMNS = [
  'id',
  'source_file',
  'workspace',
  'title',
  'location',
  'started_at',
  'ended_at',
  'active_ms',
  'day',
  'capture_level',
  'unknown_part_kinds',
  'unknown_request_keys',
  'invalid_requests',
  'ingested_at',
] as const;
const TURN_COLUMNS = [
  'session_id',
  'idx',
  'request_id',
  'response_id',
  'started_at',
  'ended_at',
  'elapsed_ms',
  'day',
  'state',
  'system_initiated',
  'hidden',
  'mode',
  'user_text',
  'assistant_text',
  'requested_model',
  'resolved_model',
  'resolved_model_source',
  'selection_mode',
  'selection_source',
  'model_host',
  'prompt_tokens',
  'completion_tokens',
  'credits',
  'prompt_composition',
  'reasoning_blocks',
  'reasoning_ms',
  'tool_rounds',
  'tool_input_retries',
  'max_tool_calls_exceeded',
  'compactions',
  'error_code',
  'error_message',
] as const;
const TOOL_COLUMNS = [
  'session_id',
  'turn_idx',
  'seq',
  'call_id',
  'name',
  'args',
  'origin',
  'status',
] as const;
const FILE_COLUMNS = ['session_id', 'turn_idx', 'seq', 'path', 'action', 'source'] as const;

type Row<C extends readonly string[]> = Record<C[number], SqlValue>;

// Pass id lists as one JSON parameter: no dynamic SQL, no parameter-count limits.
const IDS = 'SELECT value FROM json_each(:ids)';

export class SessionStore {
  private readonly statements: {
    deleteSession: StatementSync;
    insertSession: StatementSync;
    insertTurn: StatementSync;
    insertTool: StatementSync;
    insertFile: StatementSync;
  };

  constructor(private readonly database: Database) {
    const { db } = database;
    this.statements = {
      deleteSession: db.prepare('DELETE FROM sessions WHERE id = :id'),
      insertSession: db.prepare(insertSql('sessions', SESSION_COLUMNS)),
      insertTurn: db.prepare(insertSql('turns', TURN_COLUMNS)),
      insertTool: db.prepare(insertSql('tool_calls', TOOL_COLUMNS)),
      insertFile: db.prepare(insertSql('file_events', FILE_COLUMNS)),
    };
  }

  /** Inserts or fully replaces a session (turns, tool calls and file events cascade). */
  replaceSession(session: NormalizedSession, captureLevel: CaptureLevel, ingestedAt: number): void {
    this.database.transaction(() => {
      this.statements.deleteSession.run({ id: session.id });
      this.statements.insertSession.run(sessionRow(session, captureLevel, ingestedAt));
      for (const turn of session.turns) {
        this.statements.insertTurn.run(turnRow(session.id, turn));
        for (const [seq, call] of turn.toolCalls.entries()) {
          const row: Row<typeof TOOL_COLUMNS> = {
            session_id: session.id,
            turn_idx: turn.index,
            seq,
            call_id: call.callId,
            name: call.name,
            args: call.args === null ? null : JSON.stringify(call.args),
            origin: call.origin,
            status: call.status,
          };
          this.statements.insertTool.run(row);
        }
        for (const [seq, event] of turn.fileEvents.entries()) {
          const row: Row<typeof FILE_COLUMNS> = {
            session_id: session.id,
            turn_idx: turn.index,
            seq,
            path: event.path,
            action: event.action,
            source: event.source,
          };
          this.statements.insertFile.run(row);
        }
      }
    });
  }

  getSession(id: string): StoredSession | null {
    const { db } = this.database;
    // node:sqlite rows are Record<string, SQLOutputValue>; row interfaces describe our schema.
    const session = db.prepare('SELECT * FROM sessions WHERE id = :id').get({ id }) as unknown as
      SessionRow | undefined;
    if (session === undefined) return null;
    const turns = db
      .prepare('SELECT * FROM turns WHERE session_id = :id ORDER BY idx')
      .all({ id }) as unknown as TurnRow[];
    const tools = db
      .prepare('SELECT * FROM tool_calls WHERE session_id = :id ORDER BY turn_idx, seq')
      .all({ id }) as unknown as ToolRow[];
    const files = db
      .prepare('SELECT * FROM file_events WHERE session_id = :id ORDER BY turn_idx, seq')
      .all({ id }) as unknown as FileRow[];
    return {
      id: session.id,
      workspace: session.workspace,
      title: session.title,
      day: session.day,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      activeMs: session.active_ms,
      captureLevel: session.capture_level,
      turns: turns.map((turn) => ({
        index: turn.idx,
        day: turn.day,
        state: turn.state,
        systemInitiated: turn.system_initiated === 1,
        userText: turn.user_text,
        assistantText: turn.assistant_text,
        requestedModel: turn.requested_model,
        resolvedModel: turn.resolved_model,
        selectionMode: turn.selection_mode,
        modelHost: turn.model_host,
        promptTokens: turn.prompt_tokens,
        completionTokens: turn.completion_tokens,
        credits: turn.credits,
        errorCode: turn.error_code,
        errorMessage: turn.error_message,
        toolCalls: tools
          .filter((tool) => tool.turn_idx === turn.idx)
          .map((tool) => ({
            name: tool.name,
            args: tool.args === null ? null : (JSON.parse(tool.args) as unknown),
            origin: tool.origin,
            status: tool.status,
          })),
        fileEvents: files
          .filter((file) => file.turn_idx === turn.idx)
          .map((file) => ({ path: file.path, action: file.action, source: file.source })),
      })),
    };
  }

  listSessionIds(filter: SessionFilter = {}): string[] {
    const where: string[] = [];
    const params: Record<string, SqlValue> = {};
    if (filter.fromDay !== undefined) {
      where.push('day >= :fromDay');
      params.fromDay = filter.fromDay;
    }
    if (filter.toDay !== undefined) {
      where.push('day <= :toDay');
      params.toDay = filter.toDay;
    }
    if (filter.workspace !== undefined) {
      where.push('workspace = :workspace');
      params.workspace = filter.workspace;
    }
    const sql = `SELECT id FROM sessions${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY started_at`;
    return (this.database.db.prepare(sql).all(params) as unknown as { id: string }[]).map((row) => row.id);
  }

  deleteSessions(ids: readonly string[]): void {
    this.database.db.prepare(`DELETE FROM sessions WHERE id IN (${IDS})`).run({ ids: JSON.stringify(ids) });
  }

  /** Removes all conversation content; telemetry, models and file paths remain. */
  clearContent(ids: readonly string[]): void {
    const { db } = this.database;
    const params = { ids: JSON.stringify(ids) };
    this.database.transaction(() => {
      db.prepare(
        `UPDATE turns SET user_text = NULL, assistant_text = NULL, error_message = NULL WHERE session_id IN (${IDS})`,
      ).run(params);
      db.prepare(`UPDATE tool_calls SET args = NULL WHERE session_id IN (${IDS})`).run(params);
      db.prepare(`UPDATE sessions SET title = NULL, capture_level = 'metrics' WHERE id IN (${IDS})`).run(
        params,
      );
    });
  }

  /**
   * Applies a lower capture level to content already stored, including sessions whose Copilot source file
   * no longer exists (a re-scan cannot reach those).
   */
  downgradeStoredContent(level: CaptureLevel): void {
    if (level === 'full') return;
    if (level === 'metrics') {
      const ids = (
        this.database.db
          .prepare("SELECT id FROM sessions WHERE capture_level <> 'metrics'")
          .all() as unknown as { id: string }[]
      ).map((row) => row.id);
      this.clearContent(ids);
      return;
    }
    const cut = (column: string, limit: number): string =>
      `${column} = CASE WHEN length(${column}) > ${limit} THEN substr(${column}, 1, ${limit - 1}) || '…' ELSE ${column} END`;
    const full = "SELECT id FROM sessions WHERE capture_level = 'full'";
    this.database.transaction(() => {
      const { db } = this.database;
      db.exec(
        `UPDATE turns SET ${cut('user_text', SUMMARY_LIMITS.user)}, ${cut('assistant_text', SUMMARY_LIMITS.assistant)}, ${cut('error_message', SUMMARY_LIMITS.error)} WHERE session_id IN (${full})`,
      );
      db.exec(`UPDATE tool_calls SET args = NULL WHERE session_id IN (${full})`);
      db.exec(
        `UPDATE sessions SET ${cut('title', SUMMARY_LIMITS.title)}, capture_level = 'summaries' WHERE capture_level = 'full'`,
      );
    });
  }

  /** Deletes sessions whose day is before `day`; returns how many were removed. */
  purgeBefore(day: string): number {
    return Number(this.database.db.prepare('DELETE FROM sessions WHERE day < :day').run({ day }).changes);
  }

  counts(): { sessions: number; turns: number } {
    const row = this.database.db
      .prepare('SELECT (SELECT count(*) FROM sessions) AS sessions, (SELECT count(*) FROM turns) AS turns')
      .get() as { sessions: number; turns: number };
    return { sessions: row.sessions, turns: row.turns };
  }
}

function insertSql(table: string, columns: readonly string[]): string {
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((column) => `:${column}`).join(', ')})`;
}

function bit(value: boolean): number {
  return value ? 1 : 0;
}

function sessionRow(
  session: NormalizedSession,
  captureLevel: CaptureLevel,
  ingestedAt: number,
): Row<typeof SESSION_COLUMNS> {
  return {
    id: session.id,
    source_file: session.sourceFile,
    workspace: session.workspace,
    title: session.title,
    location: session.location,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    active_ms: session.activeMs,
    day: localDay(session.startedAt),
    capture_level: captureLevel,
    unknown_part_kinds: JSON.stringify(session.diagnostics.unknownPartKinds),
    unknown_request_keys: JSON.stringify(session.diagnostics.unknownRequestKeys),
    invalid_requests: session.diagnostics.invalidRequests,
    ingested_at: ingestedAt,
  };
}

function turnRow(sessionId: string, turn: NormalizedTurn): Row<typeof TURN_COLUMNS> {
  return {
    session_id: sessionId,
    idx: turn.index,
    request_id: turn.requestId,
    response_id: turn.responseId,
    started_at: turn.startedAt,
    ended_at: turn.endedAt,
    elapsed_ms: turn.elapsedMs,
    day: turn.startedAt === null ? null : localDay(turn.startedAt),
    state: turn.state,
    system_initiated: bit(turn.systemInitiated),
    hidden: bit(turn.hidden),
    mode: turn.mode,
    user_text: turn.userText,
    assistant_text: turn.assistantText,
    requested_model: turn.requestedModel,
    resolved_model: turn.resolvedModel,
    resolved_model_source: turn.resolvedModelSource,
    selection_mode: turn.selectionMode,
    selection_source: turn.selectionSource,
    model_host: turn.modelHost,
    prompt_tokens: turn.promptTokens,
    completion_tokens: turn.completionTokens,
    credits: turn.credits,
    prompt_composition: JSON.stringify(turn.promptComposition),
    reasoning_blocks: turn.reasoningBlocks,
    reasoning_ms: turn.reasoningMs,
    tool_rounds: turn.toolRounds,
    tool_input_retries: turn.toolInputRetries,
    max_tool_calls_exceeded: bit(turn.maxToolCallsExceeded),
    compactions: JSON.stringify(turn.compactions),
    error_code: turn.errorCode,
    error_message: turn.errorMessage,
  };
}

interface SessionRow {
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
  day: string | null;
  state: string;
  system_initiated: number;
  user_text: string | null;
  assistant_text: string | null;
  requested_model: string | null;
  resolved_model: string | null;
  selection_mode: string;
  model_host: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  credits: number | null;
  error_code: string | null;
  error_message: string | null;
}

interface ToolRow {
  turn_idx: number;
  name: string;
  args: string | null;
  origin: string;
  status: string;
}

interface FileRow {
  turn_idx: number;
  path: string;
  action: string;
  source: string;
}
```

Run: `pnpm vitest run src/core/storage/sessionStore.test.ts` — Expected: PASS.

- [ ] **Step 5: Write the failing ingest-state test** — `src/core/storage/ingestStateStore.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { Database } from './database';
import { IngestStateStore } from './ingestStateStore';

const newState = () => new IngestStateStore(new Database(':memory:'));

describe('IngestStateStore', () => {
  it('tracks file fingerprints', () => {
    const state = newState();
    state.setFingerprint('/a.jsonl', '10:1', 's1', 1);
    state.setFingerprint('/a.jsonl', '20:2', 's1', 2);
    state.setFingerprint('/b.jsonl', '5:5', null, 2);
    expect(state.getFingerprints()).toEqual({ '/a.jsonl': '20:2', '/b.jsonl': '5:5' });
  });

  it('keeps deleted tombstones from being downgraded to content-cleared', () => {
    const state = newState();
    state.addTombstones(['a', 'b'], 'content-cleared', 1);
    state.addTombstones(['a'], 'deleted', 2);
    state.addTombstones(['a', 'b'], 'content-cleared', 3);
    expect(state.getTombstones()).toEqual({ a: 'deleted', b: 'content-cleared' });
  });

  it('stores meta values', () => {
    const state = newState();
    expect(state.getMeta('x')).toBeNull();
    state.setMeta('x', '1');
    state.setMeta('x', '2');
    expect(state.getMeta('x')).toBe('2');
  });
});
```

Run: `pnpm vitest run src/core/storage/ingestStateStore.test.ts` — Expected: FAIL.

- [ ] **Step 6: Implement `src/core/storage/ingestStateStore.ts`**

```ts
import type { TombstoneKind } from '../ingest/types';
import type { Database } from './database';

export class IngestStateStore {
  constructor(private readonly database: Database) {}

  getFingerprints(): Record<string, string> {
    const rows = this.database.db.prepare('SELECT file, fingerprint FROM scan_state').all() as unknown as {
      file: string;
      fingerprint: string;
    }[];
    return Object.fromEntries(rows.map((row) => [row.file, row.fingerprint]));
  }

  setFingerprint(file: string, fingerprint: string, sessionId: string | null, scannedAt: number): void {
    this.database.db
      .prepare(
        `INSERT INTO scan_state (file, fingerprint, session_id, scanned_at) VALUES (:file, :fingerprint, :sessionId, :scannedAt)
         ON CONFLICT(file) DO UPDATE SET fingerprint = excluded.fingerprint, session_id = excluded.session_id, scanned_at = excluded.scanned_at`,
      )
      .run({ file, fingerprint, sessionId, scannedAt });
  }

  /** A 'deleted' tombstone always wins over 'content-cleared'. */
  addTombstones(ids: readonly string[], kind: TombstoneKind, createdAt: number): void {
    const statement = this.database.db.prepare(
      `INSERT INTO tombstones (session_id, kind, created_at) VALUES (:id, :kind, :createdAt)
       ON CONFLICT(session_id) DO UPDATE SET
         kind = CASE WHEN tombstones.kind = 'deleted' THEN 'deleted' ELSE excluded.kind END,
         created_at = excluded.created_at`,
    );
    this.database.transaction(() => {
      for (const id of ids) statement.run({ id, kind, createdAt });
    });
  }

  getTombstones(): Record<string, TombstoneKind> {
    const rows = this.database.db.prepare('SELECT session_id, kind FROM tombstones').all() as unknown as {
      session_id: string;
      kind: TombstoneKind;
    }[];
    return Object.fromEntries(rows.map((row) => [row.session_id, row.kind]));
  }

  getMeta(key: string): string | null {
    const row = this.database.db.prepare('SELECT value FROM meta WHERE key = :key').get({ key }) as
      { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.database.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run({ key, value });
  }
}
```

Run: `pnpm vitest run src/core/storage` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(storage): add SQLite schema v1 with session, tombstone and scan-state stores"
```

---

## Task 1.6: Storage roots and the scanner

**Files:**

- Create: `src/core/ingest/roots.ts`, `src/core/ingest/roots.test.ts`, `src/core/ingest/scanner.ts`,
  `src/core/ingest/scanner.test.ts`
- Modify: `test/fixtures/fixtures.ts` (add `createFixtureUserDir`)

**Interfaces:**

- Consumes: `loadChatSessionState` (1.2), `normalizeChatSession` (1.3), `applyCaptureLevel`, `CaptureLevel`
  (1.4), `TombstoneKind`, `NormalizedSession` (1.3), `isRecord` (1.2).
- Produces (`roots.ts`): `StorageRoot { kind: 'workspaceStorage' | 'emptyWindow'; dir: string }`,
  `userDirsFromGlobalStorage(dir): string[]`, `defaultUserDir(product?, platform?, env?, home?): string`,
  `resolveStorageRoots({ userDirs, extraWorkspaceStorageRoots? }): StorageRoot[]`.
- Produces (`scanner.ts`): `SessionFile`, `ScanInput { roots; known: Record<string,string>; captureLevel;
tombstones: Record<string, TombstoneKind> }`, `ScanResult { file; fingerprint; session: NormalizedSession | null;
captureLevel; skipped: 'empty' | 'deleted' | null }`, `ScanStats { files; parsed; unchanged; empty; deleted;
badLines; errors: { file; message }[] }`, `ScanOutput { results; stats }`, `listChatSessionFiles(roots)`,
  `readWorkspaceLabel(workspaceDir)`, `scanChatSessions(input): ScanOutput`.
- Produces (`fixtures.ts`): `createFixtureUserDir(): { userDir: string; globalStorageDir: string }` — a temp
  `User/` dir with `workspaceStorage/ws1` (auto + empty sessions, workspace "alpha") and
  `globalStorage/emptyWindowChatSessions` (byok session).

- [ ] **Step 1: Add the fixture builder** — append to `test/fixtures/fixtures.ts`

Add these imports at the top of the file:

```ts
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
```

Append:

```ts
/** Builds a throwaway VS Code `User/` directory laid out like the real one. */
export function createFixtureUserDir(): { userDir: string; globalStorageDir: string } {
  const userDir = join(mkdtempSync(join(tmpdir(), 'ci-user-')), 'User');
  const workspaceDir = join(userDir, 'workspaceStorage', 'ws1');
  mkdirSync(join(workspaceDir, 'chatSessions'), { recursive: true });
  writeFileSync(join(workspaceDir, 'workspace.json'), JSON.stringify({ folder: 'file:///repo/alpha' }));
  copyFileSync(
    fixturePath('auto-agent-session.jsonl'),
    join(workspaceDir, 'chatSessions', 'fx-auto-1.jsonl'),
  );
  copyFileSync(fixturePath('empty-session.jsonl'), join(workspaceDir, 'chatSessions', 'fx-empty-1.jsonl'));
  const emptyWindowDir = join(userDir, 'globalStorage', 'emptyWindowChatSessions');
  mkdirSync(emptyWindowDir, { recursive: true });
  copyFileSync(fixturePath('byok-failed-session.jsonl'), join(emptyWindowDir, 'fx-byok-1.jsonl'));
  const globalStorageDir = join(userDir, 'globalStorage', 'local.copilot-insights');
  mkdirSync(globalStorageDir, { recursive: true });
  return { userDir, globalStorageDir };
}
```

- [ ] **Step 2: Write the failing tests**

`src/core/ingest/roots.test.ts`:

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixtureUserDir } from '../../../test/fixtures/fixtures';
import { defaultUserDir, resolveStorageRoots, userDirsFromGlobalStorage } from './roots';

describe('roots', () => {
  it('derives user directories from the extension global storage path, including profiles', () => {
    expect(userDirsFromGlobalStorage('/u/User/globalStorage/local.copilot-insights')).toEqual(['/u/User']);
    expect(userDirsFromGlobalStorage('/u/User/profiles/abc/globalStorage/local.copilot-insights')).toEqual([
      '/u/User/profiles/abc',
      '/u/User',
    ]);
  });

  it('knows the default user directory per platform', () => {
    expect(defaultUserDir('Code', 'darwin', {}, '/h')).toBe('/h/Library/Application Support/Code/User');
    expect(defaultUserDir('Code', 'linux', { XDG_CONFIG_HOME: '/x' }, '/h')).toBe('/x/Code/User');
    expect(defaultUserDir('Code - Insiders', 'linux', {}, '/h')).toBe('/h/.config/Code - Insiders/User');
  });

  it('returns only existing, de-duplicated roots', () => {
    const { userDir } = createFixtureUserDir();
    const roots = resolveStorageRoots({
      userDirs: [userDir, userDir],
      extraWorkspaceStorageRoots: [join(userDir, 'workspaceStorage'), '/does/not/exist'],
    });
    expect(roots).toEqual([
      { kind: 'workspaceStorage', dir: join(userDir, 'workspaceStorage') },
      { kind: 'emptyWindow', dir: join(userDir, 'globalStorage', 'emptyWindowChatSessions') },
    ]);
  });
});
```

`src/core/ingest/scanner.test.ts`:

```ts
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixtureUserDir } from '../../../test/fixtures/fixtures';
import { resolveStorageRoots } from './roots';
import { listChatSessionFiles, scanChatSessions, type ScanInput } from './scanner';

function setup(overrides: Partial<ScanInput> = {}) {
  const { userDir } = createFixtureUserDir();
  const input: ScanInput = {
    roots: resolveStorageRoots({ userDirs: [userDir] }),
    known: {},
    captureLevel: 'full',
    tombstones: {},
    ...overrides,
  };
  return { userDir, input };
}

describe('scanner', () => {
  it('lists chat session files with workspace labels', () => {
    const { input } = setup();
    const files = listChatSessionFiles(input.roots);
    expect(files).toHaveLength(3);
    expect(new Set(files.map((file) => file.workspace))).toEqual(new Set(['alpha', 'No workspace']));
  });

  it('parses sessions and skips empty ones', () => {
    const { input } = setup();
    const { results, stats } = scanChatSessions(input);
    expect(stats).toMatchObject({ files: 3, parsed: 2, empty: 1, unchanged: 0, deleted: 0, errors: [] });
    expect(results.flatMap((result) => (result.session ? [result.session.id] : [])).sort()).toEqual([
      'fx-auto-1',
      'fx-byok-1',
    ]);
    expect(results.find((result) => result.skipped === 'empty')?.session).toBeNull();
  });

  it('skips files whose fingerprint is unchanged', () => {
    const { input } = setup();
    const first = scanChatSessions(input);
    const known = Object.fromEntries(first.results.map((result) => [result.file, result.fingerprint]));
    const second = scanChatSessions({ ...input, known });
    expect(second.stats).toMatchObject({ unchanged: 3, parsed: 0 });
    expect(second.results).toEqual([]);
  });

  it('honours tombstones', () => {
    const { input } = setup({ tombstones: { 'fx-auto-1': 'deleted', 'fx-byok-1': 'content-cleared' } });
    const { results, stats } = scanChatSessions(input);
    expect(stats.deleted).toBe(1);
    const byok = results.find((result) => result.session?.id === 'fx-byok-1');
    expect(byok?.captureLevel).toBe('metrics');
    expect(byok?.session?.turns.every((turn) => turn.userText === null)).toBe(true);
  });

  it('redacts secrets and applies the capture level', () => {
    const { input } = setup();
    expect(JSON.stringify(scanChatSessions(input).results)).not.toContain('ghp_');
    const summaries = scanChatSessions({ ...input, captureLevel: 'summaries' });
    expect(
      summaries.results
        .flatMap((r) => r.session?.turns ?? [])
        .flatMap((t) => t.toolCalls)
        .every((c) => c.args === null),
    ).toBe(true);
  });

  it('parses a file that Copilot is still writing (truncated last line)', () => {
    const { userDir, input } = setup();
    appendFileSync(
      join(userDir, 'workspaceStorage', 'ws1', 'chatSessions', 'fx-auto-1.jsonl'),
      '\n{"kind":1,"k":[',
    );
    const { results, stats } = scanChatSessions(input);
    expect(stats.badLines).toBe(1);
    expect(results.find((result) => result.session?.id === 'fx-auto-1')?.session?.turns).toHaveLength(2);
  });

  it('labels workspaces with a missing or corrupt workspace.json', () => {
    const { userDir, input } = setup();
    writeFileSync(join(userDir, 'workspaceStorage', 'ws1', 'workspace.json'), 'not json');
    expect(listChatSessionFiles(input.roots).find((file) => file.file.includes('ws1'))?.workspace).toBe(
      'workspace:ws1',
    );
  });

  it('records unreadable files as errors and keeps going', () => {
    const { userDir, input } = setup();
    mkdirSync(join(userDir, 'workspaceStorage', 'ws1', 'chatSessions', 'broken.jsonl'));
    const { stats } = scanChatSessions(input);
    expect(stats.errors).toHaveLength(1);
    expect(stats.parsed).toBe(2);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run src/core/ingest/roots.test.ts src/core/ingest/scanner.test.ts` — Expected: FAIL.

- [ ] **Step 4: Implement**

`src/core/ingest/roots.ts`:

```ts
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export interface StorageRoot {
  readonly kind: 'workspaceStorage' | 'emptyWindow';
  readonly dir: string;
}

/**
 * The extension's globalStorage is `<User>/globalStorage/<id>` or, with profiles,
 * `<User>/profiles/<profile>/globalStorage/<id>`; workspaceStorage stays under `<User>`.
 */
export function userDirsFromGlobalStorage(globalStorageDir: string): string[] {
  const owner = resolve(globalStorageDir, '..', '..');
  const dirs = [owner];
  if (basename(dirname(owner)) === 'profiles') dirs.push(resolve(owner, '..', '..'));
  return dirs;
}

/** Used only outside VS Code (the smoke script). Inside VS Code, derive from the extension's storage. */
export function defaultUserDir(
  product = 'Code',
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), product, 'User');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', product, 'User');
  return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), product, 'User');
}

export function resolveStorageRoots(options: {
  userDirs: readonly string[];
  extraWorkspaceStorageRoots?: readonly string[];
}): StorageRoot[] {
  const candidates: StorageRoot[] = [
    ...(options.extraWorkspaceStorageRoots ?? []).map((dir) => ({
      kind: 'workspaceStorage' as const,
      dir: resolve(dir),
    })),
    ...options.userDirs.flatMap((userDir) => [
      { kind: 'workspaceStorage' as const, dir: join(userDir, 'workspaceStorage') },
      { kind: 'emptyWindow' as const, dir: join(userDir, 'globalStorage', 'emptyWindowChatSessions') },
    ]),
  ];
  const seen = new Set<string>();
  return candidates.filter((root) => {
    const key = `${root.kind}:${root.dir}`;
    if (seen.has(key) || !isDirectory(root.dir)) return false;
    seen.add(key);
    return true;
  });
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
```

`src/core/ingest/scanner.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isRecord } from '../json';
import { applyCaptureLevel, type CaptureLevel } from '../privacy/captureLevel';
import { normalizeChatSession } from './chatSession';
import { loadChatSessionState } from './mutationLog';
import type { StorageRoot } from './roots';
import type { NormalizedSession, TombstoneKind } from './types';

const SESSION_FILE = /\.jsonl?$/i;

export interface SessionFile {
  file: string;
  workspace: string;
}

export interface ScanInput {
  roots: StorageRoot[];
  /** file path → fingerprint from the previous scan; matching files are skipped. */
  known: Record<string, string>;
  captureLevel: CaptureLevel;
  tombstones: Record<string, TombstoneKind>;
}

export interface ScanResult {
  file: string;
  fingerprint: string;
  session: NormalizedSession | null;
  captureLevel: CaptureLevel;
  skipped: 'empty' | 'deleted' | null;
}

export interface ScanStats {
  files: number;
  parsed: number;
  unchanged: number;
  empty: number;
  deleted: number;
  badLines: number;
  errors: { file: string; message: string }[];
}

export interface ScanOutput {
  results: ScanResult[];
  stats: ScanStats;
}

export function listChatSessionFiles(roots: readonly StorageRoot[]): SessionFile[] {
  const files: SessionFile[] = [];
  for (const root of roots) {
    if (root.kind === 'emptyWindow') {
      for (const name of sessionFileNames(root.dir))
        files.push({ file: join(root.dir, name), workspace: 'No workspace' });
      continue;
    }
    for (const entry of safeReaddir(root.dir)) {
      const workspaceDir = join(root.dir, entry);
      const names = sessionFileNames(join(workspaceDir, 'chatSessions'));
      if (names.length === 0) continue;
      const workspace = readWorkspaceLabel(workspaceDir);
      for (const name of names) files.push({ file: join(workspaceDir, 'chatSessions', name), workspace });
    }
  }
  return files;
}

/** Pure and synchronous: runs inside the scan worker in production. Never throws for a single bad file. */
export function scanChatSessions(input: ScanInput): ScanOutput {
  const stats: ScanStats = {
    files: 0,
    parsed: 0,
    unchanged: 0,
    empty: 0,
    deleted: 0,
    badLines: 0,
    errors: [],
  };
  const results: ScanResult[] = [];
  for (const { file, workspace } of listChatSessionFiles(input.roots)) {
    stats.files++;
    const fingerprint = fileFingerprint(file);
    if (fingerprint === null) continue;
    if (input.known[file] === fingerprint) {
      stats.unchanged++;
      continue;
    }
    try {
      const { state, badLines } = loadChatSessionState(file);
      stats.badLines += badLines;
      const session = normalizeChatSession(state, { file, workspace });
      if (session === null) {
        stats.empty++;
        results.push({
          file,
          fingerprint,
          session: null,
          captureLevel: input.captureLevel,
          skipped: 'empty',
        });
        continue;
      }
      const tombstone = input.tombstones[session.id];
      if (tombstone === 'deleted') {
        stats.deleted++;
        results.push({
          file,
          fingerprint,
          session: null,
          captureLevel: input.captureLevel,
          skipped: 'deleted',
        });
        continue;
      }
      const captureLevel: CaptureLevel = tombstone === 'content-cleared' ? 'metrics' : input.captureLevel;
      results.push({
        file,
        fingerprint,
        session: applyCaptureLevel(session, captureLevel),
        captureLevel,
        skipped: null,
      });
      stats.parsed++;
    } catch (error) {
      stats.errors.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { results, stats };
}

export function readWorkspaceLabel(workspaceDir: string): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(workspaceDir, 'workspace.json'), 'utf8'));
    if (isRecord(parsed)) {
      const uri =
        typeof parsed.folder === 'string'
          ? parsed.folder
          : typeof parsed.workspace === 'string'
            ? parsed.workspace
            : null;
      if (uri !== null) {
        const name = basename(decodeURIComponent(new URL(uri).pathname)).replace(/\.code-workspace$/i, '');
        if (name !== '') return name;
      }
    }
  } catch {
    // Missing or corrupt workspace.json: fall back to the storage folder name.
  }
  return `workspace:${basename(workspaceDir).slice(0, 8)}`;
}

function sessionFileNames(dir: string): string[] {
  return safeReaddir(dir)
    .filter((name) => SESSION_FILE.test(name))
    .sort();
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function fileFingerprint(file: string): string | null {
  try {
    const stat = statSync(file);
    return `${stat.size}:${Math.floor(stat.mtimeMs)}`;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm vitest run src/core/ingest` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(ingest): discover chat sessions across profiles and empty windows, scan incrementally"
```

---

## Task 1.7: Scan worker and multi-window writer lock

**Files:**

- Create: `src/core/ingest/scanWorker.ts`, `src/core/ingest/runScan.ts`, `src/core/ingest/runScan.test.ts`,
  `src/core/ingest/writerLock.ts`, `src/core/ingest/writerLock.test.ts`
- Modify: `esbuild.mjs` (add the worker entry)

**Interfaces:**

- Consumes: `scanChatSessions`, `ScanInput`, `ScanOutput` (1.6).
- Produces: `runScan(input: ScanInput, options?: { workerFile?: string; timeoutMs?: number }): Promise<ScanOutput>`
  (worker when `workerFile` is set, in-process otherwise); `class WriterLock { constructor(dir, options?:
{ staleMs?; pid?; now?; isAlive? }); tryAcquire(): boolean; release(): void }`; `isProcessAlive(pid): boolean`;
  bundle `dist/scanWorker.js`.

- [ ] **Step 1: Write the failing tests**

`src/core/ingest/runScan.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createFixtureUserDir } from '../../../test/fixtures/fixtures';
import { resolveStorageRoots } from './roots';
import { runScan } from './runScan';
import type { ScanInput } from './scanner';

function input(): ScanInput {
  const { userDir } = createFixtureUserDir();
  return {
    roots: resolveStorageRoots({ userDirs: [userDir] }),
    known: {},
    captureLevel: 'summaries',
    tombstones: {},
  };
}

describe('runScan', () => {
  it('produces the same result in a worker thread as in-process', async () => {
    const outdir = mkdtempSync(join(tmpdir(), 'ci-worker-'));
    await build({
      entryPoints: [fileURLToPath(new URL('./scanWorker.ts', import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: join(outdir, 'scanWorker.js'),
      logLevel: 'silent',
    });
    const scanInput = input();
    const inWorker = await runScan(scanInput, { workerFile: join(outdir, 'scanWorker.js') });
    const inProcess = await runScan(scanInput);
    expect(inWorker.stats).toEqual(inProcess.stats);
    expect(inWorker.results.map((result) => result.session?.id)).toEqual(
      inProcess.results.map((result) => result.session?.id),
    );
  });

  it('rejects when the worker cannot start', async () => {
    await expect(runScan(input(), { workerFile: '/nonexistent/scanWorker.js' })).rejects.toThrow();
  });
});
```

`src/core/ingest/writerLock.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isProcessAlive, WriterLock } from './writerLock';

const newDir = () => mkdtempSync(join(tmpdir(), 'ci-lock-'));

describe('WriterLock', () => {
  it('lets exactly one owner hold the lock and hands it over on release', () => {
    const dir = newDir();
    const a = new WriterLock(dir);
    const b = new WriterLock(dir);
    expect(a.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(false);
    expect(a.tryAcquire()).toBe(true);
    a.release();
    expect(b.tryAcquire()).toBe(true);
    expect(a.tryAcquire()).toBe(false);
  });

  it('takes over a lock whose heartbeat is stale', () => {
    const dir = newDir();
    let now = 0;
    const a = new WriterLock(dir, { now: () => now, staleMs: 1000 });
    const b = new WriterLock(dir, { now: () => now, staleMs: 1000 });
    expect(a.tryAcquire()).toBe(true);
    now = 2000;
    expect(b.tryAcquire()).toBe(true);
    expect(a.tryAcquire()).toBe(false);
  });

  it('takes over a lock whose owning process is gone', () => {
    const dir = newDir();
    expect(new WriterLock(dir, { pid: 999_999 }).tryAcquire()).toBe(true);
    expect(new WriterLock(dir, { isAlive: () => false }).tryAcquire()).toBe(true);
  });

  it('ignores a corrupt lock file', () => {
    const dir = newDir();
    writeFileSync(join(dir, 'scanner.lock'), 'garbage');
    expect(new WriterLock(dir).tryAcquire()).toBe(true);
  });

  it('detects live processes', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(-1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/core/ingest/runScan.test.ts src/core/ingest/writerLock.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`src/core/ingest/scanWorker.ts`:

```ts
import { parentPort, workerData } from 'node:worker_threads';
import { scanChatSessions, type ScanInput } from './scanner';

const port = parentPort;
if (port === null) throw new Error('scanWorker must run inside a worker thread');

try {
  port.postMessage({ ok: true, value: scanChatSessions(workerData as ScanInput) });
} catch (error) {
  port.postMessage({
    ok: false,
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
}
```

`src/core/ingest/runScan.ts`:

```ts
import { Worker } from 'node:worker_threads';
import { scanChatSessions, type ScanInput, type ScanOutput } from './scanner';

export interface RunScanOptions {
  /** Path to the bundled dist/scanWorker.js. When omitted the scan runs in-process (unit tests). */
  workerFile?: string;
  timeoutMs?: number;
}

type WorkerReply = { ok: true; value: ScanOutput } | { ok: false; error: string };

export function runScan(input: ScanInput, options: RunScanOptions = {}): Promise<ScanOutput> {
  const { workerFile, timeoutMs = 120_000 } = options;
  if (workerFile === undefined) {
    return new Promise((resolve) => {
      resolve(scanChatSessions(input));
    });
  }
  return new Promise<ScanOutput>((resolve, reject) => {
    const worker = new Worker(workerFile, { workerData: input });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`Session scan timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    worker.once('message', (reply: WorkerReply) => {
      clearTimeout(timer);
      void worker.terminate();
      if (reply.ok) resolve(reply.value);
      else reject(new Error(reply.error));
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Scan worker exited with code ${code}`));
    });
  });
}
```

`src/core/ingest/writerLock.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord } from '../json';

interface LockRecord {
  owner: string;
  pid: number;
  heartbeatAt: number;
}

export interface WriterLockOptions {
  /** A lock whose heartbeat is older than this is considered abandoned. Default 30 minutes. */
  staleMs?: number;
  pid?: number;
  now?: () => number;
  isAlive?: (pid: number) => boolean;
}

/**
 * Every VS Code window runs its own extension host. Only the window holding this lock scans and writes;
 * the others read the shared database. Calling tryAcquire() again while holding the lock refreshes the heartbeat.
 */
export class WriterLock {
  readonly file: string;
  private readonly owner = randomUUID();
  private readonly staleMs: number;
  private readonly pid: number;
  private readonly now: () => number;
  private readonly isAlive: (pid: number) => boolean;

  constructor(dir: string, options: WriterLockOptions = {}) {
    this.file = join(dir, 'scanner.lock');
    this.staleMs = options.staleMs ?? 30 * 60_000;
    this.pid = options.pid ?? process.pid;
    this.now = options.now ?? Date.now;
    this.isAlive = options.isAlive ?? isProcessAlive;
  }

  tryAcquire(): boolean {
    const current = this.read();
    if (current !== null && current.owner !== this.owner) {
      const abandoned = this.now() - current.heartbeatAt > this.staleMs || !this.isAlive(current.pid);
      if (!abandoned) return false;
    }
    this.write();
    return this.read()?.owner === this.owner;
  }

  release(): void {
    if (this.read()?.owner !== this.owner) return;
    try {
      unlinkSync(this.file);
    } catch {
      // Already removed.
    }
  }

  private read(): LockRecord | null {
    try {
      const value: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      return isRecord(value) &&
        typeof value.owner === 'string' &&
        typeof value.pid === 'number' &&
        typeof value.heartbeatAt === 'number'
        ? { owner: value.owner, pid: value.pid, heartbeatAt: value.heartbeatAt }
        : null;
    } catch {
      return null;
    }
  }

  private write(): void {
    const record: LockRecord = { owner: this.owner, pid: this.pid, heartbeatAt: this.now() };
    const temporary = `${this.file}.${this.owner}.tmp`;
    writeFileSync(temporary, JSON.stringify(record));
    renameSync(temporary, this.file);
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
```

In `esbuild.mjs`, change the first build entry to include the worker:

```js
const builds = [
  {
    ...node,
    entryPoints: { extension: 'src/extension/extension.ts', scanWorker: 'src/core/ingest/scanWorker.ts' },
    outdir: 'dist',
  },
];
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run src/core/ingest` — Expected: PASS.
Run: `pnpm build && ls dist` — Expected: `extension.js`, `scanWorker.js`, `webview/`.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(ingest): scan in a worker thread and elect a single writing window"
```

---

## Task 1.8: Ingest service

**Files:**

- Create: `src/core/ingest/ingestService.ts`, `src/core/ingest/ingestService.test.ts`

**Interfaces:**

- Consumes: `Database`, `SessionStore`, `IngestStateStore` (1.5), `StorageRoot`, `resolveStorageRoots` (1.6),
  `ScanInput`, `ScanOutput`, `ScanStats` (1.6), `runScan` (1.7), `CaptureLevel` (1.4), `localDay`,
  `retentionCutoff` (1.1).
- Produces: `INGEST_VERSION`, `META` (meta keys), `IngestDeps`, `SyncResult`
  (`{ role: 'leader'; purged: number } & ScanStats | { role: 'follower' }`),
  `class IngestService { sync(options?: { force?: boolean }): Promise<SyncResult>;
changeCaptureLevel(level): Promise<SyncResult>; lastResult: SyncResult | null; lastError: string | null }`.

- [ ] **Step 1: Write the failing test** — `src/core/ingest/ingestService.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { createFixtureUserDir } from '../../../test/fixtures/fixtures';
import type { CaptureLevel } from '../privacy/captureLevel';
import { Database } from '../storage/database';
import { IngestStateStore } from '../storage/ingestStateStore';
import { SessionStore } from '../storage/sessionStore';
import { IngestService, META } from './ingestService';
import { resolveStorageRoots } from './roots';
import { runScan } from './runScan';

function setup(options: { leader?: boolean; retentionDays?: number; now?: number } = {}) {
  const database = new Database(':memory:');
  const sessions = new SessionStore(database);
  const state = new IngestStateStore(database);
  const { userDir } = createFixtureUserDir();
  let changes = 0;
  let captureLevel: CaptureLevel = 'full';
  const service = new IngestService({
    database,
    sessions,
    state,
    lock: { tryAcquire: () => options.leader ?? true },
    resolveRoots: () => resolveStorageRoots({ userDirs: [userDir] }),
    runScan: (input) => runScan(input),
    captureLevel: () => captureLevel,
    retentionDays: () => options.retentionDays ?? 0,
    onChanged: () => {
      changes++;
    },
    log: { info: () => undefined, warn: () => undefined },
    now: () => options.now ?? 1_790_500_000_000,
  });
  return {
    service,
    sessions,
    state,
    changes: () => changes,
    setCaptureLevel: (level: CaptureLevel) => {
      captureLevel = level;
    },
  };
}

describe('IngestService', () => {
  it('indexes sessions on the first sync and notifies once', async () => {
    const { service, sessions, state, changes } = setup();
    expect(await service.sync()).toMatchObject({ role: 'leader', parsed: 2, empty: 1, purged: 0 });
    expect(sessions.counts()).toEqual({ sessions: 2, turns: 4 });
    expect(state.getMeta(META.lastSyncAt)).toBe('1790500000000');
    expect(changes()).toBe(1);
  });

  it('does nothing when files are unchanged', async () => {
    const { service, changes } = setup();
    await service.sync();
    expect(await service.sync()).toMatchObject({ role: 'leader', parsed: 0, unchanged: 3 });
    expect(changes()).toBe(1);
  });

  it('shares one in-flight sync between concurrent callers', async () => {
    const { service } = setup();
    const [first, second] = await Promise.all([service.sync(), service.sync()]);
    expect(first).toBe(second);
  });

  it('re-parses everything when forced or when the ingest version changes', async () => {
    const { service, state } = setup();
    await service.sync();
    expect(await service.sync({ force: true })).toMatchObject({ parsed: 2 });
    state.setMeta(META.ingestVersion, '0');
    expect(await service.sync()).toMatchObject({ parsed: 2 });
  });

  it('follows another window: no writes, refresh only when the shared index changes', async () => {
    const { service, state, sessions, changes } = setup({ leader: false });
    state.setMeta(META.lastChangeAt, '1');
    expect(await service.sync()).toEqual({ role: 'follower' });
    expect(changes()).toBe(1);
    await service.sync();
    expect(changes()).toBe(1);
    state.setMeta(META.lastChangeAt, '2');
    await service.sync();
    expect(changes()).toBe(2);
    expect(sessions.counts()).toEqual({ sessions: 0, turns: 0 });
  });

  it('applies retention after writing', async () => {
    const { service, sessions } = setup({ retentionDays: 1, now: Date.parse('2027-01-01T12:00:00Z') });
    expect(await service.sync()).toMatchObject({ parsed: 2, purged: 2 });
    expect(sessions.counts()).toEqual({ sessions: 0, turns: 0 });
  });

  it('never re-imports a deleted session', async () => {
    const { service, sessions, state } = setup();
    await service.sync();
    state.addTombstones(['fx-auto-1'], 'deleted', 1);
    sessions.deleteSessions(['fx-auto-1']);
    expect(await service.sync({ force: true })).toMatchObject({ deleted: 1, parsed: 1 });
    expect(sessions.getSession('fx-auto-1')).toBeNull();
  });

  it('scrubs stored content when the capture level is lowered', async () => {
    const { service, sessions, setCaptureLevel } = setup();
    await service.sync();
    expect(sessions.getSession('fx-auto-1')?.turns[0]?.userText).not.toBeNull();
    setCaptureLevel('metrics');
    await service.changeCaptureLevel('metrics');
    expect(sessions.getSession('fx-auto-1')?.turns[0]?.userText).toBeNull();
    expect(sessions.getSession('fx-auto-1')?.captureLevel).toBe('metrics');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/core/ingest/ingestService.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/core/ingest/ingestService.ts`**

```ts
import type { CaptureLevel } from '../privacy/captureLevel';
import type { Database } from '../storage/database';
import type { IngestStateStore } from '../storage/ingestStateStore';
import type { SessionStore } from '../storage/sessionStore';
import { localDay, retentionCutoff } from '../time';
import type { StorageRoot } from './roots';
import type { ScanInput, ScanOutput, ScanStats } from './scanner';

/** Bump when parsing or normalization changes so every source file is re-parsed on the next sync. */
export const INGEST_VERSION = 1;

export const META = {
  ingestVersion: 'ingest.version',
  lastSyncAt: 'ingest.lastSyncAt',
  lastChangeAt: 'ingest.lastChangeAt',
} as const;

export interface IngestDeps {
  database: Pick<Database, 'transaction'>;
  sessions: SessionStore;
  state: IngestStateStore;
  lock: { tryAcquire(): boolean };
  resolveRoots(): StorageRoot[];
  runScan(input: ScanInput): Promise<ScanOutput>;
  captureLevel(): CaptureLevel;
  retentionDays(): number;
  onChanged(): void;
  log: { info(message: string): void; warn(message: string): void };
  now?(): number;
}

export type SyncResult = ({ role: 'leader'; purged: number } & ScanStats) | { role: 'follower' };

export class IngestService {
  lastResult: SyncResult | null = null;
  lastError: string | null = null;
  private inFlight: Promise<SyncResult> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastSeenChange: string | null = null;

  constructor(private readonly deps: IngestDeps) {}

  /** Concurrent non-forced calls share one run; a forced call always runs after whatever is in flight. */
  sync(options: { force?: boolean } = {}): Promise<SyncResult> {
    const force = options.force ?? false;
    if (this.inFlight !== null && !force) return this.inFlight;
    const run = this.queue.then(() => this.run(force));
    const tracked = run.then(
      (result) => {
        this.lastResult = result;
        this.lastError = null;
        return result;
      },
      (error: unknown) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      },
    );
    this.inFlight = tracked;
    this.queue = tracked.catch(() => undefined);
    void tracked
      .finally(() => {
        if (this.inFlight === tracked) this.inFlight = null;
      })
      .catch(() => undefined);
    return tracked;
  }

  /** Scrubs already-stored content down to `level`, then re-parses sources at that level. */
  async changeCaptureLevel(level: CaptureLevel): Promise<SyncResult> {
    if (this.deps.lock.tryAcquire()) {
      this.deps.database.transaction(() => {
        this.deps.sessions.downgradeStoredContent(level);
      });
    }
    return this.sync({ force: true });
  }

  private async run(force: boolean): Promise<SyncResult> {
    const { sessions, state, log } = this.deps;
    if (!this.deps.lock.tryAcquire()) {
      const change = state.getMeta(META.lastChangeAt);
      if (change !== this.lastSeenChange) {
        this.lastSeenChange = change;
        this.deps.onChanged();
      }
      return { role: 'follower' };
    }
    const reparseAll = force || state.getMeta(META.ingestVersion) !== String(INGEST_VERSION);
    const output = await this.deps.runScan({
      roots: this.deps.resolveRoots(),
      known: reparseAll ? {} : state.getFingerprints(),
      captureLevel: this.deps.captureLevel(),
      tombstones: state.getTombstones(),
    });
    const now = this.deps.now?.() ?? Date.now();
    const cutoff = retentionCutoff(this.deps.retentionDays(), localDay(now));
    let written = 0;
    let purged = 0;
    this.deps.database.transaction(() => {
      for (const result of output.results) {
        if (result.session !== null) {
          sessions.replaceSession(result.session, result.captureLevel, now);
          written++;
        }
        state.setFingerprint(result.file, result.fingerprint, result.session?.id ?? null, now);
      }
      if (cutoff !== null) purged = sessions.purgeBefore(cutoff);
      state.setMeta(META.ingestVersion, String(INGEST_VERSION));
      state.setMeta(META.lastSyncAt, String(now));
      if (written > 0 || purged > 0) state.setMeta(META.lastChangeAt, String(now));
    });
    for (const error of output.stats.errors.slice(0, 5))
      log.warn(`Could not parse ${error.file}: ${error.message}`);
    if (written > 0 || purged > 0) {
      this.lastSeenChange = String(now);
      log.info(`Indexed ${written} session(s); purged ${purged} past retention.`);
      this.deps.onChanged();
    }
    return { role: 'leader', purged, ...output.stats };
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/core/ingest/ingestService.test.ts` — Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm verify
git add -A
git commit -m "feat(ingest): orchestrate leader/follower sync with retention and capture-level changes"
```

---

## Task 1.9: Extension wiring, index status, and settings

**Files:**

- Create: `src/core/ingest/indexStatus.ts`, `src/core/ingest/indexStatus.test.ts`, `src/extension/config.ts`,
  `src/extension/ingestController.ts`, `test/integration/ingest.test.ts`
- Modify: `src/shared/protocol.ts`, `src/extension/extension.ts`, `src/webview/App.tsx`,
  `src/webview/App.test.tsx`, `package.json`

**Interfaces:**

- Consumes: everything from Tasks 1.1–1.8; `RpcHandlers`, `DashboardPanel`, `SidebarProvider` (0.3).
- Produces: RPC method `getIndexStatus` returning `IndexStatus { sessions; turns; lastSyncAt: number | null;
role: 'leader' | 'follower' | 'idle'; lastError: string | null; captureLevel }`; commands
  `copilotInsights.refreshSessions` and `copilotInsights.rebuildIndex` (both return `SyncResult`); settings
  `copilotInsights.captureLevel`, `retentionDays`, `nativeRefreshSeconds`, `nativeStorageRoots`.

- [ ] **Step 1: Extend the protocol** — in `src/shared/protocol.ts`, add before `rpcSchemas`:

```ts
export const indexStatusSchema = z.object({
  sessions: z.number(),
  turns: z.number(),
  lastSyncAt: z.number().nullable(),
  role: z.enum(['leader', 'follower', 'idle']),
  lastError: z.string().nullable(),
  captureLevel: z.enum(['metrics', 'summaries', 'full']),
});
export type IndexStatus = z.infer<typeof indexStatusSchema>;
```

and add this entry to `rpcSchemas`:

```ts
  getIndexStatus: {
    params: z.object({}),
    result: indexStatusSchema,
  },
```

`RpcHandlers` requires a handler for every method, so update the shared handler map in
`src/extension/webviewHost/rpcHost.test.ts`:

```ts
// Every RPC method needs a handler here; add one when protocol.ts gains a method.
const handlers: RpcHandlers = {
  ping: () => ({ version: '1.2.3', now: 7 }),
  getIndexStatus: () => ({
    sessions: 0,
    turns: 0,
    lastSyncAt: null,
    role: 'idle',
    lastError: null,
    captureLevel: 'summaries',
  }),
};
```

- [ ] **Step 2: Write the failing index-status test** — `src/core/ingest/indexStatus.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { Database } from '../storage/database';
import { IngestStateStore } from '../storage/ingestStateStore';
import { SessionStore } from '../storage/sessionStore';
import { indexStatus } from './indexStatus';
import { META } from './ingestService';

describe('indexStatus', () => {
  it('reports counts, last sync and role', () => {
    const database = new Database(':memory:');
    const state = new IngestStateStore(database);
    const sessions = new SessionStore(database);
    expect(indexStatus({ lastResult: null, lastError: null }, sessions, state, 'summaries')).toEqual({
      sessions: 0,
      turns: 0,
      lastSyncAt: null,
      role: 'idle',
      lastError: null,
      captureLevel: 'summaries',
    });
    state.setMeta(META.lastSyncAt, '1790000000000');
    expect(
      indexStatus({ lastResult: { role: 'follower' }, lastError: 'boom' }, sessions, state, 'metrics'),
    ).toMatchObject({
      lastSyncAt: 1790000000000,
      role: 'follower',
      lastError: 'boom',
      captureLevel: 'metrics',
    });
  });
});
```

Run: `pnpm vitest run src/core/ingest/indexStatus.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/core/ingest/indexStatus.ts`**

```ts
import type { IndexStatus } from '../../shared/protocol';
import type { CaptureLevel } from '../privacy/captureLevel';
import type { IngestStateStore } from '../storage/ingestStateStore';
import type { SessionStore } from '../storage/sessionStore';
import { META, type IngestService } from './ingestService';

export function indexStatus(
  service: Pick<IngestService, 'lastResult' | 'lastError'>,
  sessions: SessionStore,
  state: IngestStateStore,
  captureLevel: CaptureLevel,
): IndexStatus {
  const lastSyncAt = Number(state.getMeta(META.lastSyncAt));
  return {
    ...sessions.counts(),
    lastSyncAt: Number.isFinite(lastSyncAt) && lastSyncAt > 0 ? lastSyncAt : null,
    role: service.lastResult?.role ?? 'idle',
    lastError: service.lastError,
    captureLevel,
  };
}
```

Run: `pnpm vitest run src/core/ingest/indexStatus.test.ts` — Expected: PASS.

- [ ] **Step 4: Contribute settings and commands** — in `package.json` → `contributes`

Add to `"commands"`:

```json
{
  "command": "copilotInsights.refreshSessions",
  "title": "Refresh Copilot Sessions",
  "category": "Copilot Insights",
  "icon": "$(refresh)"
},
{
  "command": "copilotInsights.rebuildIndex",
  "title": "Rebuild Session Index",
  "category": "Copilot Insights"
}
```

Add to `"menus" → "view/title"`:

```json
{
  "command": "copilotInsights.refreshSessions",
  "when": "view == copilotInsights.sidebar",
  "group": "navigation@2"
}
```

Add a `"configuration"` block:

```json
"configuration": {
  "title": "Copilot Insights",
  "properties": {
    "copilotInsights.captureLevel": {
      "type": "string",
      "enum": ["metrics", "summaries", "full"],
      "default": "summaries",
      "enumDescriptions": [
        "Store telemetry only: tokens, credits, models, timings, tools and file paths. No conversation text.",
        "Also store short, secret-redacted summaries of prompts and responses.",
        "Store complete prompts, responses and tool arguments locally, with secrets redacted."
      ],
      "markdownDescription": "How much conversation content Copilot Insights keeps in its local index. Lowering the level also scrubs content that is already stored."
    },
    "copilotInsights.retentionDays": {
      "type": "number",
      "enum": [0, 7, 30, 90, 365],
      "default": 30,
      "markdownDescription": "Days of session history to keep. `0` keeps everything."
    },
    "copilotInsights.nativeRefreshSeconds": {
      "type": "number",
      "minimum": 15,
      "maximum": 600,
      "default": 60,
      "markdownDescription": "How often to look for new or changed Copilot chat sessions. Sessions in the current workspace also refresh when their files change."
    },
    "copilotInsights.nativeStorageRoots": {
      "type": "array",
      "items": { "type": "string" },
      "default": [],
      "markdownDescription": "Extra `workspaceStorage` folders to scan, for example another VS Code build's `User/workspaceStorage`."
    }
  }
}
```

- [ ] **Step 5: Implement the extension glue**

`src/extension/config.ts`:

```ts
import * as vscode from 'vscode';
import { isCaptureLevel, type CaptureLevel } from '../core/privacy/captureLevel';

export const CONFIG_SECTION = 'copilotInsights';

export interface InsightsConfig {
  captureLevel: CaptureLevel;
  retentionDays: number;
  refreshSeconds: number;
  storageRoots: string[];
}

export function readConfig(): InsightsConfig {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const captureLevel = config.get<unknown>('captureLevel');
  const retentionDays = config.get<unknown>('retentionDays');
  const refreshSeconds = config.get<unknown>('nativeRefreshSeconds');
  const storageRoots = config.get<unknown>('nativeStorageRoots');
  return {
    captureLevel: isCaptureLevel(captureLevel) ? captureLevel : 'summaries',
    retentionDays: typeof retentionDays === 'number' && retentionDays >= 0 ? retentionDays : 30,
    refreshSeconds: typeof refreshSeconds === 'number' ? Math.min(600, Math.max(15, refreshSeconds)) : 60,
    storageRoots: Array.isArray(storageRoots)
      ? storageRoots.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      : [],
  };
}
```

`src/extension/ingestController.ts`:

```ts
import * as vscode from 'vscode';
import type { IngestService, SyncResult } from '../core/ingest/ingestService';
import { CONFIG_SECTION, readConfig } from './config';

/** Decides when to sync: on a timer, when this workspace's chat files change, and on relevant setting changes. */
export class IngestController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private interval: NodeJS.Timeout | undefined;
  private debounce: NodeJS.Timeout | undefined;

  constructor(
    private readonly service: IngestService,
    private readonly workspaceStorageUri: vscode.Uri | undefined,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  start(): void {
    this.scheduleInterval();
    this.watchCurrentWorkspaceSessions();
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        this.onConfigurationChanged(event);
      }),
    );
    this.syncSoon(1_500);
  }

  sync(force: boolean): Promise<SyncResult> {
    return this.service.sync({ force });
  }

  dispose(): void {
    clearInterval(this.interval);
    clearTimeout(this.debounce);
    for (const disposable of this.disposables) disposable.dispose();
  }

  private scheduleInterval(): void {
    clearInterval(this.interval);
    this.interval = setInterval(() => {
      this.syncSoon(0);
    }, readConfig().refreshSeconds * 1_000);
  }

  private syncSoon(delayMs = 2_000): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.service.sync().catch((error: unknown) => {
        this.log.error(`Session sync failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, delayMs);
  }

  private watchCurrentWorkspaceSessions(): void {
    if (this.workspaceStorageUri === undefined) return;
    // context.storageUri is <workspaceStorage>/<hash>/<extension id>; Copilot writes to <hash>/chatSessions.
    const chatSessions = vscode.Uri.joinPath(this.workspaceStorageUri, '..', 'chatSessions');
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(chatSessions, '*.jsonl'),
    );
    this.disposables.push(
      watcher,
      watcher.onDidChange(() => {
        this.syncSoon();
      }),
      watcher.onDidCreate(() => {
        this.syncSoon();
      }),
    );
  }

  private onConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
    if (!event.affectsConfiguration(CONFIG_SECTION)) return;
    if (event.affectsConfiguration(`${CONFIG_SECTION}.nativeRefreshSeconds`)) this.scheduleInterval();
    if (event.affectsConfiguration(`${CONFIG_SECTION}.captureLevel`)) {
      this.service.changeCaptureLevel(readConfig().captureLevel).catch((error: unknown) => {
        this.log.error(
          `Applying the capture level failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      return;
    }
    this.syncSoon();
  }
}
```

Replace `src/extension/extension.ts`:

```ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { indexStatus } from '../core/ingest/indexStatus';
import { IngestService } from '../core/ingest/ingestService';
import { resolveStorageRoots, userDirsFromGlobalStorage } from '../core/ingest/roots';
import { runScan } from '../core/ingest/runScan';
import { WriterLock } from '../core/ingest/writerLock';
import { Database } from '../core/storage/database';
import { IngestStateStore } from '../core/storage/ingestStateStore';
import { SessionStore } from '../core/storage/sessionStore';
import { readConfig } from './config';
import { IngestController } from './ingestController';
import { DashboardPanel } from './webviewHost/dashboardPanel';
import type { RpcHandlers } from './webviewHost/rpcHost';
import { SidebarProvider } from './webviewHost/sidebarProvider';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Copilot Insights', { log: true });
  context.subscriptions.push(log);
  const version = extensionVersion(context);
  const storageDir = context.globalStorageUri.fsPath;
  mkdirSync(storageDir, { recursive: true });

  const database = new Database(join(storageDir, 'insights.db'));
  const sessions = new SessionStore(database);
  const state = new IngestStateStore(database);
  const lock = new WriterLock(storageDir);
  const dataChanged = new vscode.EventEmitter<void>();

  const service = new IngestService({
    database,
    sessions,
    state,
    lock,
    resolveRoots: () =>
      resolveStorageRoots({
        userDirs: userDirsFromGlobalStorage(storageDir),
        extraWorkspaceStorageRoots: readConfig().storageRoots,
      }),
    runScan: (input) =>
      runScan(input, { workerFile: join(context.extensionUri.fsPath, 'dist', 'scanWorker.js') }),
    captureLevel: () => readConfig().captureLevel,
    retentionDays: () => readConfig().retentionDays,
    onChanged: () => {
      dataChanged.fire();
    },
    log: {
      info: (message) => {
        log.info(message);
      },
      warn: (message) => {
        log.warn(message);
      },
    },
  });
  const controller = new IngestController(service, context.storageUri, log);

  const handlers: RpcHandlers = {
    ping: () => ({ version, now: Date.now() }),
    getIndexStatus: () => indexStatus(service, sessions, state, readConfig().captureLevel),
  };
  const dashboard = new DashboardPanel(context.extensionUri, handlers, log);
  const sidebar = new SidebarProvider(context.extensionUri, handlers, log);

  context.subscriptions.push(
    dataChanged,
    dashboard,
    sidebar,
    dataChanged.event(() => {
      dashboard.notifyDataChanged();
      sidebar.notifyDataChanged();
    }),
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar),
    vscode.commands.registerCommand('copilotInsights.openDashboard', () => {
      dashboard.show();
    }),
    vscode.commands.registerCommand('copilotInsights.refreshSessions', () => controller.sync(false)),
    vscode.commands.registerCommand('copilotInsights.rebuildIndex', () => controller.sync(true)),
    // Stop background work before the database closes.
    {
      dispose: () => {
        controller.dispose();
        lock.release();
        database.close();
      },
    },
  );
  controller.start();
  log.info(`Copilot Insights ${version} activated (storage: ${storageDir})`);
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}

function extensionVersion(context: vscode.ExtensionContext): string {
  const manifest = context.extension.packageJSON as { version?: unknown };
  return typeof manifest.version === 'string' ? manifest.version : 'dev';
}
```

- [ ] **Step 6: Show index status in the webview (test first)**

Replace the `describe` block in `src/webview/App.test.tsx` (keep `fakeHost` and `renderApp`):

```tsx
describe('App', () => {
  it('shows how much has been indexed', async () => {
    renderApp(
      fakeHost({
        getIndexStatus: {
          sessions: 2,
          turns: 5,
          lastSyncAt: null,
          role: 'leader',
          lastError: null,
          captureLevel: 'summaries',
        },
      }),
    );
    const status = await screen.findByLabelText('Index status');
    expect(status).toHaveTextContent('2 sessions · 5 turns indexed');
    expect(status).toHaveTextContent('Capture level: summaries');
  });

  it('explains follower windows and scan errors', async () => {
    renderApp(
      fakeHost({
        getIndexStatus: {
          sessions: 0,
          turns: 0,
          lastSyncAt: 1790000000000,
          role: 'follower',
          lastError: 'disk full',
          captureLevel: 'metrics',
        },
      }),
    );
    expect(await screen.findByText(/Another VS Code window is indexing/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Last scan failed: disk full');
  });

  it('shows an error when the extension fails', async () => {
    renderApp(fakeHost({}));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});
```

Run: `pnpm vitest run src/webview/App.test.tsx` — Expected: FAIL.

Replace `src/webview/App.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import type { IndexStatus } from '../shared/protocol';
import { useRpc } from './rpcContext';

export function App({ view }: { view: 'dashboard' | 'sidebar' }) {
  const rpc = useRpc();
  const status = useQuery({ queryKey: ['indexStatus'], queryFn: () => rpc.call('getIndexStatus', {}) });
  return (
    <main className={`app app--${view}`}>
      <h1>Copilot Insights</h1>
      {status.isPending && <p className="muted">Loading…</p>}
      {status.isError && <p role="alert">Could not reach the extension: {status.error.message}</p>}
      {status.data && <IndexStatusSummary status={status.data} />}
    </main>
  );
}

function IndexStatusSummary({ status }: { status: IndexStatus }) {
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

Run: `pnpm vitest run src/webview` — Expected: PASS.

- [ ] **Step 7: Add the ingestion integration test** — `test/integration/ingest.test.ts`

```ts
import * as assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

// Bundled to out/integration/, so the repository root is two levels up.
const FIXTURES = join(__dirname, '..', '..', 'test', 'fixtures', 'chatSessions');

describe('native session ingestion', () => {
  it('indexes fixture sessions from a configured workspaceStorage root in the scan worker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ci-integration-'));
    const chatSessions = join(root, 'ws1', 'chatSessions');
    mkdirSync(chatSessions, { recursive: true });
    writeFileSync(join(root, 'ws1', 'workspace.json'), JSON.stringify({ folder: 'file:///repo/alpha' }));
    for (const name of ['auto-agent-session.jsonl', 'byok-failed-session.jsonl', 'empty-session.jsonl']) {
      copyFileSync(join(FIXTURES, name), join(chatSessions, name));
    }
    await vscode.workspace
      .getConfiguration('copilotInsights')
      .update('nativeStorageRoots', [root], vscode.ConfigurationTarget.Global);

    const result = await vscode.commands.executeCommand<{ role: string; parsed: number; empty: number }>(
      'copilotInsights.rebuildIndex',
    );

    assert.equal(result.role, 'leader');
    assert.equal(result.parsed, 2);
    assert.equal(result.empty, 1);
  });
});
```

- [ ] **Step 8: Verify**

Run: `pnpm format && pnpm verify` — Expected: PASS.
Run: `pnpm test:integration` — Expected: PASS on `stable` and `floor`.

Manual check (F5, in a window where you have used Copilot Chat): open the Copilot Insights sidebar. Within a
few seconds it shows a non-zero session and turn count. Send a Copilot Chat message in that window; the counts
update within about 2 seconds. Change `copilotInsights.captureLevel` to `metrics` and confirm the Output
channel logs no errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: wire ingestion into VS Code with settings, commands, file watching and index status"
```

---

## Task 1.10: Real-data smoke test and documentation

**Files:**

- Create: `scripts/smokeReal.ts`
- Modify: `esbuild.mjs`, `package.json`, `README.md`, `CHANGELOG.md`

**Interfaces:**

- Consumes: `defaultUserDir`, `resolveStorageRoots` (1.6), `listChatSessionFiles` (1.6),
  `loadChatSessionState` (1.2), `normalizeChatSession` (1.3), `isRecord` (1.2).
- Produces: `pnpm smoke:real` — exits 1 if any request fails to become a turn or no prompt text is recovered.

- [ ] **Step 1: Write the smoke script** — `scripts/smokeReal.ts`

```ts
// Parses this machine's real VS Code Copilot chat sessions and prints AGGREGATE COUNTS ONLY.
// It never prints prompts, responses, titles, tool arguments, or file paths.
// Usage: pnpm smoke:real [extra workspaceStorage dirs...]   (VSCODE_PRODUCT="Code - Insiders" for Insiders)
import { normalizeChatSession } from '../src/core/ingest/chatSession';
import { loadChatSessionState } from '../src/core/ingest/mutationLog';
import { defaultUserDir, resolveStorageRoots } from '../src/core/ingest/roots';
import { listChatSessionFiles } from '../src/core/ingest/scanner';
import { isRecord } from '../src/core/json';

const product = process.env.VSCODE_PRODUCT ?? 'Code';
const roots = resolveStorageRoots({
  userDirs: [defaultUserDir(product)],
  extraWorkspaceStorageRoots: process.argv.slice(2),
});

const totals = {
  roots: roots.length,
  files: 0,
  emptySessions: 0,
  sessions: 0,
  requests: 0,
  turns: 0,
  invalidRequests: 0,
  badLines: 0,
  turnsWithUserText: 0,
  turnsWithAssistantText: 0,
  systemInitiatedTurns: 0,
  promptTokens: 0,
  completionTokens: 0,
  creditTurns: 0,
  credits: 0,
  toolCalls: 0,
  fileEvents: 0,
  compactions: 0,
  readErrors: 0,
};
const byState: Record<string, number> = {};
const byHost: Record<string, number> = {};
const bySelection: Record<string, number> = {};
const byResolvedModelSource: Record<string, number> = {};
const unknownPartKinds: Record<string, number> = {};
const unknownRequestKeys: Record<string, number> = {};
const bump = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

for (const { file, workspace } of listChatSessionFiles(roots)) {
  totals.files++;
  try {
    const { state, badLines } = loadChatSessionState(file);
    totals.badLines += badLines;
    totals.requests += isRecord(state) && Array.isArray(state.requests) ? state.requests.length : 0;
    const session = normalizeChatSession(state, { file, workspace });
    if (session === null) {
      totals.emptySessions++;
      continue;
    }
    totals.sessions++;
    totals.invalidRequests += session.diagnostics.invalidRequests;
    for (const kind of session.diagnostics.unknownPartKinds) bump(unknownPartKinds, kind);
    for (const key of session.diagnostics.unknownRequestKeys) bump(unknownRequestKeys, key);
    for (const turn of session.turns) {
      totals.turns++;
      if (turn.userText !== null) totals.turnsWithUserText++;
      if (turn.assistantText !== null) totals.turnsWithAssistantText++;
      if (turn.systemInitiated) totals.systemInitiatedTurns++;
      totals.promptTokens += turn.promptTokens ?? 0;
      totals.completionTokens += turn.completionTokens ?? 0;
      if (turn.credits !== null) {
        totals.creditTurns++;
        totals.credits += turn.credits;
      }
      totals.toolCalls += turn.toolCalls.length;
      totals.fileEvents += turn.fileEvents.length;
      totals.compactions += turn.compactions.length;
      bump(byState, turn.state);
      bump(byHost, turn.modelHost);
      bump(bySelection, turn.selectionMode);
      bump(byResolvedModelSource, turn.resolvedModelSource);
    }
  } catch {
    totals.readErrors++;
  }
}

console.log(
  JSON.stringify(
    {
      totals: { ...totals, credits: Number(totals.credits.toFixed(4)) },
      byState,
      byHost,
      bySelection,
      byResolvedModelSource,
      unknownPartKinds,
      unknownRequestKeys,
    },
    null,
    2,
  ),
);

const accounted = totals.turns + totals.invalidRequests;
if (accounted !== totals.requests) {
  console.error(
    `FAIL: ${totals.requests} requests on disk, but ${accounted} turns + invalid requests parsed.`,
  );
  process.exitCode = 1;
} else if (totals.requests > 0 && totals.turnsWithUserText === 0) {
  console.error('FAIL: no user prompt text was recovered.');
  process.exitCode = 1;
} else {
  console.log(`OK: all ${totals.requests} requests became turns.`);
}
```

- [ ] **Step 2: Build it** — in `esbuild.mjs`, after the `if (integration) { … }` block add:

```js
if (process.argv.includes('--smoke')) {
  builds.push({ ...node, entryPoints: { smokeReal: 'scripts/smokeReal.ts' }, outdir: 'out' });
}
```

In `package.json` scripts add:

```json
"smoke:real": "node esbuild.mjs --smoke && node out/smokeReal.js",
```

- [ ] **Step 3: Run it on this machine**

Run: `pnpm smoke:real`
Expected — the plan's code was dry-run on the owner's machine on 2026-09-30 and produced the baseline below;
counts only grow as Copilot is used:

- `OK: all N requests became turns.` with N ≥ 312 (baseline: 483 files, 412 empty, 71 sessions, 312 turns,
  0 invalid requests, 0 bad lines)
- `turnsWithUserText` ≥ 308, `turnsWithAssistantText` ≥ 244, `systemInitiatedTurns` ≥ 14
- `promptTokens` ≥ 5,994,187, `completionTokens` ≥ 1,499,523, `creditTurns` ≥ 4, `credits` ≥ 12.2992
- `toolCalls` ≥ 7,198, `fileEvents` ≥ 3,083, `compactions` ≥ 146
- `byState` baseline `{ complete: 226, failed: 70, cancelled: 9, pending: 7 }`; `byHost` baseline
  `{ byok: 306, copilot: 5, unknown: 1 }`
- `unknownPartKinds` and `unknownRequestKeys` are empty. If they are not, add them to
  `docs/copilot-data-formats.md` and create a fixture that reproduces them before continuing.

If the script reports `FAIL`, stop and debug with superpowers:systematic-debugging. Do not change the
acceptance condition.

- [ ] **Step 4: Rewrite `README.md`**

````markdown
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
````

- [ ] **Step 5: Add a CHANGELOG entry** — insert under the `# Changelog` heading:

```markdown
## 0.3.0 — rewrite foundation

- Rewrote the extension in strict TypeScript with a React webview, esbuild/Vite builds, Vitest, ESLint, CI,
  and integration tests against VS Code stable and 1.105.0.
- Chat sessions are now parsed by replaying VS Code's real JSONL mutation log. The 0.2 parser recovered no
  turns from real sessions.
- Exact per-turn prompt/completion tokens, Copilot credits, Auto-routing resolution, context composition,
  compactions, reasoning time, tool calls, file events, failures, and system-initiated turns.
- Normalized SQLite storage (`insights.db`) with migrations; per-turn day bucketing.
- Privacy: default capture level `summaries`; secret redaction; `metrics` stores no text; lowering the level
  scrubs stored content; tombstones prevent re-importing deleted sessions.
- Scanning runs in a worker thread; only one VS Code window writes; `extensionKind: ui` for remote workspaces.
- The 0.2 dashboard, analysis, and GitHub usage sync are temporarily unavailable (Phase 2). The 0.2 database
  (`usage.sqlite3`) is left untouched.
```

- [ ] **Step 6: Final verification**

Run: `pnpm format && pnpm verify` — Expected: PASS.
Run: `pnpm test:integration` — Expected: PASS on both VS Code versions.
Run: `pnpm smoke:real` — Expected: `OK: …`.
Run: `pnpm package` — Expected: a `copilot-insights-0.3.0.vsix` is produced; `unzip -l` on it lists
`extension/dist/extension.js`, `extension/dist/scanWorker.js`, `extension/dist/webview/main.js`, and no
`src/`, `test/`, or `.map` files. Delete the `.vsix` afterwards (it is git-ignored).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: add real-data smoke test, rewrite README and changelog for 0.3.0"
```

---

## Phase exit criteria

Phase 1 is done when all of the following are true on `main`:

- `pnpm verify` and `pnpm test:integration` pass.
- `pnpm smoke:real` reports `OK` on the owner's machine.
- Opening the sidebar in a real VS Code window shows the indexed session and turn counts, and they update
  after a new Copilot Chat message.
- `docs/ROADMAP.md` records decision D3a (FTS5 availability).

Then write the Phase 2 plan (`docs/superpowers/plans/<date>-phase-2-parity-dashboard.md`) from the Phase 2
task table in `docs/ROADMAP.md`, using the interfaces this plan produced.
