import { liveStatus, statusText } from '../core/live/nudge';

export interface LiveNudgeDeps {
  enabled(): boolean;
  /** The most recently active session, or null. May throw when the database is unavailable. */
  active(): {
    endedAt: number;
    turns: { index: number; inputTokens: number | null; credits: number | null; compactions: number }[];
  } | null;
  statusBar: { show(text: string, tooltip: string): void; hide(): void };
  now(): number;
}

/**
 * Keeps an opt-in status bar item in step with the session being worked in. It only calls the status bar when the
 * text or tooltip changed or the item must disappear, so repeated updates do not flicker.
 */
export class LiveNudge {
  private shown: string | null = null;

  constructor(private readonly deps: LiveNudgeDeps) {}

  update(): void {
    const view = this.view();
    if (view === null) {
      if (this.shown !== null) {
        this.shown = null;
        this.deps.statusBar.hide();
      }
      return;
    }
    const signature = `${view.text}\u0000${view.tooltip}`;
    if (signature === this.shown) return;
    this.shown = signature;
    this.deps.statusBar.show(view.text, view.tooltip);
  }

  private view(): { text: string; tooltip: string } | null {
    if (!this.deps.enabled()) return null;
    try {
      const session = this.deps.active();
      if (session === null) return null;
      const status = liveStatus({ now: this.deps.now(), endedAt: session.endedAt, turns: session.turns });
      if (status === null) return null;
      return {
        text: statusText(status),
        tooltip: `${status.nudge ?? 'Active Copilot session.'} Open the dashboard for details.`,
      };
    } catch {
      return null;
    }
  }
}
