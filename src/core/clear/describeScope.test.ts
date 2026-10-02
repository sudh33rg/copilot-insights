import { describe, expect, it } from 'vitest';
import { describeScope } from './describeScope';

describe('describeScope', () => {
  it('words a destructive delete and reassures that Copilot history is untouched', () => {
    const text = describeScope({ kind: 'session', id: 'x' }, 1);
    expect(text).toMatchObject({ destructive: true, confirmLabel: 'Delete session' });
    expect(text.title).toBe('Delete this session from TraceOn?');
    expect(text.detail).toContain("Copilot's own chat history is not touched");
  });

  it('words a content clear as non-deleting and pluralizes', () => {
    const text = describeScope({ kind: 'allContent' }, 3);
    expect(text).toMatchObject({ destructive: false, confirmLabel: 'Clear text' });
    expect(text.title).toBe('Clear conversation text from 3 sessions?');
    expect(text.detail).toContain('Tokens, credits, models and file paths are kept');
  });

  it('names the day and workspace', () => {
    expect(describeScope({ kind: 'beforeDay', day: '2026-08-01' }, 12).title).toBe(
      'Delete 12 sessions from before 2026-08-01?',
    );
    expect(describeScope({ kind: 'workspace', workspace: 'alpha' }, 1).title).toBe(
      'Delete 1 session from workspace "alpha"?',
    );
    expect(describeScope({ kind: 'everything' }, 5).title).toBe(
      'Delete all 5 sessions from TraceOn?',
    );
  });
});
