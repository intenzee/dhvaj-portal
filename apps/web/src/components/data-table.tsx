'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { EmptyState } from './ui';

/** A lean, accessible table over TanStack Table — the one list primitive (§22). */
export function DataTable<T>({
  columns,
  data,
  empty = 'Nothing to show.',
  onRowClick,
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  empty?: string;
  onRowClick?: (row: T) => void;
}): JSX.Element {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  if (data.length === 0) return <EmptyState>{empty}</EmptyState>;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-slate-100 bg-slate-50 text-left">
              {hg.headers.map((header) => (
                <th
                  key={header.id}
                  className="whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-faint"
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              className={
                'border-b border-slate-50 last:border-0 ' +
                (onRowClick ? 'cursor-pointer hover:bg-slate-50' : '')
              }
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="whitespace-nowrap px-3 py-2 text-ink">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
