import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Analysis, ClearScope, SessionDetail, TurnDetail } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { ProvenanceBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { formatCredits, formatDateTime, formatDuration, formatInt } from '../ui/format';
import { Measure } from '../ui/Measure';
import { EfficiencyCard } from './EfficiencyCard';
import { OutcomeCard } from './OutcomeCard';

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
      {session.debug === null && (
        <p className="muted">
          Agent debug logging is off for this session, so cached tokens, per-call latency and usage are not
          available. Run “Copilot Insights: Enable Exact Telemetry…” to turn it on for future sessions.
        </p>
      )}
      {session.analysis && <AnalysisCard analysis={session.analysis} />}
      <OutcomeCard outcomes={session.outcomes} />
      <EfficiencyCard efficiency={session.efficiency} />
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

function TurnCard({ turn }: { turn: TurnDetail }) {
  const rounds = turn.toolRounds.value ?? 0;
  const compactions = turn.compactions.value ?? 0;
  const extras = [
    turn.reasoningMs.value !== null ? `reasoning ${formatDuration(turn.reasoningMs.value)}` : null,
    rounds > 0 ? `${String(rounds)} tool round${rounds === 1 ? '' : 's'}` : null,
    compactions > 0 ? `${String(compactions)} compaction${compactions === 1 ? '' : 's'}` : null,
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
      {[turn.cachedTokens, turn.ttftMs, turn.nanoAiu].some((measure) => measure.value !== null) && (
        <dl className="facts facts--row" aria-label="Exact telemetry">
          <dt>Cached</dt>
          <dd>
            <Measure measure={turn.cachedTokens} format={(value) => formatInt(Number(value))} />
          </dd>
          <dt>First token</dt>
          <dd>
            <Measure measure={turn.ttftMs} format={(value) => formatDuration(Number(value))} />
          </dd>
          <dt>Usage (nano-AIU)</dt>
          <dd>
            <Measure measure={turn.nanoAiu} format={(value) => formatInt(Number(value))} />
          </dd>
        </dl>
      )}
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
