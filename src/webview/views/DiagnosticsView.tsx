import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Diagnostics } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { Button } from '../ui/Button';
import { formatDateTime, formatInt } from '../ui/format';

export function DiagnosticsView() {
  const rpc = useRpc();
  const query = useQuery({ queryKey: ['diagnostics'], queryFn: () => rpc.call('getDiagnostics', {}) });
  return (
    <section aria-label="Diagnostics">
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && <p role="alert">Could not load diagnostics: {query.error.message}</p>}
      {query.data && <Body data={query.data} />}
    </section>
  );
}

function Body({ data }: { data: Diagnostics }) {
  const rpc = useRpc();
  const queryClient = useQueryClient();
  const enable = useMutation({
    mutationFn: () => rpc.call('enableDebugLogging', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['diagnostics'] }),
  });
  const { drift, index, debugLog, catalog, scan, versions } = data;
  const hasDrift =
    drift.unknownPartKinds.length > 0 || drift.unknownRequestKeys.length > 0 || index.invalidRequests > 0;
  return (
    <>
      <section className="card" aria-label="Environment">
        <h3>Environment</h3>
        <dl className="facts">
          <dt>VS Code</dt>
          <dd>{versions.vscode}</dd>
          <dt>Copilot Chat</dt>
          <dd>{versions.copilotChat ?? 'not found'}</dd>
          <dt>TraceOn</dt>
          <dd>{versions.extension}</dd>
        </dl>
        <p>Agent debug logging: {data.debugLogging ? 'on' : 'off'}</p>
        {!data.debugLogging && (
          <>
            <p className="muted">
              Turning it on adds cached tokens, per-request latency and Copilot’s own usage figures for new
              sessions. Copilot writes prompts to those log files on this machine. Supported system
              instructions and tool definitions are retained locally with secrets redacted.
            </p>
            <Button
              onClick={() => {
                enable.mutate();
              }}
              disabled={enable.isPending}
            >
              Enable exact telemetry…
            </Button>
          </>
        )}
        {enable.data?.outcome === 'enabled' && (
          <p role="status">Enabled. It applies to new Copilot chat sessions.</p>
        )}
        {enable.data?.outcome === 'declined' && <p role="status">Left off.</p>}
      </section>
      <section className="card" aria-label="Index">
        <h3>Index</h3>
        <p>
          {formatInt(index.sessions)} sessions · {formatInt(index.turns)} turns
        </p>
      </section>
      <section className="card" aria-label="Scan">
        <h3>Scan</h3>
        <p>
          Role: {scan.role}
          {scan.lastSyncAt !== null && ` · last scan ${formatDateTime(scan.lastSyncAt)}`}
        </p>
        <p className="muted">
          {formatInt(scan.parseErrors)} files failed to parse · {formatInt(scan.badLines)} unreadable lines
          skipped
        </p>
        {scan.lastError !== null && <p role="alert">Last scan failed: {scan.lastError}</p>}
      </section>
      <section className="card" aria-label="Schema drift">
        <h3>Schema drift</h3>
        {!hasDrift ? (
          <p className="muted">No unknown fields: Copilot’s files match what this version parses.</p>
        ) : (
          <>
            <p className="muted">
              Copilot wrote fields this version does not understand. Details belong in
              docs/copilot-data-formats.md.
            </p>
            {drift.unknownPartKinds.length > 0 && (
              <p>
                Unknown response part kinds:{' '}
                {drift.unknownPartKinds.map((kind) => (
                  <code key={kind}>{kind} </code>
                ))}
              </p>
            )}
            {drift.unknownRequestKeys.length > 0 && (
              <p>
                Unknown request keys:{' '}
                {drift.unknownRequestKeys.map((key) => (
                  <code key={key}>{key} </code>
                ))}
              </p>
            )}
            {index.invalidRequests > 0 && (
              <p>{formatInt(index.invalidRequests)} invalid requests were skipped.</p>
            )}
          </>
        )}
      </section>
      <section className="card" aria-label="Debug logs and catalog">
        <h3>Debug logs and catalog</h3>
        <p>
          {formatInt(debugLog.sessionsWithLogs)} sessions with debug logs · {formatInt(debugLog.llmCalls)}{' '}
          logged requests · {formatInt(catalog.models)} models in the catalog
          {catalog.lastSeenAt !== null && ` (last seen ${formatDateTime(catalog.lastSeenAt)})`}
        </p>
        {debugLog.copilotVersionsSeen.length > 0 && (
          <p className="muted">Copilot Chat versions in logs: {debugLog.copilotVersionsSeen.join(', ')}</p>
        )}
        {debugLog.unknownDebugNames.length > 0 && (
          <>
            <p className="muted">Requests with a debugName this version does not classify yet:</p>
            <ul className="chips">
              {debugLog.unknownDebugNames.map((entry) => (
                <li key={entry.name}>
                  {entry.name} × {formatInt(entry.count)}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
