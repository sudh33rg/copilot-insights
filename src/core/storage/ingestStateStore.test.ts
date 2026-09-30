import { describe, expect, it } from 'vitest';
import { Database } from './database';
import { IngestStateStore } from './ingestStateStore';

const newState = () => new IngestStateStore(new Database(':memory:'));

describe('IngestStateStore', () => {
  it('tracks file fingerprints', () => {
    const state = newState();
    state.setFingerprint('/a.jsonl', '10:1', 's1', 1);
    state.setFingerprint('/a.jsonl', '20:2', 's1', 2);
    state.setFingerprint('/b.jsonl', '5:5', null, 2);
    expect(state.getFingerprints()).toEqual({ '/a.jsonl': '20:2', '/b.jsonl': '5:5' });
  });

  it('keeps deleted tombstones from being downgraded to content-cleared', () => {
    const state = newState();
    state.addTombstones(['a', 'b'], 'content-cleared', 1);
    state.addTombstones(['a'], 'deleted', 2);
    state.addTombstones(['a', 'b'], 'content-cleared', 3);
    expect(state.getTombstones()).toEqual({ a: 'deleted', b: 'content-cleared' });
  });

  it('stores meta values', () => {
    const state = newState();
    expect(state.getMeta('x')).toBeNull();
    state.setMeta('x', '1');
    state.setMeta('x', '2');
    expect(state.getMeta('x')).toBe('2');
  });
});
