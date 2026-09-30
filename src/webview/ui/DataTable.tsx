import type { KeyboardEvent, ReactNode } from 'react';

export interface Column<Row> {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: 'end';
}

export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  onRowActivate,
  empty,
}: {
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  onRowActivate?: (row: Row) => void;
  empty: string;
}) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  const activate = (row: Row) => (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowActivate?.(row);
    }
  };
  return (
    <table className="table" aria-label={caption}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.id} scope="col" className={column.align === 'end' ? 'num' : undefined}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={rowKey(row)}
            tabIndex={onRowActivate ? 0 : undefined}
            className={onRowActivate ? 'row--interactive' : undefined}
            onClick={
              onRowActivate
                ? () => {
                    onRowActivate(row);
                  }
                : undefined
            }
            onKeyDown={onRowActivate ? activate(row) : undefined}
          >
            {columns.map((column) => (
              <td key={column.id} className={column.align === 'end' ? 'num' : undefined}>
                {column.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
