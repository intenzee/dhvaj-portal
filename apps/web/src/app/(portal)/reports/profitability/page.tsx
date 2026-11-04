'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download } from 'lucide-react';
import {
  PERMISSION,
  PROFITABILITY_BOTTOM,
  PROFITABILITY_BY,
  PROFITABILITY_BY_LABEL,
  lastQuarter,
  type Paginated,
  type ProfitabilityBy,
  type ProfitabilityMeasures,
  type ProfitabilityQuery,
} from '@hsdg/contracts';
import { apiFetch, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { cn } from '@/lib/cn';
import { formatDate, formatMoney } from '@/lib/format';
import { istToday } from '@/lib/people';
import type { EngagementLeadRow, OfficeRow } from '@/lib/types';
import {
  fetchProfitability,
  profitabilityKey,
  profitabilityPath,
} from '@/lib/practice-finance-api';
import { periodPresets } from '@/components/reports/profitability-period';
import { RateCardsEditor } from '@/components/reports/rate-cards-editor';
import { EntityPicker, type Picked } from '@/components/entity-picker';
import { Field, Input, Select } from '@/components/form';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Spinner,
} from '@/components/ui';
import { ExpandToggle } from '@/components/inline-panel';

interface ServiceOption {
  id: string;
  name: string;
}

