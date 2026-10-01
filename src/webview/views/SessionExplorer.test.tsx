import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { sessionDetail, turnDetail } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { SessionDetailView } from './SessionDetailView';

describe('session investigation', () => {
  it('opens context snapshots and inspected tool results independently from the transcript', async () => {
    renderWithHost(<SessionDetailView id="fx-auto-1" onBack={() => undefined} />, {
      getSession: sessionDetail({
        turns: [
          turnDetail({
            contextItems: [
              { kind: 'file', name: 'main.ts', content: 'snapshot from request', source: 'recorded' },
            ],
            toolCalls: [{ name: 'read_file', status: 'unknown', args: '{}', output: 'recorded result' }],
          }),
        ],
      }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Context' }));
    expect(screen.getByText('snapshot from request')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Conversation' }));
    await userEvent.click(screen.getByRole('button', { name: 'Inspect read_file in turn 1' }));
    expect(
      within(screen.getByRole('complementary', { name: 'Event inspector' })).getByText('recorded result'),
    ).toBeInTheDocument();
  });
  it('saves notes and bookmarks through validated host storage', async () => {
    const { calls } = renderWithHost(<SessionDetailView id="fx-auto-1" onBack={() => undefined} />, {
      getSession: sessionDetail(),
      saveAnnotation: { bookmarked: true, note: 'Good approach', tags: ['useful'] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Notes' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Session note' }), 'Good approach');
    await userEvent.type(screen.getByRole('textbox', { name: 'Tags' }), 'useful');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bookmark session' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save notes' }));
    expect(calls.find((call) => call.method === 'saveAnnotation')?.params).toEqual({
      id: 'fx-auto-1',
      annotation: { bookmarked: true, note: 'Good approach', tags: ['useful'] },
    });
  });
  it('removes the selected payload from view after confirmed content clearing', async () => {
    let cleared = false;
    renderWithHost(<SessionDetailView id="fx-auto-1" onBack={() => undefined} />, {
      getSession: () =>
        sessionDetail({
          captureLevel: cleared ? 'metrics' : 'full',
          turns: [
            turnDetail({
              toolCalls: [
                {
                  name: 'read_file',
                  status: 'unknown',
                  args: cleared ? null : '{}',
                  output: cleared ? null : 'private historical result',
                },
              ],
            }),
          ],
        }),
      clearData: () => {
        cleared = true;
        return { confirmed: true, sessions: 1 };
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect read_file in turn 1' }));
    expect(screen.getAllByText('private historical result').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Clear conversation text' }));
    await screen.findByText(/Conversation text is not stored/);
    expect(screen.queryByText('private historical result')).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Event inspector' })).not.toBeInTheDocument();
  });
});
