'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TAX_AUDIT_STAGE_LABEL,
  type TaxAuditApplicability,
  type TaxAuditRow,
  type TaxAuditStage,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Badge, Button, EmptyState, Panel, Spinner } from '@/components/ui';
import { AcceptanceDesk } from './acceptance-desk';
import { ApplicabilityForm } from './applicability-form';
import { MilestonesPanel } from './milestones-panel';
import { TAX_AUDITS_KEY } from './keys';

export { TAX_AUDITS_KEY };

const STAGE_TONE: Record<TaxAuditStage, string> = {
  not_started: 'neutral',
  acceptance: 'info',
  information: 'info',
  clause_work: 'info',
  review: 'info',
  signed: 'info',
  uploaded: 'info',
  client_accepted: 'info',
  filed: 'success',
  not_applicable: 'neutral',
};

/** "31 Oct 2027 · 12 days left" / "31 Oct 2027 · 3 days overdue" / "31 Oct 2027". */
export function dueText(a: Pick<TaxAuditRow, 'dueDate' | 'daysLeft'>): string {
  if (!a.dueDate) return '—';
  const due = formatDate(a.dueDate);
  if (a.daysLeft === null) return due;
  if (a.daysLeft === 0) return `${due} · due today`;
  const n = Math.abs(a.daysLeft);
  const days = n === 1 ? '1 day' : `${n} days`;
  return a.daysLeft > 0 ? `${due} · ${days} left` : `${due} · ${days} overdue`;
}

/** "FY 2026-27" / "FY 2026-27 · revised 1". */
export const yearOf = (a: Pick<TaxAuditRow, 'financialYear' | 'revision'>): string =>
  a.revision > 0 ? `FY ${a.financialYear} · revised ${a.revision}` : `FY ${a.financialYear}`;

type OpenPanel = 'applicability' | 'acceptance' | 'milestones';

/**
 * Tax Audit (Phase 3, F-1): one row a year — stage, form, signing partner,
 * the report's due date, client acceptance, UDIN and filing. "Applicability"
 * opens the year's calculator and override (F-2); "Acceptance" the year's
 * acceptance desk (F-3); "Milestones" the internal dates counted back from the
 * due date (F-9). The year's report filing
 * itself, with its documents, sits in the stream below.
 */
export function TaxAuditTab({ engagementId }: { engagementId: string }): JSX.Element {
  const q = useQuery({
    queryKey: [...TAX_AUDITS_KEY, 'engagement', engagementId],
    queryFn: () => apiFetch<TaxAuditRow[]>(`/engagements/${engagementId}/tax-audits`),
  });
  const [open, setOpen] = useState<string | null>(null);
  const [panel, setPanel] = useState<OpenPanel>('applicability');
  const toggle = (id: string, which: OpenPanel): void => {
    const same = open === id && panel === which;
    setOpen(same ? null : id);
    setPanel(which);
  };
  const decisions = useQuery({
    queryKey: [...TAX_AUDITS_KEY, 'applicability', engagementId],
    queryFn: () =>
      apiFetch<TaxAuditApplicability[]>(`/engagements/${engagementId}/tax-audit-applicability`),
    enabled: open !== null && panel === 'applicability',
  });

  return (
    <Panel title="Tax audit by year">
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <EmptyState>Could not load the tax audits.</EmptyState>
      ) : !q.data?.length ? (
        <EmptyState>
          No tax audit on this engagement yet. A year gets one when the report is on its calendar.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="py-2 pr-3">Year</th>
                <th className="py-2 pr-3">Stage</th>
                <th className="py-2 pr-3">Form</th>
                <th className="py-2 pr-3">Signing partner</th>
                <th className="py-2 pr-3">Report due</th>
                <th className="py-2 pr-3">Client</th>
                <th className="py-2 pr-3">UDIN</th>
                <th className="py-2">Filed on</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.map((a) => (
                <Fragment key={a.id}>
                  <tr>
                    <td className="py-2 pr-3 font-medium text-ink">
                      <span className="whitespace-nowrap">{yearOf(a)}</span>
                      {a.applicabilityReason && (
                        <div className="text-xs font-normal text-ink-faint">
                          {a.applicabilityReason}
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-expanded={open === a.id && panel === 'applicability'}
                        onClick={() => toggle(a.id, 'applicability')}
                      >
                        Applicability
                      </Button>
                      {a.stage !== 'not_applicable' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={open === a.id && panel === 'acceptance'}
                          onClick={() => toggle(a.id, 'acceptance')}
                        >
                          Acceptance
                        </Button>
                      )}
                      {a.stage !== 'not_applicable' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={open === a.id && panel === 'milestones'}
                          onClick={() => toggle(a.id, 'milestones')}
                        >
                          Milestones
                        </Button>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={STAGE_TONE[a.stage]}>{TAX_AUDIT_STAGE_LABEL[a.stage]}</Badge>
                    </td>
                    <td className="py-2 pr-3">{a.formType ? `Form ${a.formType}` : '—'}</td>
                    <td className="py-2 pr-3">{a.signingPartnerName ?? '—'}</td>
                    <td
                      className={
                        a.daysLeft !== null && a.daysLeft < 0
                          ? 'whitespace-nowrap py-2 pr-3 text-danger-700'
                          : 'whitespace-nowrap py-2 pr-3'
                      }
                    >
                      {dueText(a)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">
                      {a.clientRejectedOn
                        ? `Rejected ${formatDate(a.clientRejectedOn)}`
                        : a.clientAcceptedOn
                          ? `Accepted ${formatDate(a.clientAcceptedOn)}`
                          : '—'}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{a.udin ?? '—'}</td>
                    <td className="whitespace-nowrap py-2">
                      {a.filedOn ? formatDate(a.filedOn) : '—'}
                      {a.acknowledgementNo && (
                        <div className="text-xs text-ink-faint">Ack {a.acknowledgementNo}</div>
                      )}
                    </td>
                  </tr>
                  {open === a.id && (
                    <tr>
                      <td colSpan={8} className="bg-surface-sunken px-3 py-4">
                        {panel === 'acceptance' ? (
                          <AcceptanceDesk engagementId={engagementId} auditId={a.id} />
                        ) : panel === 'milestones' ? (
                          <MilestonesPanel engagementId={engagementId} auditId={a.id} />
                        ) : decisions.isLoading ? (
                          <Spinner />
                        ) : (
                          <ApplicabilityForm
                            key={`${a.financialYear}:${decisions.dataUpdatedAt}`}
                            engagementId={engagementId}
                            financialYear={a.financialYear}
                            decision={
                              decisions.data?.find((d) => d.financialYear === a.financialYear) ??
                              null
                            }
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
  );
}
