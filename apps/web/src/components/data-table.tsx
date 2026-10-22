'use client';

import { useMemo, type MouseEvent } from 'react';
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
 * TanStack needs an id per column, taken from `id`, `accessorKey` or a
 * non-empty string header; an actions column (`header: ''`) without one throws
 * the moment rows render. Give such a column its position. Pure — tested.
 */
export function withColumnIds<T>(columns: ColumnDef<T, unknown>[]): ColumnDef<T, unknown>[] {
  return columns.map((c, i) => {
    const key = (c as { accessorKey?: unknown }).accessorKey;
    if (c.id || key || (typeof c.header === 'string' && c.header)) return c;
    return { ...c, id: `col_${i}` };
  });
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
  onRowOpen,
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  empty?: string;
  onRowClick?: (row: T) => void;
  rowHref?: (row: T) => string;
  /**
   * A plain click on a `rowHref` row is offered here first; return true to
   * handle it in place (e.g. open the filing drawer, WF-202). Modified clicks
   * always open the link.
   */
  onRowOpen?: (row: T) => boolean;
}): JSX.Element {
  const router = useRouter();
  const safeColumns = useMemo(() => withColumnIds(columns), [columns]);
  const table = useReactTable({ data, columns: safeColumns, getCoreRowModel: getCoreRowModel() });
  const clickable = Boolean(onRowClick || rowHref);
  const open = (e: MouseEvent, row: T) => {
    if (onControl(e)) return;
    if (!rowHref) return onRowClick?.(row);
    const href = rowHref(row);
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
      window.open(href, '_blank', 'noopener');
    } else if (!onRowOpen?.(row)) {
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
                      onClick={(e) => {
                        const plain = !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
                        if (plain && e.button === 0 && onRowOpen?.(row.original)) e.preventDefault();
                      }}
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
