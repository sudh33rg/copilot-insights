import { describe, expect, it, vi } from 'vitest';
import { DEBUG_LOGGING_SETTING, debugLoggingExplanation, enableDebugLogging } from './consent';

const deps = (overrides: Partial<Parameters<typeof enableDebugLogging>[0]> = {}) => ({
  isEnabled: () => false,
  confirm: vi.fn(() => Promise.resolve(true)),
  enable: vi.fn(() => Promise.resolve()),
  ...overrides,
});

describe('enableDebugLogging', () => {
  it('does nothing when logging is already on', async () => {
    const d = deps({ isEnabled: () => true });
    expect(await enableDebugLogging(d)).toBe('already-enabled');
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.enable).not.toHaveBeenCalled();
  });

  it('never enables without an explicit yes', async () => {
    const d = deps({ confirm: vi.fn(() => Promise.resolve(false)) });
    expect(await enableDebugLogging(d)).toBe('declined');
    expect(d.enable).not.toHaveBeenCalled();
  });

  it('enables exactly once after a yes', async () => {
    const d = deps();
    expect(await enableDebugLogging(d)).toBe('enabled');
    expect(d.enable).toHaveBeenCalledTimes(1);
  });

  it('does not enable when the confirmation itself fails', async () => {
    const d = deps({ confirm: vi.fn(() => Promise.reject(new Error('dialog closed'))) });
    await expect(enableDebugLogging(d)).rejects.toThrow('dialog closed');
    expect(d.enable).not.toHaveBeenCalled();
  });
});

describe('debugLoggingExplanation', () => {
  it('states what it adds, what it exposes on disk, and what Copilot Insights does with it', () => {
    const text = debugLoggingExplanation();
    expect(text.title).toContain('exact telemetry');
    expect(text.detail).toContain('cached tokens');
    expect(text.detail).toContain('prompts');
    expect(text.detail).toContain('on this machine');
    expect(text.detail).toContain('never stores');
    expect(text.detail).toContain('new chat sessions');
    expect(text.confirmLabel).toBe('Enable');
  });

  it('targets Copilot Chat’s own setting', () => {
    expect(DEBUG_LOGGING_SETTING).toEqual({
      section: 'github.copilot.chat.agentDebugLog.fileLogging',
      key: 'enabled',
    });
  });
});
