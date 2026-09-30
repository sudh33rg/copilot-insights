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
  `
  CREATE TABLE session_analysis (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    analyzer_version INTEGER NOT NULL,
    ingested_at INTEGER NOT NULL,
    json TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE github_daily_usage (
    day TEXT NOT NULL,
    account TEXT NOT NULL,
    credits REAL NOT NULL,
    synced_at INTEGER NOT NULL,
    PRIMARY KEY (day, account)
  );
  `,
  `
  CREATE TABLE llm_calls (
    session_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    response_id TEXT,
    started_at INTEGER NOT NULL,
    duration_ms INTEGER,
    model TEXT,
    debug_name TEXT,
    role TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cached_tokens INTEGER,
    ttft_ms INTEGER,
    nano_aiu INTEGER,
    PRIMARY KEY (session_id, span_id)
  );
  CREATE INDEX idx_llm_calls_response ON llm_calls(response_id);
  CREATE INDEX idx_llm_calls_started ON llm_calls(started_at);

  CREATE TABLE debug_sessions (
    session_id TEXT PRIMARY KEY,
    copilot_version TEXT,
    vscode_version TEXT,
    file TEXT NOT NULL,
    calls INTEGER NOT NULL,
    bad_lines INTEGER NOT NULL DEFAULT 0,
    ingested_at INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE models (
    id TEXT PRIMARY KEY,
    name TEXT,
    vendor TEXT,
    family TEXT,
    picker_category TEXT,
    price_category TEXT,
    max_context_tokens INTEGER,
    max_output_tokens INTEGER,
    input_price REAL,
    output_price REAL,
    cache_read_price REAL,
    price_batch_size INTEGER,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  `,
  `
  ALTER TABLE tool_calls ADD COLUMN command_hash TEXT;
  ALTER TABLE session_analysis ADD COLUMN observed_at INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE edit_fingerprints (
    session_id TEXT NOT NULL,
    turn_idx INTEGER NOT NULL,
    path TEXT NOT NULL,
    hashes TEXT NOT NULL,
    PRIMARY KEY (session_id, turn_idx, path),
    FOREIGN KEY (session_id, turn_idx) REFERENCES turns(session_id, idx) ON DELETE CASCADE
  );

  -- Live observations. No foreign key to sessions: a rescan deletes and re-inserts the session row.
  CREATE TABLE git_snapshots (
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('start', 'latest')),
    repo_root TEXT NOT NULL,
    head TEXT,
    taken_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, kind, repo_root)
  );
  CREATE TABLE git_snapshot_files (
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    added INTEGER NOT NULL,
    removed INTEGER NOT NULL,
    PRIMARY KEY (session_id, kind, path)
  );
  CREATE TABLE diag_snapshots (
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('start', 'latest')),
    path TEXT NOT NULL,
    errors INTEGER NOT NULL,
    warnings INTEGER NOT NULL,
    PRIMARY KEY (session_id, kind, path)
  );
  CREATE TABLE terminal_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at INTEGER,
    ended_at INTEGER NOT NULL,
    exit_code INTEGER,
    kind TEXT NOT NULL,
    command_hash TEXT NOT NULL
  );
  CREATE INDEX idx_terminal_runs_ended ON terminal_runs(ended_at);
  CREATE TABLE survival_checks (
    session_id TEXT NOT NULL,
    turn_idx INTEGER NOT NULL,
    path TEXT NOT NULL,
    check_kind TEXT NOT NULL CHECK (check_kind IN ('1h', '1d', 'commit')),
    checked_at INTEGER NOT NULL,
    present INTEGER NOT NULL,
    total INTEGER NOT NULL,
    PRIMARY KEY (session_id, turn_idx, path, check_kind)
  );
  CREATE TABLE session_commits (
    session_id TEXT NOT NULL,
    hash TEXT NOT NULL,
    committed_at INTEGER NOT NULL,
    overlap_files INTEGER NOT NULL,
    edited_files INTEGER NOT NULL,
    linked_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, hash)
  );
  CREATE INDEX idx_session_commits_hash ON session_commits(hash);
  `,
  `
  -- Snapshots omit files with no problems, so "taken but empty" needs its own marker.
  CREATE TABLE diag_snapshot_meta (
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('start', 'latest')),
    taken_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, kind)
  );
  `,
];
