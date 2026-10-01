import type { SessionDetail } from '../../shared/dto';
import { ProvenanceBadge } from '../ui/Badge';

export function ContextInspector({ session }: { session: SessionDetail }) {
  const files = new Map<string, { actions: Set<string>; turns: Set<number>; sources: Set<string> }>();
  for (const turn of session.turns)
    for (const file of turn.fileEvents) {
      const entry = files.get(file.path) ?? {
        actions: new Set<string>(),
        turns: new Set<number>(),
        sources: new Set<string>(),
      };
      entry.actions.add(file.source === 'context:attachment' ? 'attached' : file.action);
      entry.turns.add(turn.index);
      entry.sources.add(file.source ?? 'chatSessions');
      files.set(file.path, entry);
    }
  const snapshots = session.turns.flatMap((turn) =>
    (turn.contextItems ?? []).map((item) => ({ ...item, turn: turn.index })),
  );
  const artifacts = session.promptArtifacts ?? [];
  return (
    <section aria-label="Context inspector" className="context-inspector">
      <div className="section-heading">
        <div>
          <p className="eyebrow">What the session referenced</p>
          <h3>Context inventory</h3>
        </div>
        <span className="tag">
          {files.size} files · {snapshots.length + artifacts.length} captured items
        </span>
      </div>
      <p className="notice">
        File references establish recorded activity. A current file is not a historical snapshot. Context
        values below are retained from Copilot’s source; they do not establish the complete assembled prompt.
      </p>
      <h4>Files & activity</h4>
      {[...files].map(([path, entry]) => (
        <details key={path} className="disclosure">
          <summary>
            <code>{path}</code> <span className="tag">{[...entry.actions].join(' · ')}</span>
          </summary>
          <div className="disclosure-body">
            <p>Turns {[...entry.turns].join(', ')}</p>
            <p className="muted">Source: {[...entry.sources].join(', ')}</p>
            <p className="muted">
              Exact historical file contents are unavailable unless included in a recorded context value or
              tool result.
            </p>
          </div>
        </details>
      ))}
      {files.size === 0 && <p className="empty-state">No recorded file references.</p>}
      <h4>Recorded context values</h4>
      {snapshots.map((item, index) => (
        <details key={index} className="disclosure" open>
          <summary>
            {item.name}{' '}
            <span className="tag">
              Turn {item.turn} · {item.kind}
            </span>
          </summary>
          <div className="disclosure-body">
            <p className="muted">
              Source: {item.source} · {item.content.length.toLocaleString()} characters{' '}
              <ProvenanceBadge provenance={{ kind: 'exact', source: item.source }} />
            </p>
            <pre className="text code-text">{item.content}</pre>
          </div>
        </details>
      ))}
      {snapshots.length === 0 && (
        <p className="muted">
          No context payloads retained. The source may contain references only, use an unsupported format, or
          have been explicitly cleared.
        </p>
      )}
      <h4>Instructions & tool definitions</h4>
      <p className="muted">
        Debug artifacts represent the latest recorded file for the session. Their association with individual
        requests is unavailable.
      </p>
      {artifacts.map((item, index) => (
        <details key={index} className="disclosure">
          <summary>
            {item.name} <span className="tag">{item.kind}</span>
          </summary>
          <div className="disclosure-body">
            <p className="muted">{item.source}</p>
            <pre className="text code-text">{item.content}</pre>
          </div>
        </details>
      ))}
      {artifacts.length === 0 && (
        <p className="muted">
          No readable instruction or tool-definition artifacts retained. Sources may be absent, unsupported,
          larger than the parser’s file limit, or explicitly cleared.
        </p>
      )}
    </section>
  );
}
