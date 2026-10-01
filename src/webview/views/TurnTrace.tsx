import type { TurnDetail } from '../../shared/dto';
import { Button } from '../ui/Button';
import { ProvenanceBadge } from '../ui/Badge';
import { formatCredits, formatDateTime, formatDuration, formatInt, formatPercent } from '../ui/format';
import { Measure } from '../ui/Measure';

const STATE_LABEL = {
  complete: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
  pending: 'In progress',
  unknown: 'Unknown',
} as const;
const HOST_LABEL = { copilot: 'Copilot', byok: 'BYOK / local', unknown: 'Unknown host' } as const;
const int = (value: number | string) => formatInt(Number(value));

export function TurnTrace({ turn, onInspect }: { turn: TurnDetail; onInspect?: (position: number) => void }) {
  const extras = [
    turn.reasoningMs.value !== null ? `reasoning ${formatDuration(turn.reasoningMs.value)}` : null,
    turn.toolRounds.value !== null
      ? `${String(turn.toolRounds.value)} tool round${turn.toolRounds.value === 1 ? '' : 's'}`
      : null,
    (turn.compactions.value ?? 0) > 0
      ? `${String(turn.compactions.value)} compaction${turn.compactions.value === 1 ? '' : 's'}`
      : null,
  ].filter((value): value is string => value !== null);
  return (
    <article id={`turn-${String(turn.index)}`} className="turn" aria-label={`Turn ${String(turn.index)}`}>
      <header className="turn-header">
        <div>
          <p className="eyebrow">Request {String(turn.index).padStart(2, '0')}</p>
          <h4>Turn {turn.index}</h4>
        </div>
        <span className={`state state--${turn.state}`}>{STATE_LABEL[turn.state]}</span>
        {turn.systemInitiated && <span className="tag">System-initiated</span>}
      </header>
      <p className="muted turn-meta">
        <span>{turn.routing.label}</span> · {HOST_LABEL[turn.host]}
        {turn.mode !== null && ` · ${turn.mode}`}
        {turn.startedAt !== null && ` · ${formatDateTime(turn.startedAt)}`}
      </p>
      <div className="conversation">
        <TextPanel label="Prompt" text={turn.userText} />
        <TextPanel label="Response" text={turn.assistantText} />
      </div>
      <div className="turn-evidence">
        <section aria-label="Token usage">
          <h4>Usage & timing</h4>
          <dl className="facts">
            <dt>Input</dt>
            <dd>
              <Measure measure={turn.inputTokens} format={int} />
            </dd>
            <dt>Output</dt>
            <dd>
              <Measure measure={turn.outputTokens} format={int} />
            </dd>
            <dt>Credits</dt>
            <dd>
              <Measure measure={turn.credits} format={(value) => formatCredits(Number(value))} />
            </dd>
            <dt>Duration</dt>
            <dd>
              <Measure measure={turn.elapsedMs} format={(value) => formatDuration(Number(value))} />
            </dd>
          </dl>
          {[turn.cachedTokens, turn.ttftMs, turn.nanoAiu].some((measure) => measure.value !== null) && (
            <dl className="facts" aria-label="Exact telemetry">
              <dt>Cached</dt>
              <dd>
                <Measure measure={turn.cachedTokens} format={int} />
              </dd>
              <dt>First token</dt>
              <dd>
                <Measure measure={turn.ttftMs} format={(value) => formatDuration(Number(value))} />
              </dd>
              <dt>Usage (nano-AIU)</dt>
              <dd>
                <Measure measure={turn.nanoAiu} format={int} />
              </dd>
            </dl>
          )}
          <p className="muted">{extras.join(' · ')}</p>
          <dl className="facts">
            <dt>Tool-input retries</dt>
            <dd>
              <Measure measure={turn.toolInputRetries} />
            </dd>
            {turn.contextTokensBefore.value !== null && (
              <>
                <dt>Context before compaction</dt>
                <dd>
                  <Measure measure={turn.contextTokensBefore} format={int} />
                </dd>
              </>
            )}
          </dl>
        </section>
        <section aria-label="Prompt composition">
          <h4>What filled the prompt</h4>
          {turn.promptComposition.length === 0 ? (
            <p className="muted">Copilot did not record a context breakdown for this turn.</p>
          ) : (
            <ul className="composition">
              {turn.promptComposition.map((entry, index) => (
                <li key={`${entry.category}-${String(index)}`}>
                  <div>
                    <span>{entry.label || entry.category}</span>
                    <Measure measure={entry.share} format={(value) => formatPercent(Number(value))} />
                  </div>
                  <meter
                    min={0}
                    max={1}
                    value={entry.share.value ?? 0}
                    aria-label={entry.label || entry.category}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className="trace-section" aria-label="Tool execution">
        <div className="section-heading">
          <h4>Tool calls</h4>
          <span className="muted">{turn.toolCalls.length} recorded</span>
        </div>
        {turn.toolCalls.length === 0 ? (
          <p className="muted">No tool calls recorded for this turn.</p>
        ) : (
          <ol className="tool-list" aria-label="Tool calls">
            {turn.toolCalls.map((call, index) => (
              <li key={`${call.name}-${String(index)}`}>
                {onInspect && (
                  <Button
                    className="inspect-action"
                    aria-label={`Inspect ${call.name} in turn ${turn.index}`}
                    onClick={() => {
                      onInspect(index);
                    }}
                  >
                    Inspect →
                  </Button>
                )}
                <details className="disclosure">
                  <summary>
                    <span className="sequence">{String(index + 1).padStart(2, '0')}</span>
                    <code>{call.name}</code>
                    <span className="muted tool-status">
                      {call.status === 'unknown' ? 'Status not recorded' : call.status}
                    </span>
                  </summary>
                  <div className="disclosure-body">
                    <p className="muted">
                      Source:{' '}
                      {call.origin === 'toolCallRound'
                        ? 'Copilot tool-call round'
                        : call.origin === 'invocation'
                          ? 'Copilot UI invocation'
                          : 'Not recorded'}
                    </p>
                    <p className="label">Arguments</p>
                    {call.args == null ? (
                      <p className="muted">Arguments were not recorded for this call.</p>
                    ) : (
                      <pre className="text code-text">{call.args}</pre>
                    )}
                    <p className="label">Result</p>
                    {call.output == null ? (
                      <p className="muted">
                        Result was not recorded, could not be joined, or was explicitly cleared.
                      </p>
                    ) : (
                      <pre className="text code-text">{call.output}</pre>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="trace-section" aria-label="Context and files">
        <h4>Context & file activity</h4>
        {turn.fileEvents.length === 0 ? (
          <p className="muted">No file references recorded. This does not mean the request had no context.</p>
        ) : (
          <ul className="files" aria-label="File activity">
            {turn.fileEvents.map((event, index) => (
              <li key={`${event.path}-${String(index)}`}>
                <span className="file-action">
                  {event.source === 'context:attachment' ? 'attached' : event.action}
                </span>
                <code>{event.path}</code>
                {event.source !== undefined && <span className="file-source muted">{event.source}</span>}
                <ProvenanceBadge
                  provenance={{ kind: 'exact', source: event.source ?? 'chatSessions file event' }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      {(turn.errorCode !== null || turn.errorMessage !== null) && (
        <p className="error notice">
          Error {turn.errorCode ?? ''} {turn.errorMessage ?? ''}
        </p>
      )}
    </article>
  );
}

function TextPanel({ label, text }: { label: string; text: string | null }) {
  return (
    <section className={`text-panel text-panel--${label.toLowerCase()}`} aria-label={label}>
      <p className="label">{label}</p>
      {text === null ? (
        <p className="muted">No recorded text. It may have been cleared or absent from the source.</p>
      ) : (
        <pre className="text">{text}</pre>
      )}
    </section>
  );
}
