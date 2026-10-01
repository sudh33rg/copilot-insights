import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import type { Analysis, ClearScope, SessionDetail } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { ProvenanceBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { formatCredits, formatDateTime, formatDuration, formatInt } from '../ui/format';
import { Measure } from '../ui/Measure';
import { EfficiencyCard } from './EfficiencyCard';
import { OutcomeCard } from './OutcomeCard';
import { ContextInspector } from './ContextInspector';
import { EventInspector, type SelectedTool } from './EventInspector';
import { SessionNotes } from './SessionNotes';
import { ModelCalls, SessionUsage } from './SessionUsage';
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
      {query.data && <Detail key={`${query.data.id}-${query.data.captureLevel}`} session={query.data} />}
    </section>
  );
}

function Detail({ session }: { session: SessionDetail }) {
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'Conversation' | 'Events' | 'Context' | 'Usage' | 'Model calls' | 'Notes'>(
    'Conversation',
  );
  const [selected, setSelected] = useState<SelectedTool | null>(null);
  const goToTurn = (index: number) => {
    setMode('Conversation');
    requestAnimationFrame(() => document.getElementById(`turn-${index}`)?.scrollIntoView({ block: 'start' }));
  };
  const [failedOnly, setFailedOnly] = useState(false);
  const query = useDeferredValue(search.trim().toLowerCase());
  const turns = session.turns.filter(
    (turn) =>
      (!failedOnly || turn.state === 'failed') &&
      (query === '' ||
        [
          turn.userText,
          turn.assistantText,
          turn.model,
          turn.errorCode,
          ...turn.toolCalls.flatMap((call) => [call.name, call.args, call.output]),
          ...(turn.contextItems ?? []).flatMap((item) => [item.name, item.content]),
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
        <strong>{session.captureLevel === 'full' ? 'Full local capture' : 'Stored content coverage'}</strong>
        {session.captureLevel !== 'full' ? (
          <p>
            Conversation text is not stored in full for this session. Content clearing or legacy capture
            limits apply; available telemetry and file references remain.
          </p>
        ) : (
          <p>
            Complete stored prompts, responses and tool arguments are shown with secrets redacted. File
            references show recorded context and activity. Retained context values, tool results and debug
            artifacts are available in the inspector when recorded by Copilot.
          </p>
        )}
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
      <div className="view-switch" aria-label="Session views">
        {(['Conversation', 'Events', 'Context', 'Usage', 'Model calls', 'Notes'] as const).map((name) => (
          <Button
            key={name}
            variant={mode === name ? 'primary' : 'secondary'}
            aria-pressed={mode === name}
            onClick={() => {
              setMode(name);
            }}
          >
            {name}
          </Button>
        ))}
      </div>
      {mode === 'Context' && <ContextInspector session={session} />}
      {mode === 'Usage' && <SessionUsage session={session} onTurn={goToTurn} />}
      {mode === 'Model calls' && <ModelCalls session={session} onTurn={goToTurn} />}
      {mode === 'Notes' && <SessionNotes key={`${session.id}-${session.captureLevel}`} session={session} />}
      {(mode === 'Conversation' || mode === 'Events') && (
        <>
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
          <div className={`trace-layout ${selected === null ? '' : 'trace-layout--inspecting'}`}>
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
              {turns.map((turn) =>
                mode === 'Conversation' ? (
                  <TurnTrace
                    key={turn.index}
                    turn={turn}
                    onInspect={(position) => {
                      const call = turn.toolCalls[position];
                      if (call) setSelected({ turn, call, position });
                    }}
                  />
                ) : (
                  <section key={turn.index} className="card" aria-label={`Turn ${turn.index} events`}>
                    <h4>
                      Turn {turn.index} · {turn.model ?? 'Unknown model'}
                    </h4>
                    {turn.toolCalls.map((call, position) => (
                      <Button
                        key={position}
                        onClick={() => {
                          setSelected({ turn, call, position });
                        }}
                      >
                        {position + 1}. {call.name} →
                      </Button>
                    ))}
                    {turn.fileEvents.map((file, index) => (
                      <p key={index}>
                        <span className="tag">{file.action}</span> <code>{file.path}</code>
                      </p>
                    ))}
                    {turn.errorCode && (
                      <p className="error">
                        {turn.errorCode}: {turn.errorMessage}
                      </p>
                    )}
                    {turn.toolCalls.length === 0 && turn.fileEvents.length === 0 && (
                      <p className="muted">No tool or file events recorded.</p>
                    )}
                  </section>
                ),
              )}
              {turns.length === 0 && <p className="empty-state">No turns match these filters.</p>}
            </div>
            {selected !== null && (
              <EventInspector
                selected={selected}
                onClose={() => {
                  setSelected(null);
                }}
              />
            )}
          </div>
        </>
      )}
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
