'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { TAX_AUDIT_STAGE_LABEL, formatInr, type TaxAuditBoard } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Badge, EmptyState, Panel, Spinner } from '@/components/ui';
import { Field, Select } from '@/components/form';
import { TAX_AUDITS_KEY } from './keys';
import { yearsAround } from './tax-audit-radar';

/**
 * The year the board opens on: the financial year that ended last March —
 * the year whose reports are being audited, including any now late.
 */
export function boardYear(today: string): string {
  const y = Number(today.slice(0, 4));
  const start = today.slice(5) >= '04-01' ? y - 1 : y - 2;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * The firm's tax audit board (Phase 5, F-9), for the Managing Partner and
 * Partners: how many audits are Not started, In progress and Completed; the
 * ones at risk — a missed internal milestone, or past the due date with the
 * s.271B exposure (0.5% of turnover, up to ₹1.5 lakh); and each partner's
 * reports against the firm's limit.
 */
export function TaxAuditBoardPanel({ today }: { today: string }): JSX.Element {
  const [fy, setFy] = useState(boardYear(today));
  const q = useQuery({
    queryKey: [...TAX_AUDITS_KEY, 'board', fy],
    queryFn: () => apiFetch<TaxAuditBoard>(`/tax-audits/board?financialYear=${fy}`),
  });
  const b = q.data;

  return (
    <Panel
      title="Tax audit board"
      toolbar={
        <Field label="Board year">
          <Select value={fy} onChange={(e) => setFy(e.target.value)}>
            {yearsAround(boardYear(today)).map((y) => (
              <option key={y} value={y}>
                FY {y}
              </option>
            ))}
          </Select>
        </Field>
      }
    >
      {q.isLoading ? (
        <Spinner label="Loading the board…" />
      ) : q.isError || !b ? (
        <EmptyState>Could not load the board.</EmptyState>
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-3 gap-3" aria-label="Audits by stage">
            {(
              [
                ['not_started', 'Not started'],
                ['in_progress', 'In progress'],
                ['completed', 'Completed'],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="rounded border border-line bg-surface px-3 py-2">
                <dt className="text-xs uppercase tracking-wide text-ink-faint">{label}</dt>
                <dd className="text-2xl font-semibold text-ink">{b.counts[k]}</dd>
              </div>
            ))}
          </dl>

          <section aria-label="At risk">
            <h3 className="mb-2 text-sm font-semibold text-ink">
              At risk for the due date ({b.atRisk.length})
              {b.totalExposure > 0 && (
                <span className="ml-2 font-normal text-danger-700">
                  s.271B exposure {formatInr(b.totalExposure)}
                </span>
              )}
            </h3>
            {b.atRisk.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Nothing at risk: every open audit is on its dates.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-ink-faint">
                    <tr>
                      <th className="py-2 pr-3">Client</th>
                      <th className="py-2 pr-3">Stage</th>
                      <th className="py-2 pr-3">Report due</th>
                      <th className="py-2 pr-3">Missed</th>
                      <th className="py-2 pr-3">Signing partner</th>
                      <th className="py-2">s.271B</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {b.atRisk.map((r) => (
                      <tr key={r.auditId}>
                        <td className="py-2 pr-3">
                          <Link
                            href={`/engagements/${r.engagementId}`}
                            className="font-medium text-ink hover:underline"
                          >
                            {r.entityName}
                          </Link>
                          <div className="text-xs text-ink-faint">{r.engagementCode}</div>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge tone="info">{TAX_AUDIT_STAGE_LABEL[r.stage]}</Badge>
                        </td>
                        <td
                          className={
                            r.daysLate !== null
                              ? 'whitespace-nowrap py-2 pr-3 text-danger-700'
                              : 'whitespace-nowrap py-2 pr-3'
                          }
                        >
                          {r.dueDate ? formatDate(r.dueDate) : '—'}
                          {r.daysLate !== null && (
                            <div className="text-xs">
                              {r.daysLate === 1 ? '1 day late' : `${r.daysLate} days late`}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {r.missed.length === 0 ? (
                            '—'
                          ) : (
                            <ul className="space-y-0.5">
                              {r.missed.map((m) => (
                                <li key={m.key}>
                                  {m.label}
                                  <span className="text-xs text-ink-faint">
                                    {' '}
                                    · {formatDate(m.dueOn)}
                                    {m.ownerName ? ` · ${m.ownerName}` : ''}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="py-2 pr-3">{r.signingPartnerName ?? '—'}</td>
                        <td className="whitespace-nowrap py-2">
                          {r.daysLate === null
                            ? '—'
                            : r.exposure !== null
                              ? formatInr(r.exposure)
                              : 'Turnover unknown'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-label="Partner load">
            <h3 className="mb-2 text-sm font-semibold text-ink">
              Reports per partner (limit {b.limit})
            </h3>
            {b.partners.length === 0 ? (
              <p className="text-sm text-ink-muted">No partners yet.</p>
            ) : (
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {b.partners.map((p) => (
                  <li
                    key={p.employeeId}
                    className={p.reports >= b.limit ? 'font-medium text-danger-700' : 'text-ink'}
                  >
                    {p.summary}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Panel>
  );
}
