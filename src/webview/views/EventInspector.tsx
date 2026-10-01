import type { TurnDetail } from '../../shared/dto';
import { ProvenanceBadge } from '../ui/Badge';
import { Button } from '../ui/Button';

export interface SelectedTool {
  turn: TurnDetail;
  call: TurnDetail['toolCalls'][number];
  position: number;
}
export function EventInspector({ selected, onClose }: { selected: SelectedTool; onClose: () => void }) {
  const { turn, call, position } = selected;
  return (
    <aside className="event-inspector card" aria-label="Event inspector">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            Turn {turn.index} · action {position + 1}
          </p>
          <h3>{call.name}</h3>
        </div>
        <Button onClick={onClose} aria-label="Close inspector">
          ×
        </Button>
      </div>
      <span className="tag">{call.status === 'unknown' ? 'Status not recorded' : call.status}</span>
      <p className="muted">
        Source: {call.origin ?? 'Not recorded'}{' '}
        <ProvenanceBadge provenance={{ kind: 'exact', source: call.origin ?? 'chatSessions tool call' }} />
      </p>
      {call.callId != null && (
        <p className="muted">
          Call ID: <code>{call.callId}</code>
        </p>
      )}
      <h4>Arguments</h4>
      {call.args == null ? (
        <p className="muted">Arguments absent from the source or explicitly cleared.</p>
      ) : (
        <pre className="text code-text">{call.args}</pre>
      )}
      <h4>Result</h4>
      {call.output == null ? (
        <p className="muted">
          No joined result retained. The source may omit it, use an unsupported format, or have been
          explicitly cleared.
        </p>
      ) : (
        <pre className="text code-text">{call.output}</pre>
      )}
      <h4>Files in this turn</h4>
      <p className="muted">
        These references belong to the turn; association with this specific call is not established.
      </p>
      <ul className="files">
        {turn.fileEvents.map((file, index) => (
          <li key={index}>
            <span className="tag">{file.source === 'context:attachment' ? 'attached' : file.action}</span>
            <code>{file.path}</code>
          </li>
        ))}
      </ul>
    </aside>
  );
}
