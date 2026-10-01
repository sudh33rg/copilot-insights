import type { SessionDetail } from '../../shared/dto';
import { formatDuration, formatInt } from '../ui/format';
import { Measure } from '../ui/Measure';
import { Button } from '../ui/Button';

export function SessionUsage({
  session,
  onTurn,
}: {
  session: SessionDetail;
  onTurn: (index: number) => void;
}) {
  const peak = Math.max(
    1,
    ...session.turns.map((t) => t.inputTokens.value ?? 0),
    ...session.turns.map((t) => t.outputTokens.value ?? 0),
  );
  return (
    <section className="card" aria-label="Usage by turn">
      <h3>Tokens & context over turns</h3>
      <p className="muted">
        Cached reads are part of input tokens; they are not added again. Input token counts measure requests,
        not the exact size of retained conversation context.
      </p>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Turn</th>
              <th>Input / output</th>
              <th>Cached input</th>
              <th>Duration</th>
              <th>Compactions</th>
              <th>Context before compaction</th>
            </tr>
          </thead>
          <tbody>
            {session.turns.map((turn) => (
              <tr key={turn.index}>
                <td>
                  <Button
                    onClick={() => {
                      onTurn(turn.index);
                    }}
                  >
                    Turn {turn.index}
                  </Button>
                  <small className="muted">{turn.model}</small>
                </td>
                <td>
                  <svg
                    viewBox="0 0 200 22"
                    className="token-bars"
                    role="img"
                    aria-label={`Turn ${turn.index} token usage`}
                  >
                    <rect
                      className="input-bar"
                      x="0"
                      y="0"
                      height="8"
                      width={((turn.inputTokens.value ?? 0) / peak) * 200}
                    />
                    <rect
                      className="output-bar"
                      x="0"
                      y="12"
                      height="8"
                      width={((turn.outputTokens.value ?? 0) / peak) * 200}
                    />
                  </svg>
                  <Measure measure={turn.inputTokens} format={(v) => formatInt(Number(v))} /> /{' '}
                  <Measure measure={turn.outputTokens} format={(v) => formatInt(Number(v))} />
                </td>
                <td>
                  <Measure measure={turn.cachedTokens} format={(v) => formatInt(Number(v))} />
                </td>
                <td>
                  <Measure measure={turn.elapsedMs} format={(v) => formatDuration(Number(v))} />
                </td>
                <td>
                  <Measure measure={turn.compactions} />
                </td>
                <td>
                  <Measure measure={turn.contextTokensBefore} format={(v) => formatInt(Number(v))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ModelCalls({ session, onTurn }: { session: SessionDetail; onTurn: (index: number) => void }) {
  const calls = session.modelCalls ?? [];
  const start = Math.min(...calls.map((call) => call.startedAt));
  const end = Math.max(...calls.map((call) => call.startedAt + Math.max(0, call.durationMs.value ?? 0)));
  const span = Math.max(1, end - start);
  return (
    <section className="card" aria-label="Model request timeline">
      <h3>Recorded model calls</h3>
      <p className="muted">
        Bars use debug-log start times and measured model-call durations. Tool timings are not recorded here.
        Internal and unmatched requests stay separate from turn totals.
      </p>
      {calls.length === 0 ? (
        <p className="empty-state">
          No recorded model spans. Turn-level durations cannot reconstruct individual calls.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Model / role</th>
                <th>Turn</th>
                <th>Relative timing</th>
                <th>Duration</th>
                <th>Input</th>
                <th>Output</th>
                <th>Cached</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => (
                <tr key={call.id}>
                  <td>
                    {call.model ?? 'Unknown model'}
                    <small className="muted">{call.role}</small>
                  </td>
                  <td>
                    {call.turnIndex === null ? (
                      'Unmatched'
                    ) : (
                      <Button
                        onClick={() => {
                          onTurn(call.turnIndex ?? 1);
                        }}
                      >
                        Turn {call.turnIndex}
                      </Button>
                    )}
                  </td>
                  <td>
                    <svg
                      viewBox="0 0 240 16"
                      className="token-bars"
                      role="img"
                      aria-label={`${call.id} starts ${formatDuration(call.startedAt - start)} after first call`}
                    >
                      <rect
                        className="input-bar"
                        x={((call.startedAt - start) / span) * 240}
                        y="2"
                        height="12"
                        width={
                          call.durationMs.value === null
                            ? 1
                            : Math.max(1, (call.durationMs.value / span) * 240)
                        }
                      />
                    </svg>
                    <small>
                      +{formatDuration(call.startedAt - start)}
                      {call.durationMs.value === null ? ' · end unavailable' : ''}
                    </small>
                  </td>
                  <td>
                    <Measure measure={call.durationMs} format={(v) => formatDuration(Number(v))} />
                  </td>
                  {[call.inputTokens, call.outputTokens, call.cachedTokens].map((value, i) => (
                    <td key={i}>
                      <Measure measure={value} format={(v) => formatInt(Number(v))} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
