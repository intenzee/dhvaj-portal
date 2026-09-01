'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { CSV_MIME, XLSX_MIME } from '@/lib/file-kind';
import { Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { EditorHandle } from './types';

interface Sheet {
  name: string;
  rows: string[][];
}

/** Pad every row to the same width (min 1 col) so the grid is rectangular. */
function normalize(aoa: string[][]): string[][] {
  const rows = aoa.length ? aoa : [['']];
  const cols = Math.max(1, ...rows.map((r) => r.length));
  return rows.map((r) => {
    const row = r.slice();
    while (row.length < cols) row.push('');
    return row;
  });
}

/** Spreadsheet column label: 0→A, 25→Z, 26→AA … */
function colLabel(i: number): string {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export const SpreadsheetEditor = forwardRef<
  EditorHandle,
  { blob: Blob; outputFormat: 'xlsx' | 'csv'; readOnly: boolean; onDirty: () => void }
>(function SpreadsheetEditor({ blob, outputFormat, readOnly, onDirty }, ref) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const sheetsRef = useRef<Sheet[]>([]);
  sheetsRef.current = sheets ?? [];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const XLSX = await import('xlsx');
        const buf = await blob.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const loaded: Sheet[] = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          if (!ws) return { name, rows: normalize([['']]) };
          const aoa = (
            XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown[][]
          ).map((r) => r.map((c) => (c == null ? '' : String(c))));
          return { name, rows: normalize(aoa) };
        });
        if (!cancelled) {
          setSheets(loaded.length ? loaded : [{ name: 'Sheet1', rows: normalize([['']]) }]);
        }
      } catch {
        if (!cancelled) setError('Could not read this spreadsheet.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob]);

  useImperativeHandle(
    ref,
    () => ({
      async export(): Promise<Blob> {
        const XLSX = await import('xlsx');
        const data = sheetsRef.current;
        if (outputFormat === 'csv') {
          const ws = XLSX.utils.aoa_to_sheet(data[0]?.rows ?? [['']]);
          return new Blob([XLSX.utils.sheet_to_csv(ws)], { type: CSV_MIME });
        }
        const wb = XLSX.utils.book_new();
        (data.length ? data : [{ name: 'Sheet1', rows: [['']] }]).forEach((s, i) => {
          const ws = XLSX.utils.aoa_to_sheet(s.rows);
          XLSX.utils.book_append_sheet(wb, ws, (s.name || `Sheet${i + 1}`).slice(0, 31));
        });
        const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
        return new Blob([out], { type: XLSX_MIME });
      },
    }),
    [outputFormat],
  );

  const setCell = (r: number, c: number, v: string): void => {
    setSheets((prev) => {
      if (!prev) return prev;
      const copy = prev.slice();
      const sheet = { ...copy[active]!, rows: copy[active]!.rows.map((row) => row.slice()) };
      sheet.rows[r]![c] = v;
      copy[active] = sheet;
      return copy;
    });
    onDirty();
  };

  const addRow = (): void => {
    setSheets((prev) => {
      if (!prev) return prev;
      const copy = prev.slice();
      const cur = copy[active]!;
      const cols = cur.rows[0]?.length ?? 1;
      copy[active] = { ...cur, rows: [...cur.rows.map((r) => r.slice()), Array(cols).fill('')] };
      return copy;
    });
    onDirty();
  };

  const addCol = (): void => {
    setSheets((prev) => {
      if (!prev) return prev;
      const copy = prev.slice();
      const cur = copy[active]!;
      copy[active] = { ...cur, rows: cur.rows.map((r) => [...r, '']) };
      return copy;
    });
    onDirty();
  };

  const current = sheets?.[active];
  const colCount = useMemo(() => current?.rows[0]?.length ?? 0, [current]);

  if (error) {
    return <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-muted">{error}</div>;
  }
  if (!sheets || !current) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Opening spreadsheet…" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 w-10 border border-line bg-surface-raised" />
              {Array.from({ length: colCount }).map((_, c) => (
                <th
                  key={c}
                  className="min-w-[8rem] border border-line bg-surface-raised px-2 py-1 text-center text-[11px] font-semibold text-ink-faint"
                >
                  {colLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {current.rows.map((row, r) => (
              <tr key={r}>
                <td className="sticky left-0 z-10 border border-line bg-surface-raised px-2 py-1 text-center text-[11px] font-semibold text-ink-faint">
                  {r + 1}
                </td>
                {row.map((cell, c) => (
                  <td key={c} className="border border-line p-0">
                    <input
                      value={cell}
                      readOnly={readOnly}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      className={cn(
                        'w-full min-w-[8rem] bg-transparent px-2 py-1 text-ink outline-none',
                        'focus:bg-primary-50 focus:ring-1 focus:ring-inset focus:ring-primary-400',
                        readOnly && 'cursor-default',
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 border-t border-line bg-surface px-3 py-1.5">
        {sheets.length > 1 &&
          sheets.map((s, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition',
                i === active ? 'bg-primary-600 text-white' : 'text-ink-muted hover:bg-surface-sunken',
              )}
            >
              {s.name || `Sheet${i + 1}`}
            </button>
          ))}
        {!readOnly && (
          <div className="ml-auto flex items-center gap-1">
            <button onClick={addRow} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-muted hover:bg-surface-sunken">
              <Plus className="h-3 w-3" /> Row
            </button>
            <button onClick={addCol} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-muted hover:bg-surface-sunken">
              <Plus className="h-3 w-3" /> Column
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
