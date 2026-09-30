# Copilot Insights — working rules

Copilot Insights is a local VS Code extension that observes native GitHub Copilot Chat sessions and explains
what happened, what it cost, and how to get better results next time. Product spec: `docs/PRODUCT_VISION.md`.
Roadmap: `docs/ROADMAP.md`. Executable plans: `docs/superpowers/plans/`.

## Git workflow (non-negotiable)

- Work **only on `main`**. Never create branches, worktrees, or pull requests.
- This overrides any skill, plan, or agent instruction that says otherwise (for example
  `superpowers:using-git-worktrees` or `superpowers:finishing-a-development-branch`): skip their branch/worktree
  steps and commit directly to `main`.
- Commit after every completed plan task with a Conventional Commit message (`feat:`, `fix:`, `test:`, `chore:`,
  `docs:`, `refactor:`). Keep commits small and self-contained; never commit a failing `pnpm verify`.
- Do not push to `origin` unless the user explicitly asks.
- Never rewrite published history (`git push --force`, `git rebase` of pushed commits, `git reset --hard` on
  pushed commits).

## Stack

- TypeScript `~6.0` in strict mode (typescript-eslint does not support TS 7 yet), pnpm, Node 22 APIs.
- Extension host: bundled with esbuild to `dist/extension.js` (CommonJS). Worker thread bundle: `dist/scanWorker.js`.
- Webview: React 19 + TanStack Query, bundled with Vite 8 to `dist/webview/main.{js,css}`.
- Validation of untrusted input (Copilot files, webview messages): zod 4.
- Storage: `node:sqlite` (`DatabaseSync`) with versioned migrations (`PRAGMA user_version`).
- Tests: Vitest 5 (unit, `node` + `jsdom` projects), `@vscode/test-cli` for integration tests in a real VS Code.
- Lint/format: ESLint 10 flat config with `typescript-eslint` strict type-checked rules, Prettier.

## Layering (enforced by ESLint `no-restricted-imports`)

| Folder | May import | Must not import |
|---|---|---|
| `src/shared/` | `zod`, other `shared` files | `vscode`, `node:*`, `react`, `core`, `extension`, `webview` |
| `src/core/` | `node:*`, `zod`, `shared`, other `core` files | `vscode`, `react`, `extension`, `webview` |
| `src/extension/` | `vscode`, `core`, `shared` | `webview`, `react` |
| `src/webview/` | `react`, browser APIs, `shared` | `vscode`, `node:*`, `core`, `extension` |

Business logic lives in `src/core` so it is unit-testable without VS Code. `src/extension` is thin glue.

## Commands

```bash
pnpm install          # install dependencies
pnpm verify           # typecheck + lint + format check + unit tests + build (must pass before every commit)
pnpm test             # unit tests only
pnpm test:integration # builds, then runs integration tests in VS Code (stable and the 1.105.0 floor)
pnpm smoke:real       # parses this machine's real Copilot data and prints aggregate counts only
```

## Product and privacy rules

- No network calls except the GitHub REST API, and only when the user syncs usage. No AI provider calls of any
  kind (no Claude, Codex, OpenAI, or other LLM APIs). No servers, daemons, CLIs, or external web apps.
- Never log, print, or commit prompt/response text, tool arguments, or file contents from real Copilot data.
  `pnpm smoke:real` prints aggregates only. Test fixtures are synthetic and follow
  `docs/copilot-data-formats.md`; never copy real session files into the repo.
- Every user-visible metric carries provenance: `exact`, `derived`, `inferred`, or `unavailable`
  (`src/shared/provenance.ts`). Never mix estimates into exact totals; partial sums are at most `derived`.
- Never divide GitHub daily/account credits across sessions. Per-session credits come only from Copilot's own
  per-request fields.
- Never delete or modify Copilot's own files or GitHub-side data. Clearing affects only this extension's index.
- Default capture level is `summaries`. `metrics` must store no conversation text, titles, or tool arguments.
- Secrets are redacted (`src/core/privacy/redact.ts`) before anything is stored.

## Engineering conventions

- TDD: write the failing test first, watch it fail, implement, watch it pass, commit.
- Tests live next to the code (`foo.ts` + `foo.test.ts`); integration tests in `test/integration/`; fixtures in
  `test/fixtures/`.
- Prefer small focused files with one responsibility. No minified or one-line-packed code.
- Parse untrusted JSON defensively: guard against prototype pollution, bad types, and truncated trailing lines.
- Never block the extension host thread with heavy parsing; use the scan worker.
- Webview: strict CSP with a per-load nonce, no inline scripts or `<style>` tags, no `dangerouslySetInnerHTML`.
  Render conversation text as plain text.
- When real Copilot formats change, update `docs/copilot-data-formats.md`, the fixtures, and the schema-drift
  diagnostics together.
