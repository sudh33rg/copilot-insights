import { describe, expect, it } from 'vitest';
import { LiveNudge } from './liveNudge';

const NOW = 1_000_000_000;
const turn = (index: number, inputTokens: number | null, credits: number | null = null, compactions = 0) => ({
  index,
  inputTokens,
  credits,
  compactions,
});

function setup() {
  const calls: string[] = [];
  const state = {
    enabled: true,
    session: { endedAt: NOW - 1000, turns: [turn(1, 10_000, 0.5)] } as {
      endedAt: number;
      turns: ReturnType<typeof turn>[];
    } | null,
    throwing: false,
  };
  const nudge = new LiveNudge({
    enabled: () => state.enabled,
    active: () => {
      if (state.throwing) throw new Error('database closed');
      return state.session;
    },
    statusBar: {
      show: (text, tooltip) => calls.push(`show: ${text} | ${tooltip}`),
      hide: () => calls.push('hide'),
    },
    now: () => NOW,
  });
  return { nudge, calls, state };
}

describe('LiveNudge', () => {
  it('shows the active session’s context and credits, with a neutral tooltip when there is no hint', () => {
    const { nudge, calls } = setup();
    nudge.update();
    expect(calls).toEqual([
      'show: Copilot 10K ctx · 0.5 cr | Active Copilot session. Open the dashboard for details.',
    ]);
  });

  it('puts the hint in the tooltip when the context has grown a lot', () => {
    const { nudge, calls, state } = setup();
    state.session = { endedAt: NOW, turns: [turn(1, 10_000), turn(2, 40_000)] };
    nudge.update();
    expect(calls[0]).toBe(
      'show: Copilot 40K ctx | Context is 4× where this session started. A fresh session may cost less. Open the dashboard for details.',
    );
  });

  it('does not touch the status bar again while nothing changed, and updates when something did', () => {
    const { nudge, calls, state } = setup();
    nudge.update();
    nudge.update();
    expect(calls).toHaveLength(1);
    state.session = { endedAt: NOW, turns: [turn(1, 10_000, 0.5), turn(2, 12_000, 0.25)] };
    nudge.update();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('12K ctx · 0.75 cr');
  });

  it('never shows anything while the setting is off', () => {
    const { nudge, calls, state } = setup();
    state.enabled = false;
    nudge.update();
    nudge.update();
    expect(calls).toEqual([]);
  });

  it('hides once when the setting is turned off or the session stops being active', () => {
    const { nudge, calls, state } = setup();
    nudge.update();
    state.enabled = false;
    nudge.update();
    nudge.update();
    expect(calls.filter((call) => call === 'hide')).toHaveLength(1);
    state.enabled = true;
    nudge.update();
    state.session = { endedAt: NOW - 3_600_000, turns: [turn(1, 10_000)] };
    nudge.update();
    expect(calls.filter((call) => call === 'hide')).toHaveLength(2);
  });

  it('hides when there is no session or no known context, and shows again when one appears', () => {
    const { nudge, calls, state } = setup();
    state.session = null;
    nudge.update();
    expect(calls).toEqual([]);
    state.session = { endedAt: NOW, turns: [turn(1, null)] };
    nudge.update();
    expect(calls).toEqual([]);
    state.session = { endedAt: NOW, turns: [turn(1, 10_000)] };
    nudge.update();
    expect(calls).toHaveLength(1);
  });

  it('hides instead of throwing when the session cannot be read', () => {
    const { nudge, calls, state } = setup();
    nudge.update();
    state.throwing = true;
    expect(() => {
      nudge.update();
    }).not.toThrow();
    expect(calls.at(-1)).toBe('hide');
  });
});
