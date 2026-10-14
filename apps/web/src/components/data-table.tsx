'use client';

import type { MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { EmptyState } from './ui';

/** Did the click land on a control inside the row (which handles it itself)? */
function onControl(e: MouseEvent): boolean {
  return (e.target as HTMLElement).closest('a,button,input,select,textarea,label,[role="button"]') !== null;
}

/**
 * A lean, accessible table over TanStack Table — the one list primitive (§22).
 * With `rowHref` each row is a link to its work: the first cell is a real
 * <Link> (so middle-click, Ctrl/Cmd-click and "open in new tab" work), and a
 * click anywhere else on the row opens it too.
 */
export function DataTable<T>({
  columns,
  data,
  empty = 'Nothing to show.',
  onRowClick,
  rowHref,
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  empty?: string;
  onRowClick?: (row: T) => void;
  rowHref?: (row: T) => string;
}): JSX.Element {
  const router = useRouter();
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  const clickable = Boolean(onRowClick || rowHref);
  const open = (e: MouseEvent, row: T) => {
    if (onControl(e)) return;
    if (!rowHref) return onRowClick?.(row);
    const href = rowHref(row);
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
      window.open(href, '_blank', 'noopener');
    } else {
      router.push(href);
    }
  };

  if (data.length === 0) return <EmptyState>{empty}</EmptyState>;

  return (
    <div className="scroll-slim overflow-x-auto rounded-xl border border-line-strong bg-surface">
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-line bg-surface-raised/70 text-left">
              {hg.headers.map((header) => (
                <th
                  key={header.id}
                  className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint"
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
              onClick={clickable ? (e) => open(e, row.original) : undefined}
              onAuxClick={rowHref ? (e) => e.button === 1 && open(e, row.original) : undefined}
              className={
                'border-b border-line last:border-0 ' +
                (clickable ? 'cursor-pointer hover:bg-surface-raised' : '')
              }
            >
              {row.getVisibleCells().map((cell, i) => (
                <td key={cell.id} className="whitespace-nowrap px-4 py-2.5 text-ink">
                  {rowHref && i === 0 ? (
                    <Link
                      href={rowHref(row.original)}
                      className="font-medium text-primary-700 hover:underline"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </Link>
                  ) : (
                    flexRender(cell.column.columnDef.cell, cell.getContext())
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
