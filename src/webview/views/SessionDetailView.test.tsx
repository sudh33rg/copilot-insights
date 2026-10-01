import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { missing, sessionDetail, turnDetail } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { SessionDetailView } from './SessionDetailView';

const view = (results: Record<string, unknown>, onBack = vi.fn()) =>
  renderWithHost(<SessionDetailView id="fx-auto-1" onBack={onBack} />, results);

describe('SessionDetailView', () => {
  it('lets you inspect tool arguments, context composition and filter the trace', async () => {
    view({
      getSession: sessionDetail({
        turns: [
          turnDetail({
            toolCalls: [
              {
                name: 'read_file',
                status: 'unknown',
                args: '{"filePath":"/repo/main.ts"}',
                origin: 'toolCallRound',
              },
            ],
            promptComposition: [
              {
                category: 'System',
                label: 'Tool definitions',
                share: { value: 0.4, provenance: { kind: 'exact', source: 'Copilot' } },
              },
            ],
          }),
        ],
      }),
    });
    const turn = await screen.findByRole('article', { name: 'Turn 1' });
    await userEvent.click(within(turn).getByText('read_file'));
    expect(within(turn).getByText('{"filePath":"/repo/main.ts"}')).toBeVisible();
    expect(within(turn).getByText('40%')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search turns' }), 'not-present');
    expect(screen.queryByRole('article', { name: 'Turn 1' })).not.toBeInTheDocument();
    expect(screen.getByText('No turns match these filters.')).toBeInTheDocument();
  });

  it('shows the header, totals and the analysis with provenance', async () => {
    view({ getSession: sessionDetail() });
    expect(await screen.findByRole('heading', { name: 'Fix run timeout race' })).toBeInTheDocument();
    expect(screen.getByText(/alpha/)).toBeInTheDocument();
    const analysis = screen.getByRole('region', { name: 'Analysis' });
    // Intent comes from the prompt's keywords; the task type repeats it here because the prompt decided it.
    expect(within(analysis).getAllByText('bugfix')).toHaveLength(2);
    expect(within(analysis).getByText('Task type')).toBeInTheDocument();
    expect(within(analysis).getByText(/Bug fix: changed 2 files/)).toBeInTheDocument();
    expect(within(analysis).getAllByText('Inferred').length).toBeGreaterThan(0);
    expect(within(analysis).getAllByText('Derived').length).toBeGreaterThan(0);
    expect(within(analysis).getByText('Long sessions carry a growing context.')).toBeInTheDocument();
    expect(within(analysis).getByText(/12 user turns/)).toBeInTheDocument();
  });

  it('shows the outcome card after the analysis, using what was observed', async () => {
    const detail = sessionDetail();
    view({
      getSession: {
        ...detail,
        outcomes: {
          ...detail.outcomes,
          editsKept: { value: 4, provenance: { kind: 'exact', source: 'chatSessions.editedFileEvents' } },
        },
      },
    });
    const outcome = await screen.findByRole('region', { name: 'Outcome' });
    expect(within(outcome).getByText('Edits kept', { selector: 'dt' }).nextElementSibling).toHaveTextContent(
      '4',
    );
    const analysis = screen.getByRole('region', { name: 'Analysis' });
    expect(analysis.compareDocumentPosition(outcome) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('explains missing outcome evidence instead of showing zeros', async () => {
    view({ getSession: sessionDetail() });
    const outcome = await screen.findByRole('region', { name: 'Outcome' });
    expect(within(outcome).getByText(/collected only while VS Code is open/)).toBeInTheDocument();
  });

  it('shows how the session compares with your own baseline, and nothing without one', async () => {
    const detail = sessionDetail();
    const { unmount } = view({
      getSession: {
        ...detail,
        baseline: {
          taskType: 'bugfix',
          model: 'gpt-5.6-luna',
          sessions: 12,
          verdict: { value: 'high', provenance: { kind: 'inferred', source: 'rule' } },
          median: { value: 48_000, provenance: { kind: 'derived', source: 's' } },
          typicalLow: { value: 40_000, provenance: { kind: 'derived', source: 's' } },
          typicalHigh: { value: 60_000, provenance: { kind: 'derived', source: 's' } },
          thisSession: { value: 210_000, provenance: { kind: 'derived', source: 's' } },
          message:
            'Your bugfix sessions on gpt-5.6-luna normally use 40,000–60,000 input tokens. This one used 210,000.',
        },
      },
    });
    expect(await screen.findByText(/normally use 40,000–60,000 input tokens/)).toBeInTheDocument();
    expect(screen.getAllByText('Inferred').length).toBeGreaterThan(0);
    unmount();
    view({ getSession: detail });
    await screen.findByRole('heading', { name: 'Fix run timeout race' });
    expect(screen.queryByText(/normally use/)).toBeNull();
  });

  it('renders a timeline of turns with model, tokens, credits, tools and files', async () => {
    view({ getSession: sessionDetail() });
    const first = await screen.findByRole('article', { name: 'Turn 1' });
    expect(within(first).getByText('Auto → gpt-5.6-luna')).toBeInTheDocument();
    expect(within(first).getByText('24,000')).toBeInTheDocument();
    expect(within(first).getByText('1,700')).toBeInTheDocument();
    expect(within(first).getByText('1.126')).toBeInTheDocument();
    expect(within(first).getByText('read_file')).toBeInTheDocument();
    expect(within(first).getByText('/repo/src/execution/manager.ts')).toBeInTheDocument();
    expect(within(first).getByText(/reasoning 4\.2 s/)).toBeInTheDocument();
    expect(within(first).getByText(/1 compaction/)).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Turn 2' })).toBeInTheDocument();
  });

  it('renders prompts and responses as plain text, never as HTML', async () => {
    const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const { container } = view({
      getSession: sessionDetail({ turns: [turnDetail({ userText: hostile, assistantText: hostile })] }),
    });
    expect((await screen.findAllByText(hostile)).length).toBe(2);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('explains missing text at low capture levels and marks system turns and errors', async () => {
    view({
      getSession: sessionDetail({
        captureLevel: 'metrics',
        turns: [
          turnDetail({ userText: null, assistantText: null }),
          turnDetail({
            index: 2,
            systemInitiated: true,
            state: 'failed',
            errorCode: 'rate_limited',
            errorMessage: 'Too many requests',
            inputTokens: missing('chatSessions.promptTokens'),
          }),
        ],
      }),
    });
    const first = await screen.findByRole('article', { name: 'Turn 1' });
    expect(within(first).getAllByText('Not stored at this capture level.').length).toBe(2);
    const second = screen.getByRole('article', { name: 'Turn 2' });
    expect(within(second).getByText('System-initiated')).toBeInTheDocument();
    expect(within(second).getByText('Failed')).toBeInTheDocument();
    expect(within(second).getByText(/rate_limited/)).toBeInTheDocument();
    expect(within(second).getByText('Unavailable')).toBeInTheDocument();
  });

  it('goes back and handles a session that is no longer indexed', async () => {
    const onBack = vi.fn();
    view({ getSession: null }, onBack);
    expect(await screen.findByText('This session is no longer in the index.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '← Sessions' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('shows an error when the extension fails', async () => {
    view({});
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the session: boom');
  });

  it('clears text or deletes the session through the extension, which asks for confirmation', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    const { calls } = view(
      { getSession: sessionDetail(), clearData: { confirmed: true, sessions: 1 } },
      onBack,
    );
    await user.click(await screen.findByRole('button', { name: 'Clear conversation text' }));
    expect(calls.filter((call) => call.method === 'clearData').at(-1)).toEqual({
      method: 'clearData',
      params: { scope: { kind: 'sessionContent', id: 'fx-auto-1' } },
    });
    expect(onBack).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete session' }));
    expect(calls.filter((call) => call.method === 'clearData').at(-1)).toEqual({
      method: 'clearData',
      params: { scope: { kind: 'session', id: 'fx-auto-1' } },
    });
    await vi.waitFor(() => {
      expect(onBack).toHaveBeenCalledOnce();
    });
  });

  it('stays on the session when the user cancels the confirmation', async () => {
    const onBack = vi.fn();
    const { calls } = view(
      { getSession: sessionDetail(), clearData: { confirmed: false, sessions: 0 } },
      onBack,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Delete session' }));
    await vi.waitFor(() => {
      expect(calls.some((call) => call.method === 'clearData')).toBe(true);
    });
    expect(onBack).not.toHaveBeenCalled();
  });

  it('shows exact debug-log telemetry when a turn has it and a hint when the session has none', async () => {
    view({ getSession: sessionDetail() });
    const first = await screen.findByRole('article', { name: 'Turn 1' });
    expect(within(first).getByText('18,000')).toBeInTheDocument();
    expect(within(first).getByText('2.1 s')).toBeInTheDocument();
    expect(within(first).getByText('1,126,141,000')).toBeInTheDocument();
    expect(screen.queryByText(/Agent debug logging is off/)).not.toBeInTheDocument();
  });

  it('explains how to get exact telemetry when the session has no debug log', async () => {
    view({
      getSession: sessionDetail({
        debug: null,
        turns: [turnDetail({ cachedTokens: missing('x'), ttftMs: missing('x'), nanoAiu: missing('x') })],
      }),
    });
    expect(await screen.findByText(/Agent debug logging is off/)).toBeInTheDocument();
    const turn = screen.getByRole('article', { name: 'Turn 1' });
    expect(within(turn).queryByText('Cached')).not.toBeInTheDocument();
  });
});
