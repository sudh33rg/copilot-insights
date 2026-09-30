import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Efficiency } from '../../shared/dto';
import { EfficiencyCard } from './EfficiencyCard';

const efficiency = (overrides: Partial<Efficiency> = {}): Efficiency => ({
  drivers: [],
  findings: [],
  ...overrides,
});

describe('EfficiencyCard', () => {
  it('lists each cost driver with its evidence and provenance', () => {
    render(
      <EfficiencyCard
        efficiency={efficiency({
          drivers: [
            {
              id: 'context-growth',
              title: 'Context growth',
              evidence: 'context grew 2.8× (24,000 input tokens on turn 1 → 67,200 on turn 6)',
              provenance: { kind: 'derived', source: 'ratio of exact input tokens' },
            },
            {
              id: 'rounds',
              title: 'Tool rounds',
              evidence: '19 tool rounds across 6 turns',
              provenance: { kind: 'exact', source: 'chatSessions toolCallRounds' },
            },
          ],
        })}
      />,
    );
    const card = screen.getByRole('region', { name: 'Efficiency' });
    expect(within(card).getByRole('heading', { name: 'Why it cost what it did' })).toBeInTheDocument();
    expect(within(card).getByText('Context growth')).toBeInTheDocument();
    expect(within(card).getByText(/context grew 2.8×/)).toBeInTheDocument();
    expect(within(card).getByText('Derived')).toBeInTheDocument();
    expect(within(card).getByText('Exact')).toBeInTheDocument();
  });

  it('says so when nothing stood out', () => {
    render(<EfficiencyCard efficiency={efficiency()} />);
    expect(screen.getByText('No cost drivers stood out for this session.')).toBeInTheDocument();
  });

  it('renders evidence as plain text, never as HTML', () => {
    render(
      <EfficiencyCard
        efficiency={efficiency({
          drivers: [
            {
              id: 'x',
              title: 'T',
              evidence: '<img src=x onerror=alert(1)>',
              provenance: { kind: 'exact', source: 's' },
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('lists context and model advice with its evidence and an inferred badge', () => {
    render(
      <EfficiencyCard
        efficiency={efficiency({
          findings: [
            {
              id: 'unused-tools',
              message: 'Tools you do not use still cost tokens on every request.',
              evidence: '31 of 47 tool definitions were never called',
              provenance: { kind: 'inferred', source: 'characters ÷ 4' },
            },
          ],
        })}
      />,
    );
    const card = screen.getByRole('region', { name: 'Efficiency' });
    expect(within(card).getByRole('heading', { name: 'Context and model advice' })).toBeInTheDocument();
    expect(
      within(card).getByText('Tools you do not use still cost tokens on every request.'),
    ).toBeInTheDocument();
    expect(within(card).getByText(/Evidence: 31 of 47 tool definitions/)).toBeInTheDocument();
    expect(within(card).getByText('Inferred')).toBeInTheDocument();
  });

  it('omits the advice section when there is none', () => {
    render(<EfficiencyCard efficiency={efficiency()} />);
    expect(screen.queryByRole('heading', { name: 'Context and model advice' })).toBeNull();
  });
});
