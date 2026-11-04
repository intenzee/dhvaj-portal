'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Repeat } from 'lucide-react';
import {
  PERMISSION,
  QUICK_INVOICE_DEFAULT_GST_RATE,
  QUICK_INVOICE_GST_RATES,
  RECURRING_INVOICE_MODE,
  type InvoiceService,
  type QuickInvoiceGstRate,
  type RecurringInvoiceMode,
  type RecurringInvoiceSchedule,
  type SetRecurringInvoiceInput,
  quickInvoiceTotals,
} from '@hsdg/contracts';
import { ApiError, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { ordinal, serviceLabel } from './quick-invoice-row';

export const MODE_LABEL: Record<RecurringInvoiceMode, string> = {
  active: 'Issued automatically',
  manual: 'Draft to check, then issue',
  paused: 'Paused',
};

const inr = (n: number): string =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

/**
 * "₹15,000 + 18% GST (₹17,700) on the 5th · next 5 Dec 2026" — or "Paused".
 * Pure — tested.
 */
export function scheduleSummary(s: RecurringInvoiceSchedule): string {
  const t = quickInvoiceTotals(s.amount, s.gstRate);
  const money = t
    ? s.gstRate === 0
      ? `${inr(t.taxable)}, no GST`
      : `${inr(t.taxable)} + ${s.gstRate}% GST (${inr(t.total)})`
    : s.amount;
  const when =
    s.mode === RECURRING_INVOICE_MODE.paused
      ? 'paused'
      : `on the ${ordinal(s.dayOfMonth)} · next ${formatDate(s.nextRunOn)}`;
  return `${money} ${when}`;
}

/** The form a row opens with: the schedule's values, or defaults for a new one. Pure — tested. */
export function scheduleForm(s: RecurringInvoiceSchedule | null): {
  amount: string;
  gstRate: QuickInvoiceGstRate;
  dayOfMonth: string;
  mode: RecurringInvoiceMode;
} {
  return s
    ? {
        amount: String(Number(s.amount)),
        gstRate: s.gstRate as QuickInvoiceGstRate,
        dayOfMonth: String(s.dayOfMonth),
        mode: s.mode,
      }
    : {
        amount: '',
        gstRate: QUICK_INVOICE_DEFAULT_GST_RATE,
        dayOfMonth: '1',
        mode: RECURRING_INVOICE_MODE.active,
      };
}

/** A day of the month the schedule can keep every month: 1–28. Pure — tested. */
export function validDay(text: string): number | null {
  if (!/^\d{1,2}$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= 1 && n <= 28 ? n : null;
}

/**
 * Quick invoices · monthly: per service on the engagement, the same invoice
 * every month — issued on the day, made a draft to change first (manual), or
 * paused. Managers, partners and billing staff set it; others see it.
 */
export function MonthlyInvoices({ engagementId }: { engagementId: string }): JSX.Element | null {
  const { principal } = useAuth();
  const mayEdit =
    can(principal, PERMISSION.engagementManage) || can(principal, PERMISSION.billingManage);
  const services = useQuery({
    queryKey: ['engagement', engagementId, 'invoice-services'],
    queryFn: () => apiFetch<InvoiceService[]>(`/engagements/${engagementId}/invoice-services`),
  });
  const list = services.data ?? [];
  const scheduled = list.filter((s) => s.schedule);
  if (list.length === 0 || (!mayEdit && scheduled.length === 0)) return null;
  const shown = mayEdit ? list : scheduled;

  return (
    <section data-testid="monthly-invoices">
      <div className="mb-2 flex items-center gap-2">
        <Repeat className="h-4 w-4 text-ink-faint" aria-hidden />
        <h2 className="text-sm font-semibold text-ink">Monthly invoices</h2>
      </div>
      <Card className="divide-y divide-line p-0">
        {shown.map((s) => (
          <ScheduleRow
            key={s.engagementServiceId}
            engagementId={engagementId}
            service={s}
            mayEdit={mayEdit}
          />
        ))}
      </Card>
    </section>
  );
}

function ScheduleRow({
  engagementId,
  service,
  mayEdit,
}: {
  engagementId: string;
  service: InvoiceService;
  mayEdit: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const s = service.schedule;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => scheduleForm(s));
  const day = validDay(form.dayOfMonth);
  const amountOk = quickInvoiceTotals(form.amount, form.gstRate) !== null;
  const path = `/engagements/${engagementId}/invoice-services/${service.engagementServiceId}/schedule`;
  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'invoice-services'] });
  };

  const put = useMutation({
    mutationFn: (body: SetRecurringInvoiceInput) =>
      apiFetch<RecurringInvoiceSchedule>(path, { method: 'PUT', body }),
    onSuccess: (next) => {
      refresh();
      setOpen(false);
      setForm(scheduleForm(next));
      toast(
        next.mode === RECURRING_INVOICE_MODE.paused
          ? 'Monthly invoice paused.'
          : `Monthly invoice set — next on ${formatDate(next.nextRunOn)}.`,
      );
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save.', 'error'),
  });
  const stop = useMutation({
    mutationFn: () => apiFetch(path, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      setOpen(false);
      setForm(scheduleForm(null));
      toast('Monthly invoice stopped.');
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not stop it.', 'error'),
  });

  const withMode = (mode: RecurringInvoiceMode): SetRecurringInvoiceInput => ({
    amount: s!.amount,
    gstRate: s!.gstRate as QuickInvoiceGstRate,
    dayOfMonth: s!.dayOfMonth,
    mode,
    description: s!.description,
  });

  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {mayEdit ? (
          <button
            type="button"
            className="group flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => {
              // Open with the schedule as it is now (it may have been set since).
              if (!open) setForm(scheduleForm(s));
              setOpen(!open);
            }}
            aria-expanded={open}
          >
            <ExpandToggle open={open} />
            <span className="truncate text-sm font-medium text-ink">{serviceLabel(service)}</span>
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            {serviceLabel(service)}
          </span>
        )}
        {s ? (
          <>
            <Badge
              tone={
                s.mode === RECURRING_INVOICE_MODE.paused
                  ? 'neutral'
                  : s.mode === RECURRING_INVOICE_MODE.manual
                    ? 'info'
                    : 'success'
              }
            >
              {MODE_LABEL[s.mode]}
            </Badge>
            <span className="text-xs text-ink-muted">{scheduleSummary(s)}</span>
            {mayEdit && s.mode !== RECURRING_INVOICE_MODE.paused && (
              <Button
                size="sm"
                variant="ghost"
                disabled={put.isPending}
                onClick={() => put.mutate(withMode(RECURRING_INVOICE_MODE.paused))}
              >
                <Pause className="h-3.5 w-3.5" /> Pause
              </Button>
            )}
            {mayEdit && s.mode === RECURRING_INVOICE_MODE.paused && (
              <Button
                size="sm"
                variant="ghost"
                disabled={put.isPending}
                onClick={() => put.mutate(withMode(RECURRING_INVOICE_MODE.active))}
              >
                <Play className="h-3.5 w-3.5" /> Resume
              </Button>
            )}
          </>
        ) : (
          <span className="text-xs text-ink-faint">Not monthly</span>
        )}
      </div>
      {s?.lastError && (
        <p className="mt-1 text-xs text-warning-700">
          Last month’s invoice was not made: {s.lastError}
        </p>
      )}

      {open && mayEdit && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-5">
          <Field label="Amount before GST (₹)">
            <Input
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </Field>
          <Field label="GST">
            <Select
              value={String(form.gstRate)}
              onChange={(e) =>
                setForm((f) => ({ ...f, gstRate: Number(e.target.value) as QuickInvoiceGstRate }))
              }
            >
              {QUICK_INVOICE_GST_RATES.map((r) => (
                <option key={r} value={String(r)}>
                  {r}%
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Day of the month" hint={day ? undefined : '1 to 28, so every month has it.'}>
            <Input
              inputMode="numeric"
              value={form.dayOfMonth}
              onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: e.target.value }))}
            />
          </Field>
          <Field label="On the day" className="sm:col-span-2">
            <Select
              value={form.mode}
              onChange={(e) =>
                setForm((f) => ({ ...f, mode: e.target.value as RecurringInvoiceMode }))
              }
            >
              <option value={RECURRING_INVOICE_MODE.active}>Issue it as is</option>
              <option value={RECURRING_INVOICE_MODE.manual}>Make a draft to change and issue</option>
              <option value={RECURRING_INVOICE_MODE.paused}>Nothing (paused)</option>
            </Select>
          </Field>
          <div className="col-span-full flex flex-wrap justify-end gap-2">
            {s && (
              <Button
                variant="ghost"
                size="sm"
                disabled={stop.isPending}
                onClick={() => stop.mutate()}
              >
                Stop monthly
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!day || !amountOk || put.isPending}
              onClick={() =>
                put.mutate({
                  amount: form.amount.trim(),
                  gstRate: form.gstRate,
                  dayOfMonth: day!,
                  mode: form.mode,
                  description: s?.description ?? null,
                })
              }
            >
              {s ? 'Save' : 'Make monthly'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
