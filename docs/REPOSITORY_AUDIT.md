# Repository audit — 2026-10-01

Scope: ingestion and worker boundaries, SQLite persistence and queries, privacy and
clearing, analysis and learning, extension lifecycle and configuration, React views,
build/package configuration, tests, and project documentation.

## Fixed gaps

- Clearing all data omitted debug telemetry whose session was absent from the session
  index. Clearing now includes those IDs and records deletion tombstones.
- A scan already running could write back deleted sessions or cleared content. The
  ingest transaction rechecks tombstones and capture restrictions before writing.
- Cached learning facts could retain text-derived values after content clearing or
  miss database updates. Cache validity now includes connection changes and SQLite's
  external-change version.
- Structured credentials with arbitrary values and objects beyond the redaction
  recursion limit could survive redaction. Sensitive keys and depth-limit content
  are now redacted.
- Analytics day drill-downs silently stopped at 50 sessions. They now offer additional
  pages. Comparison and range-breakdown failures now have visible feedback.
- Narrow panels overflowed or crowded controls. Navigation and actions wrap, tables
  scroll inside focusable regions, controls use editor theme colors, and comparison
  row labels remain readable. Comparison requests run concurrently.
- README status lagged the implemented features.

Regression tests cover orphan cleanup, clearing during an in-flight scan, learning
cache invalidation, structured/deep redaction, day pagination, and comparison errors.

## Verification

- `pnpm verify`: type checks, lint, formatting, 825 unit/component tests, and builds.
- `pnpm test:integration`: extension-host checks on current stable VS Code and the
  declared 1.105 compatibility floor.
- `pnpm package`: production extension, worker, webview assets, and VSIX packaging.
- Visual checks in an isolated VS Code development profile using synthetic fixtures:
  empty and populated overview, session lists/details and timelines, analytics chart
  and breakdowns, a 52-session day with pagination, comparison, learning, diagnostics,
  sidebar, and narrow dashboard panels. No real conversation content was used.

## Limits and remaining product work

Visual inspection covers the principal views and representative states, rather than
all possible data, themes, operating systems, or transient errors. Authenticated live
GitHub billing sync and long-running real Copilot observation were not exercised.
The existing roadmap's encryption, excluded workspaces, anonymized exports, weekly
digest, and release/performance work remain separately scoped product tasks.
