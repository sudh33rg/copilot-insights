import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Analysis, ClearScope, SessionDetail } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { ProvenanceBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { formatCredits, formatDateTime, formatDuration, formatInt } from '../ui/format';
import { Measure } from '../ui/Measure';
import { EfficiencyCard } from './EfficiencyCard';
import { OutcomeCard } from './OutcomeCard';
import { TurnTrace } from './TurnTrace';

export function SessionDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const rpc = useRpc();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['session', id], queryFn: () => rpc.call('getSession', { id }) });
  // The extension shows the confirmation dialog; `confirmed` is false when the user cancels.
  const run = async (scope: ClearScope): Promise<boolean> => {
    const result = await rpc.call('clearData', { scope });
    if (result.confirmed) await queryClient.invalidateQueries();
    return result.confirmed;
  };
  return (
    <section aria-label="Session">
      <div className="toolbar">
        <Button
          onClick={() => {
            onBack();
          }}
        >
          ← Sessions
        </Button>
        {query.data && (
          <>
            <Button
              onClick={() => {
                void run({ kind: 'sessionContent', id });
              }}
            >
              Clear conversation text
            </Button>
            <Button
              onClick={() => {
                void run({ kind: 'session', id }).then((deleted) => {
                  if (deleted) onBack();
                });
              }}
            >
              Delete session
            </Button>
          </>
        )}
      </div>
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && <p role="alert">Could not load the session: {query.error.message}</p>}
      {query.data === null && <p className="muted">This session is no longer in the index.</p>}
      {query.data && <Detail key={query.data.id} session={query.data} />}
    </section>
  );
}

function Detail({ session }: { session: SessionDetail }) {
  const [search, setSearch] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);
  const query = search.trim().toLowerCase();
  const turns = session.turns.filter(
    (turn) =>
      (!failedOnly || turn.state === 'failed') &&
      (query === '' ||
        [
          turn.userText,
          turn.assistantText,
          turn.model,
          turn.errorCode,
          ...turn.toolCalls.map((call) => call.name),
          ...turn.fileEvents.map((file) => file.path),
        ].some((value) => value?.toLowerCase().includes(query))),
  );
  const tools = session.turns.reduce((count, turn) => count + turn.toolCalls.length, 0);
  const files = new Set(session.turns.flatMap((turn) => turn.fileEvents.map((file) => file.path))).size;
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Session explorer · {session.workspace}</p>
        <h2>{session.title ?? 'Untitled session'}</h2>
        <p className="muted">
          {formatDateTime(session.startedAt)} · active {formatDuration(session.activeMs)} ·{' '}
          {session.turns.length} turns · {tools} tool calls · {files} files
        </p>
      </header>
      <dl className="metric-grid">
        <div>
          <dt>Input tokens</dt>
          <dd>
            <Measure measure={session.inputTokens} format={(value) => formatInt(Number(value))} />
          </dd>
        </div>
        <div>
          <dt>Output tokens</dt>
          <dd>
            <Measure measure={session.outputTokens} format={(value) => formatInt(Number(value))} />
          </dd>
        </div>
        <div>
          <dt>Credits</dt>
          <dd>
            <Measure measure={session.credits} format={(value) => formatCredits(Number(value))} />
          </dd>
        </div>
      </dl>
      <div className="notice">
        <strong>Full local capture</strong>
        <p>
          Complete stored prompts, responses and tool arguments are shown with secrets redacted. File
          references show recorded context and activity; file contents and tool outputs are not retained.
        </p>
      </div>
      {session.baseline !== null && (
        <p className="notice">
          {session.baseline.message} <ProvenanceBadge provenance={session.baseline.verdict.provenance} />
        </p>
      )}
      {session.debug === null && (
        <p className="notice muted">
          Agent debug logging is off for this session, so cached tokens, per-call latency and usage are not
          available. Run “Copilot Insights: Enable Exact Telemetry…” to turn it on for future sessions.
        </p>
      )}
      {session.debug !== null && (
        <p className="muted">
          Debug coverage: {session.debug.calls} model calls · {session.debug.internalCalls} internal ·{' '}
          {session.debug.unmatchedCalls} unmatched. Per-turn telemetry covers matched requests.
        </p>
      )}
      <div className="section-heading">
        <div>
          <p className="eyebrow">Execution trace</p>
          <h3>Timeline</h3>
        </div>
        <span className="muted">
          {turns.length} of {session.turns.length} turns
        </span>
      </div>
      <div className="toolbar" role="search">
        <input
          type="search"
          aria-label="Search turns"
          placeholder="Search prompts, responses, tools or file paths"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
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
          Failed turns only
        </label>
      </div>
      <div className="trace-layout">
        <nav className="trace-nav" aria-label="Turn navigation">
          {turns.map((turn) => (
            <a key={turn.index} href={`#turn-${String(turn.index)}`}>
              <span className={`trace-dot state--${turn.state}`} />
              Turn {turn.index}
              <small>{turn.toolCalls.length} tools</small>
            </a>
          ))}
        </nav>
        <div className="trace-content">
          {turns.map((turn) => (
            <TurnTrace key={turn.index} turn={turn} />
          ))}
          {turns.length === 0 && <p className="empty-state">No turns match these filters.</p>}
        </div>
      </div>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Session insights</p>
          <h3>Results & efficiency</h3>
        </div>
      </div>
      {session.analysis && <AnalysisCard analysis={session.analysis} />}
      <div className="insight-grid">
        <OutcomeCard outcomes={session.outcomes} />
        <EfficiencyCard efficiency={session.efficiency} />
      </div>
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
        <dt>Task type</dt>
        <dd>
          <Measure measure={analysis.taskType} />
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