/** PS-302 — margins per client, engagement, service, partner and month. */
export default function ProfitabilityPage(): JSX.Element {
  const { principal } = useAuth();
  const allowed = can(principal, PERMISSION.practiceFinance);
  const today = istToday();
  const [q, setQ] = useState<ProfitabilityQuery>(() => ({
    ...lastQuarter(today),
    by: 'client',
  }));
  const [client, setClient] = useState<Picked | null>(null);
  const [ratesOpen, setRatesOpen] = useState(false);
  const query: ProfitabilityQuery = { ...q, entityId: client?.id };

  const report = useQuery({
    queryKey: [...profitabilityKey, query],
    queryFn: () => fetchProfitability(query),
    enabled: allowed,
  });
  const partners = useQuery({
    queryKey: ['employees', 'leads'],
    queryFn: () => apiFetch<EngagementLeadRow[]>('/employees/leads'),
    enabled: allowed,
  });
  const offices = useQuery({
    queryKey: ['admin', 'offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
    enabled: allowed,
  });
  const services = useQuery({
    queryKey: ['services', 'options'],
    queryFn: () => apiFetch<Paginated<ServiceOption>>('/services?limit=100'),
    enabled: allowed,
  });

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Profitability" back={{ href: '/reports', label: 'Reports & MIS' }} />
        <EmptyState>
          Rates, realisation and margins are for the Managing Partner and the partners.
        </EmptyState>
      </div>
    );
  }

  const set = <K extends keyof ProfitabilityQuery>(k: K, v: ProfitabilityQuery[K]) =>
    setQ((cur) => ({ ...cur, [k]: v || undefined }));
  const by = (q.by ?? 'client') as ProfitabilityBy;
  const r = report.data;

  return (
    <div>
      <PageHeader
        title="Profitability"
        subtitle="Time cost at each person’s rate on the day, standard value at charge-out, what was billed and collected (ex-GST), and the margin — across the engagements you can see."
        back={{ href: '/reports', label: 'Reports & MIS' }}
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              void downloadFile(
                profitabilityPath(query, '/reports/profitability/csv'),
                `profitability-${by}-${q.from}-${q.to}.csv`,
              )
            }
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <Card className="mb-4">
        <CardBody>
          <div className="mb-3 flex flex-wrap gap-2" aria-label="Period">
            {periodPresets(today).map((p) => {
              const on = p.from === q.from && p.to === q.to;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setQ((cur) => ({ ...cur, from: p.from, to: p.to }))}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium',
                    on
                      ? 'border-primary-600 bg-primary-600 text-white'
                      : 'border-line-strong text-ink-muted hover:text-ink',
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="From">
              <Input
                type="date"
                value={q.from ?? ''}
                onChange={(e) => set('from', e.target.value)}
                aria-label="From"
              />
            </Field>
            <Field label="To">
              <Input
                type="date"
                value={q.to ?? ''}
                onChange={(e) => set('to', e.target.value)}
                aria-label="To"
              />
            </Field>
            <Field label="By">
              <Select
                value={by}
                onChange={(e) => set('by', e.target.value as ProfitabilityBy)}
                aria-label="By"
              >
                {PROFITABILITY_BY.map((b) => (
                  <option key={b} value={b}>
                    {PROFITABILITY_BY_LABEL[b]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Partner">
              <Select
                value={q.partnerId ?? ''}
                onChange={(e) => set('partnerId', e.target.value)}
                aria-label="Partner"
              >
                <option value="">All</option>
                {(partners.data ?? [])
                  .filter((p) => p.isPartner)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} · {p.officeCode}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Office">
              <Select
                value={q.officeId ?? ''}
                onChange={(e) => set('officeId', e.target.value)}
                aria-label="Office"
              >
                <option value="">All</option>
                {(offices.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code} · {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Service">
              <Select
                value={q.serviceId ?? ''}
                onChange={(e) => set('serviceId', e.target.value)}
                aria-label="Service"
              >
                <option value="">All</option>
                {(services.data?.items ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Client" className="sm:col-span-2">
              <EntityPicker value={client} onChange={setClient} exclude={new Set()} />
            </Field>
          </div>
        </CardBody>
      </Card>

      {report.isLoading ? (
        <Spinner label="Working out margins…" />
      ) : report.isError || !r ? (
        <EmptyState>
          {report.error instanceof Error ? report.error.message : 'The report could not load.'}
        </EmptyState>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              By {PROFITABILITY_BY_LABEL[r.by].toLowerCase()} · {formatDate(r.from)} to{' '}
              {formatDate(r.to)}
            </CardTitle>
          </CardHeader>
          <CardBody>
            {r.unratedPeople.length > 0 && (
              <p
                role="status"
                className="mb-3 flex items-start gap-2 rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-800"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  No rate was in force for {r.unratedPeople.join(', ')} on some days — those hours (
                  {r.totals.unratedHours}h) are costed at nothing. Set their grade’s card below.
                </span>
              </p>
            )}
            {r.rows.length === 0 ? (
              <EmptyState>No time, bills or receipts in this period for these filters.</EmptyState>
            ) : (
              <>
                {r.rows.length > PROFITABILITY_BOTTOM && (
                  <p className="mb-2 text-xs text-ink-muted">
                    Highlighted: the {PROFITABILITY_BOTTOM} lowest margins, and any loss.
                  </p>
                )}
                <div className="scroll-slim overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                        <th className="py-2 pr-4 font-semibold">{PROFITABILITY_BY_LABEL[r.by]}</th>
                        <th className="py-2 pr-4 text-right font-semibold">Hours</th>
                        <th className="py-2 pr-4 text-right font-semibold">Time cost</th>
                        <th className="py-2 pr-4 text-right font-semibold">Standard</th>
                        <th className="py-2 pr-4 text-right font-semibold">Billed</th>
                        <th className="py-2 pr-4 text-right font-semibold">Collected</th>
                        <th
                          className="py-2 pr-4 text-right font-semibold"
                          title="Billed ÷ standard value"
                        >
                          Realisation
                        </th>
                        <th
                          className="py-2 pr-4 text-right font-semibold"
                          title="Collected ÷ billed"
                        >
                          Collection
                        </th>
                        <th className="py-2 pr-4 text-right font-semibold">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.rows.map((row) => (
                        <tr
                          key={row.key}
                          className={cn(
                            'border-b border-line last:border-0',
                            row.bottom && 'bg-danger-50/60',
                          )}
                        >
                          <td className="py-2 pr-4">
                            <span className="block font-medium text-ink">{row.label}</span>
                            {row.sub && (
                              <span className="block text-xs text-ink-faint">{row.sub}</span>
                            )}
                            {row.unratedHours > 0 && (
                              <Badge tone="warn">{row.unratedHours}h unrated</Badge>
                            )}
                          </td>
                          <Measures m={row} />
                        </tr>
                      ))}
                      <tr className="border-t-2 border-line-strong font-semibold">
                        <td className="py-2 pr-4 text-ink">Total</td>
                        <Measures m={r.totals} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader>
          <button
            type="button"
            className="group flex w-full items-center gap-2 text-left"
            onClick={() => setRatesOpen((o) => !o)}
            aria-expanded={ratesOpen}
          >
            <ExpandToggle open={ratesOpen} />
            <CardTitle>Rate cards and working calendar</CardTitle>
          </button>
        </CardHeader>
        {ratesOpen && (
          <CardBody>
            <RateCardsEditor today={today} />
          </CardBody>
        )}
      </Card>
    </div>
  );
}

function pctText(v: number | null): string {
  return v === null ? '—' : `${v}%`;
}

function Measures({ m }: { m: ProfitabilityMeasures }): JSX.Element {
  const loss = Number(m.margin) < 0;
  return (
    <>
      <td className="py-2 pr-4 text-right tabular-nums">
        {m.hours}
        <span className="block text-xs font-normal text-ink-faint">{m.billableHours} billable</span>
      </td>
      <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(m.timeCost)}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(m.standardValue)}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(m.billed)}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(m.collected)}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{pctText(m.realisationPct)}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{pctText(m.collectionPct)}</td>
      <td
        className={cn('py-2 pr-4 text-right tabular-nums', loss && 'font-semibold text-danger-700')}
      >
        {formatMoney(m.margin)}
        {m.marginPct !== null && (
          <span className="block text-xs font-normal text-ink-faint">{m.marginPct}%</span>
        )}
      </td>
    </>
  );
}
