import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { DataTable, type Column } from './DataTable';
import { Measure } from './Measure';

describe('Measure', () => {
  it('shows the value with its provenance', () => {
    render(
      <Measure
        measure={{ value: 54000, provenance: { kind: 'exact', source: 'chatSessions.promptTokens' } }}
      />,
    );
    expect(screen.getByText('54,000')).toBeInTheDocument();
    const badge = screen.getByText('Exact');
    expect(badge).toHaveAttribute('title', 'Exact — chatSessions.promptTokens');
  });

  it('shows a dash and the reason when unavailable', () => {
    render(
      <Measure
        measure={{ value: null, provenance: { kind: 'unavailable', source: 'no credits reported' } }}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toHaveAttribute('title', 'Unavailable — no credits reported');
  });

  it('uses a custom formatter', () => {
    render(
      <Measure
        format={(value) => `${String(value)} cr`}
        measure={{ value: 2, provenance: { kind: 'derived', source: 'x' } }}
      />,
    );
    expect(screen.getByText('2 cr')).toBeInTheDocument();
    expect(screen.getByText('Derived')).toBeInTheDocument();
  });

  it('marks a derived lower bound with ≥ so a partial sum cannot be mistaken for a total', () => {
    render(
      <Measure
        measure={{
          value: 59000,
          provenance: {
            kind: 'derived',
            source: 'chatSessions.promptTokens (lower bound: 3 of 4 turns reported it)',
          },
        }}
      />,
    );
    expect(screen.getByText('≥ 59,000')).toBeInTheDocument();
  });

  it('does not add ≥ to other derived values or to exact values', () => {
    render(
      <>
        <Measure
          measure={{ value: 0.33, provenance: { kind: 'derived', source: 'turns.state' } }}
          format={(v) => `${String(v)}!`}
        />
        <Measure measure={{ value: 5, provenance: { kind: 'exact', source: 'x lower bound' } }} />
      </>,
    );
    expect(screen.getByText('0.33!')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});

interface Person {
  id: string;
  name: string;
}
const columns: Column<Person>[] = [
  { id: 'name', header: 'Name', cell: (row) => row.name },
  { id: 'id', header: 'Id', cell: (row) => row.id, align: 'end' },
];
const rows: Person[] = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Bo' },
];

describe('DataTable', () => {
  it('renders a captioned table with headers and rows', () => {
    render(
      <DataTable caption="People" columns={columns} rows={rows} rowKey={(row) => row.id} empty="None" />,
    );
    expect(screen.getByRole('table', { name: 'People' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Name', 'Id']);
    expect(screen.getByText('Ada')).toBeInTheDocument();
  });

  it('shows the empty message instead of an empty table', () => {
    render(
      <DataTable caption="People" columns={columns} rows={[]} rowKey={(row) => row.id} empty="Nobody here" />,
    );
    expect(screen.getByText('Nobody here')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('activates a row by click and by keyboard', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        caption="People"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        onRowActivate={onActivate}
        empty="None"
      />,
    );
    await user.click(screen.getByText('Ada'));
    expect(onActivate).toHaveBeenLastCalledWith(rows[0]);
    const second = screen.getByText('Bo').closest('tr');
    expect(second).not.toBeNull();
    second?.focus();
    await user.keyboard('{Enter}');
    expect(onActivate).toHaveBeenLastCalledWith(rows[1]);
  });
});

describe('Button', () => {
  it('renders a real button and forwards clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Refresh</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
