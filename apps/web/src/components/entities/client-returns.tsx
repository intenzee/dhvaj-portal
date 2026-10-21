'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  GST_STATES,
  RETURN_FORM_LABEL,
  returnPeriodLabel,
  type ClientReturnLine,
  type ClientReturns,
  type ReturnMark,
} from '@hsdg/contracts';
import { Check } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui';

/**
 * ADR-0035 — the GST returns the firm's login workbook marks filed / NA,
 * laid out as the sheet is: the periods across, GSTR-1 / 3B (/ 7) under each,
 * one row per GSTIN (or per state while the sheet has no GSTIN).
 */

export function useClientReturns(entityId?: string) {
  return useQuery({
    queryKey: ['client-returns', entityId ?? 'all'],
    queryFn: () =>
      apiFetch<ClientReturns>(
        entityId ? `/client-returns?entityId=${entityId}` : '/client-returns',
      ),
  });
}

/** 'GSTIN 07AAACB…', 'Maharashtra (GSTIN not added)', 'No GSTIN in the sheet'. Pure — tested. */
export function returnLineLabel(line: Pick<ClientReturnLine, 'gstin' | 'stateCode'>): string {
  if (line.gstin) return line.gstin;
  if (line.stateCode)
    return `${GST_STATES[line.stateCode] ?? `State ${line.stateCode}`} (GSTIN not added)`;
  return 'No GSTIN in the sheet';
}

/** Lines whose client, GSTIN or state matches the search. Pure — tested. */
export function filterReturnLines(lines: ClientReturnLine[], search: string): ClientReturnLine[] {
  const q = search.trim().toLowerCase();
  if (!q) return lines;
  return lines.filter(
    (l) =>
      l.entityName.toLowerCase().includes(q) ||
      l.entityCode.toLowerCase().includes(q) ||
      returnLineLabel(l).toLowerCase().includes(q),
  );
}

/** Filed and NA marks across the lines. Pure — tested. */
export function returnCounts(lines: ClientReturnLine[]): { filed: number; notApplicable: number } {
  let filed = 0;
  let notApplicable = 0;
  for (const l of lines)
    for (const byForm of Object.values(l.marks))
      for (const m of Object.values(byForm)) {
        if (m === 'filed') filed += 1;
        else if (m === 'not_applicable') notApplicable += 1;
      }
  return { filed, notApplicable };
}

function MarkCell({ mark }: { mark: ReturnMark | undefined }): JSX.Element {
  if (mark === 'filed')
    return (
      <span className="inline-flex items-center gap-0.5 text-success-700" title="Filed">
        <Check className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Filed</span>
      </span>
    );
  if (mark === 'not_applicable')
    return (
      <span className="text-xs text-ink-muted" title="Not applicable">
        NA
      </span>
    );
  return <span className="text-ink-faint">·</span>;
}

export function ReturnsGrid({
  data,
  lines = data.lines,
  showClient = false,
}: {
  data: ClientReturns;
  /** The lines to show (a filtered subset); all by default. */
  lines?: ClientReturnLine[];
  showClient?: boolean;
}): JSX.Element {
  const cell = 'border-l border-line/60 px-1.5 py-1 text-center';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-ink-faint">
          <tr>
            {showClient && <th className="px-2 py-1 text-left font-medium">Client</th>}
            <th className="px-2 py-1 text-left font-medium">GSTIN</th>
            {data.periods.map((p) => (
              <th
                key={p}
                colSpan={data.forms.length}
                className="whitespace-nowrap border-l border-line/60 px-1.5 py-1 text-center font-medium text-ink-muted"
              >
                {returnPeriodLabel(p)}
              </th>
            ))}
          </tr>
          <tr>
            {showClient && <th />}
            <th />
            {data.periods.map((p) => (
              <Fragment key={p}>
                {data.forms.map((f) => (
                  <th key={f} className={`${cell} whitespace-nowrap font-normal`}>
                    {RETURN_FORM_LABEL[f].replace('GSTR-', '')}
                  </th>
                ))}
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr
              key={`${l.entityId}-${l.registrationId ?? l.stateCode ?? ''}`}
              className="border-t border-line/60"
            >
              {showClient && (
                <td className="whitespace-nowrap px-2 py-1">
                  <Link
                    href={`/entities/${l.entityId}`}
                    className="font-medium text-primary-700 hover:underline"
                  >
                    {l.entityName}
                  </Link>
                </td>
              )}
              <td className="whitespace-nowrap px-2 py-1 font-mono text-xs text-ink-muted">
                {returnLineLabel(l)}
              </td>
              {data.periods.map((p) => (
                <Fragment key={p}>
                  {data.forms.map((f) => (
                    <td key={f} className={cell}>
                      <MarkCell mark={l.marks[p]?.[f]} />
                    </td>
                  ))}
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** On the client page: its GST return history, when the workbook had any. */
export function ClientReturnsCard({ entityId }: { entityId: string }): JSX.Element | null {
  const q = useClientReturns(entityId);
  if (!q.data || q.data.lines.length === 0) return null;
  const { filed, notApplicable } = returnCounts(q.data.lines);
  const updated = q.data.lines.reduce((a, l) => (l.updatedAt > a ? l.updatedAt : a), '');
  return (
    <Card id="gst-returns">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>GST returns filed</CardTitle>
        <Link href="/entities/returns" className="text-xs text-primary-700 hover:underline">
          All clients →
        </Link>
      </CardHeader>
      <CardBody className="space-y-2">
        <ReturnsGrid data={q.data} />
        <p className="text-xs text-ink-faint">
          {filed} filed · {notApplicable} NA — as marked in the firm&rsquo;s GST sheet
          {updated && `, imported ${new Date(updated).toLocaleDateString('en-IN')}`}. Import the
          sheet again to refresh.
        </p>
      </CardBody>
    </Card>
  );
}
