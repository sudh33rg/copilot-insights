import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { diagnostics } from '../test/dtoFixtures';
import { renderWithHost } from '../test/fakeHost';
import { DiagnosticsView } from './DiagnosticsView';

describe('DiagnosticsView', () => {
  it('shows versions, the index, the scan and the debug-log state', async () => {
    renderWithHost(<DiagnosticsView />, { getDiagnostics: diagnostics() });
    const environment = await screen.findByRole('region', { name: 'Environment' });
    expect(within(environment).getByText('1.139.1')).toBeInTheDocument();
    expect(within(environment).getByText('0.67.0')).toBeInTheDocument();
    expect(within(environment).getByText(/Agent debug logging: on/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Index' })).toHaveTextContent('71 sessions');
    expect(screen.getByRole('region', { name: 'Index' })).toHaveTextContent('312 turns');
    expect(screen.getByRole('region', { name: 'Scan' })).toHaveTextContent('leader');
    expect(screen.getByRole('region', { name: 'Debug logs and catalog' })).toHaveTextContent('55 models');
  });

  it('says there is no schema drift when nothing unknown was seen', async () => {
    renderWithHost(<DiagnosticsView />, { getDiagnostics: diagnostics() });
    expect(await screen.findByText(/No unknown fields/)).toBeInTheDocument();
  });

  it('lists drift, invalid requests and unclassified debugNames so they can be acted on', async () => {
    renderWithHost(<DiagnosticsView />, {
      getDiagnostics: diagnostics({
        drift: { unknownPartKinds: ['newPart'], unknownRequestKeys: ['newKey'] },
        index: { sessions: 1, turns: 2, invalidRequests: 3 },
        debugLog: {
          sessionsWithLogs: 1,
          llmCalls: 4,
          unknownDebugNames: [{ name: 'mystery-thing', count: 2 }],
          copilotVersionsSeen: [],
        },
        scan: { role: 'follower', lastSyncAt: null, lastError: 'disk full', parseErrors: 1, badLines: 0 },
      }),
    });
    const drift = await screen.findByRole('region', { name: 'Schema drift' });
    expect(within(drift).getByText('newPart')).toBeInTheDocument();
    expect(within(drift).getByText('newKey')).toBeInTheDocument();
    expect(within(drift).getByText(/3 invalid request/)).toBeInTheDocument();
    expect(screen.getByText(/mystery-thing × 2/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Last scan failed: disk full');
  });

  it('offers to enable exact telemetry when it is off and asks the extension to do it', async () => {
    const { calls } = renderWithHost(<DiagnosticsView />, {
      getDiagnostics: diagnostics({ debugLogging: false }),
      enableDebugLogging: { outcome: 'enabled' },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Enable exact telemetry…' }));
    expect(calls.map((call) => call.method)).toContain('enableDebugLogging');
    expect(await screen.findByText(/new Copilot chat sessions/)).toBeInTheDocument();
  });

  it('does not offer the button when logging is already on', async () => {
    renderWithHost(<DiagnosticsView />, { getDiagnostics: diagnostics() });
    await screen.findByText(/Agent debug logging: on/);
    expect(screen.queryByRole('button', { name: 'Enable exact telemetry…' })).not.toBeInTheDocument();
  });

  it('shows an error when the extension fails', async () => {
    renderWithHost(<DiagnosticsView />, {});
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load diagnostics: boom');
  });
});
