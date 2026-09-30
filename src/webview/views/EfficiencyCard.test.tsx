import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Efficiency } from '../../shared/dto';
import { EfficiencyCard } from './EfficiencyCard';

const efficiency = (overrides: Partial<Efficiency> = {}): Efficiency => ({
  drivers: [],
  findings: [],
  freshSession: null,
  priceAlternatives: [],
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

  it('shows the fresh-session estimate as an inferred estimate kept apart from the exact totals', () => {
    const inferred = (value: number) => ({
      value,
      provenance: { kind: 'inferred' as const, source: 'estimate: …' },
    });
    render(
      <EfficiencyCard
        efficiency={efficiency({
          freshSession: { restartAtTurn: 4, tokensSaved: inferred(120_000), shareOfInput: inferred(0.63) },
        })}
      />,
    );
    const card = screen.getByRole('region', { name: 'Efficiency' });
    expect(
      within(card).getByText(
        'Restarting in a fresh session at turn 4 would have saved an estimated 120,000 input tokens (63% of this session’s input).',
      ),
    ).toBeInTheDocument();
    expect(within(card).getByText('Inferred')).toBeInTheDocument();
    expect(within(card).getByText('Estimate, not part of the exact totals above.')).toBeInTheDocument();
  });

  it('shows no fresh-session line when there is no estimate', () => {
    render(<EfficiencyCard efficiency={efficiency()} />);
    expect(screen.queryByText(/fresh session/)).toBeNull();
  });

  it('shows the same tokens on cheaper models as a list-price index, not as credits', () => {
    const derivedRatio = (value: number) => ({
      value,
      provenance: { kind: 'derived' as const, source: 'catalog list prices' },
    });
    render(
      <EfficiencyCard
        efficiency={efficiency({
          priceAlternatives: [
            { model: 'budget-model', name: 'Budget Model', relativeCost: derivedRatio(0.104) },
            { model: 'tiny', name: null, relativeCost: derivedRatio(0.02) },
          ],
        })}
      />,
    );
    const table = screen.getByRole('table', { name: 'Same tokens on other models (list-price index)' });
    expect(within(table).getByText('Budget Model')).toBeInTheDocument();
    expect(within(table).getByText('0.1×')).toBeInTheDocument();
    expect(within(table).getByText('tiny')).toBeInTheDocument();
    expect(within(table).getByText('0.02×')).toBeInTheDocument();
    expect(within(table).getAllByText('Derived')).toHaveLength(2);
    expect(
      screen.getByText('Relative list cost of this session’s exact tokens; not a credit figure.'),
    ).toBeInTheDocument();
  });

  it('shows no price table when there is nothing cheaper to compare', () => {
    render(<EfficiencyCard efficiency={efficiency()} />);
    expect(screen.queryByRole('table')).toBeNull();
  });
});
