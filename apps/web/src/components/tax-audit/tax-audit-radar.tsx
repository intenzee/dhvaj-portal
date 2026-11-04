'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TAX_AUDIT_STAGE_LABEL,
  type TaxAuditApplicability,
  type TaxAuditRadarBasis,
  type TaxAuditRadarRow,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, EmptyState, Panel, Spinner } from '@/components/ui';
import { Field, Select } from '@/components/form';
import { ApplicabilityForm } from './applicability-form';
import { TAX_AUDITS_KEY } from './keys';

/**
 * The year whose reports are due next: up to 30 September of a year, the year
 * that ended that March; after it, the year now running.
 */
export function radarYear(today: string): string {
  const y = Number(today.slice(0, 4));
  const start = today.slice(5) <= '09-30' ? y - 1 : y;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const yearsAround = (fy: string): string[] => {
  const start = Number(fy.slice(0, 4));
  return [start + 1, start, start - 1, start - 2].map(
    (s) => `${s}-${String((s + 1) % 100).padStart(2, '0')}`,
  );
};

const BASIS_LABEL: Record<TaxAuditRadarBasis, string> = {
  decided: 'Worked out',
  pan_profile: 'PAN profile',
  turnover: 'Turnover',
};

/** "12 days left" / "3 days overdue" / "due today". */
export function daysText(days: number): string {
  if (days === 0) return 'due today';
  const n = Math.abs(days);
  return `${n === 1 ? '1 day' : `${n} days`} ${days > 0 ? 'left' : 'overdue'}`;
}

/**
 * Tax audit radar (Phase 3, F-2): every client the caller can see that is
 * likely to need a tax audit for the year, with the reason — the year's
 * decision, else the PAN profile, else turnover over ₹1 crore — and whether
 * Tax Audit is in its scope. Likely clients not yet in scope come first.
 */
export function TaxAuditRadar({ today }: { today: string }): JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const [fy, setFy] = useState(radarYear(today));
  const [onlyNotInScope, setOnlyNotInScope] = useState(false);
  const [everyClient, setEveryClient] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const radar = useQuery({
    queryKey: [...TAX_AUDITS_KEY, 'radar', fy, everyClient],
    queryFn: () =>
      apiFetch<TaxAuditRadarRow[]>(
        `/tax-audits/radar?financialYear=${fy}${everyClient ? '&all=true' : ''}`,
      ),
  });
  const decisions = useQuery({
    queryKey: [...TAX_AUDITS_KEY, 'applicability', open],
    queryFn: () =>
      apiFetch<TaxAuditApplicability[]>(`/engagements/${open}/tax-audit-applicability`),
    enabled: open !== null,
  });

  const addToScope = useMutation({
    mutationFn: (r: TaxAuditRadarRow) =>
      apiFetch(`/engagements/${r.engagementId}/years/${r.financialYear}/streams`, {
        method: 'PATCH',
        body: { add: ['tax_audit'], version: r.yearVersion },
      }),
    onSuccess: (_res, r) => {
      toast(`Tax Audit added to ${r.entityName} for FY ${r.financialYear}.`, 'success');
      void qc.invalidateQueries({ queryKey: TAX_AUDITS_KEY });
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not add Tax Audit.', 'error'),
  });

  const rows = (radar.data ?? []).filter((r) => !onlyNotInScope || (r.likely && !r.inScope));
  const waiting = (radar.data ?? []).filter((r) => r.likely && !r.inScope).length;

  return (
    <div className="space-y-6">
      <Panel
        title={`FY ${fy}`}
        action={waiting > 0 ? <Badge tone="warn">{waiting} likely, not in scope</Badge> : undefined}
        toolbar={
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Year">
              <Select value={fy} onChange={(e) => setFy(e.target.value)}>
                {yearsAround(radarYear(today)).map((y) => (
                  <option key={y} value={y}>
                    FY {y}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 pb-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={onlyNotInScope}
                onChange={(e) => setOnlyNotInScope(e.target.checked)}
              />
              Only those not yet in scope
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={everyClient}
                onChange={(e) => setEveryClient(e.target.checked)}
              />
              Every client, to work one out
            </label>
          </div>
        }
      >
        {radar.isLoading ? (
          <Spinner />
        ) : radar.isError ? (
          <EmptyState>Could not load the radar.</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>
            No client on your engagements looks likely to need a tax audit for FY {fy}.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Why</th>
                  <th className="py-2 pr-3">Report due</th>
                  <th className="py-2 pr-3">Tax Audit</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <Fragment key={r.engagementId}>
                    <tr className={r.alert ? 'bg-warning-50' : undefined}>
                      <td className="py-2 pr-3">
                        <Link
                          href={`/engagements/${r.engagementId}?tab=${r.inScope ? 'tax_audit' : 'overview'}`}
                          className="text-ink hover:text-primary-600"
                        >
                          {r.entityName}
                        </Link>
                        <div className="text-xs text-ink-faint">{r.engagementCode}</div>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={r.likely ? 'warn' : 'neutral'}>
                          {r.likely ? 'Likely' : 'Not needed'} · {BASIS_LABEL[r.basis]}
                        </Badge>
                        <div className="mt-1 text-xs text-ink-muted">{r.reason}</div>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        {formatDate(r.dueDate)}
                        <div
                          className={
                            r.daysToDue < 0 ? 'text-xs text-danger-700' : 'text-xs text-ink-faint'
                          }
                        >
                          {daysText(r.daysToDue)}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        {r.inScope ? (
                          <Badge tone="info">
                            {r.stage ? TAX_AUDIT_STAGE_LABEL[r.stage] : 'In scope'}
                          </Badge>
                        ) : r.booksKept ? (
                          <span className="text-xs text-ink-muted">
                            The firm keeps the books: another auditor signs.
                          </span>
                        ) : (
                          <span className="text-xs text-ink-faint">Not in scope</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-expanded={open === r.engagementId}
                            onClick={() => setOpen(open === r.engagementId ? null : r.engagementId)}
                          >
                            Work it out
                          </Button>
                          {r.likely && !r.inScope && !r.booksKept && (
                            <Button
                              size="sm"
                              disabled={addToScope.isPending}
                              onClick={() => addToScope.mutate(r)}
                            >
                              Add Tax Audit
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {open === r.engagementId && (
                      <tr>
                        <td colSpan={5} className="bg-surface-sunken px-3 py-4">
                          {decisions.isLoading ? (
                            <Spinner />
                          ) : (
                            <ApplicabilityForm
                              key={`${r.engagementId}:${fy}:${decisions.dataUpdatedAt}`}
                              engagementId={r.engagementId}
                              financialYear={fy}
                              decision={decisions.data?.find((d) => d.financialYear === fy) ?? null}
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
