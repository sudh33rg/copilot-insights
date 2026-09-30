import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Outcomes } from '../../shared/dto';
import { exactNumber, missing } from '../test/dtoFixtures';
import { OutcomeCard } from './OutcomeCard';

const derivedNumber = (value: number, source = 'test') => ({
  value,
  provenance: { kind: 'derived' as const, source },
});
const none: Outcomes = {
  linesAdded: missing(),
  linesRemoved: missing(),
  editsKept: missing(),
  editsUndone: missing(),
  editsUserModified: missing(),
  editKeepRate: missing(),
  laterSurvival: missing(),
  terminalRuns: missing(),
  terminalFailures: missing(),
  testRuns: missing(),
  testFailures: missing(),
  lastTestPassed: { value: null, provenance: { kind: 'unavailable', source: 'test' } },
  errorsDelta: missing(),
  warningsDelta: missing(),
  commits: [],
};
const full: Outcomes = {
  ...none,
  linesAdded: derivedNumber(120),
  linesRemoved: derivedNumber(30),
  editsKept: exactNumber(3),
  editsUndone: exactNumber(1),
  editsUserModified: exactNumber(2),
  editKeepRate: derivedNumber(0.5),
  laterSurvival: derivedNumber(0.82),
  terminalRuns: derivedNumber(5),
  terminalFailures: derivedNumber(1),
  testRuns: derivedNumber(2),
  testFailures: derivedNumber(1),
  lastTestPassed: { value: true, provenance: { kind: 'derived', source: 'test' } },
  errorsDelta: derivedNumber(-2),
  warningsDelta: derivedNumber(1),
  commits: [
    {
      hash: 'abc1234def5678abc1234def5678abc1234def56',
      committedAt: 1790000000000,
      overlapFiles: 2,
      editedFiles: 3,
      credits: derivedNumber(1.5),
    },
  ],
};

const row = (card: HTMLElement, label: string): HTMLElement => {
  const term = within(card).getByText(label, { selector: 'dt' });
  const detail = term.nextElementSibling;
  if (!(detail instanceof HTMLElement)) throw new Error(`no value for ${label}`);
  return detail;
};

describe('OutcomeCard', () => {
  it('shows every observed outcome with its provenance', () => {
    render(<OutcomeCard outcomes={full} />);
    const card = screen.getByRole('region', { name: 'Outcome' });
    expect(row(card, 'Lines changed').textContent).toContain('+120');
    expect(row(card, 'Lines changed').textContent).toContain('−30');
    expect(within(row(card, 'Edits kept')).getByText('3')).toBeInTheDocument();
    expect(within(row(card, 'Edits undone')).getByText('1')).toBeInTheDocument();
    expect(within(row(card, 'Edits modified by you')).getByText('2')).toBeInTheDocument();
    expect(within(row(card, 'Keep rate')).getByText('50%')).toBeInTheDocument();
    expect(within(row(card, 'Later survival')).getByText('82%')).toBeInTheDocument();
    expect(within(row(card, 'Terminal runs')).getByText('5')).toBeInTheDocument();
    expect(within(row(card, 'Failed runs')).getByText('1')).toBeInTheDocument();
    expect(within(row(card, 'Test runs')).getByText('2')).toBeInTheDocument();
    expect(within(row(card, 'Last test run')).getByText('Passed')).toBeInTheDocument();
    expect(within(row(card, 'Diagnostics errors')).getByText('−2')).toBeInTheDocument();
    expect(within(row(card, 'Diagnostics warnings')).getByText('+1')).toBeInTheDocument();
    expect(within(card).getAllByText('Derived').length).toBeGreaterThan(5);
    expect(within(card).getAllByText('Exact').length).toBe(3);
  });

  it('lists linked commits by short hash with their credits, as plain text', () => {
    render(<OutcomeCard outcomes={full} />);
    const card = screen.getByRole('region', { name: 'Outcome' });
    const commits = row(card, 'Commits');
    expect(within(commits).getByText('abc1234')).toBeInTheDocument();
    expect(within(commits).getByText('1.5')).toBeInTheDocument();
    expect(commits.textContent).not.toContain('abc1234def5678');
    expect(within(commits).getByText(/2 of 3 edited files/)).toBeInTheDocument();
  });

  it('reports a failing last test run', () => {
    render(
      <OutcomeCard
        outcomes={{
          ...full,
          lastTestPassed: { value: false, provenance: { kind: 'derived', source: 'test' } },
        }}
      />,
    );
    const card = screen.getByRole('region', { name: 'Outcome' });
    expect(within(row(card, 'Last test run')).getByText('Failed')).toBeInTheDocument();
  });

  it('shows only the explanation, and no zeros, when nothing was observed', () => {
    render(<OutcomeCard outcomes={none} />);
    const card = screen.getByRole('region', { name: 'Outcome' });
    expect(
      within(card).getByText('Outcome evidence is collected only while VS Code is open with this extension.'),
    ).toBeInTheDocument();
    // One explanation instead of a wall of unavailable rows; and never a zero.
    expect(within(card).queryByRole('term')).toBeNull();
    expect(within(card).queryAllByText('Unavailable')).toHaveLength(0);
    expect(screen.queryByText('0')).toBeNull();
  });

  it('does not show the explanation when something was observed', () => {
    render(<OutcomeCard outcomes={{ ...none, editsKept: exactNumber(1) }} />);
    expect(screen.queryByText(/collected only while VS Code is open/)).toBeNull();
  });

  it('marks a lower bound with ≥', () => {
    render(
      <OutcomeCard
        outcomes={{
          ...full,
          terminalRuns: derivedNumber(
            2,
            'terminal runs (lower bound: 2 of 3 terminal tool calls were observed)',
          ),
        }}
      />,
    );
    const card = screen.getByRole('region', { name: 'Outcome' });
    expect(within(row(card, 'Terminal runs')).getByText('≥ 2')).toBeInTheDocument();
  });
});
