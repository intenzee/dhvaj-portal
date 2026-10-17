'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GST_STATES, PERMISSION, type BillingSettings } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Button, Card, CardBody, CardHeader, CardTitle } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';
import { billingSettingsQuery, stateLabel } from './invoice-gst';

/**
 * "7, 15, 30" → [7, 15, 30]: once each, ascending; null when a day is not a
 * whole number from 1 to 365 or there are more than six. Pure — tested.
 */
export function parseReminderDays(text: string): number[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  if (parts.some((p) => !/^\d+$/.test(p))) return null;
  const days = [...new Set(parts.map(Number))].sort((a, b) => a - b);
  if (days.length > 6 || days.some((d) => d < 1 || d > 365)) return null;
  return days;
}

/** The settings the PATCH sends: only what changed, with the version read. Pure — tested. */
export function settingsChanges(
  before: BillingSettings,
  form: {
    gstin: string;
    stateCode: string;
    sacDefault: string;
    invoicePrefix: string;
    invoiceTermsDays: string;
    invoiceReminderDays?: string;
    autoInvoiceReminders?: boolean;
  },
): Record<string, unknown> {
  const out: Record<string, unknown> = { version: before.version };
  const gstin = form.gstin.trim().toUpperCase() || null;
  if (gstin !== before.gstin) out.gstin = gstin;
  const stateCode = gstin ? gstin.slice(0, 2) : form.stateCode || null;
  if (stateCode !== before.stateCode) out.stateCode = stateCode;
  if (form.sacDefault.trim() !== before.sacDefault) out.sacDefault = form.sacDefault.trim();
  const prefix = form.invoicePrefix.trim().toUpperCase();
  if (prefix !== before.invoicePrefix) out.invoicePrefix = prefix;
  const days = Number(form.invoiceTermsDays);
  if (days !== before.invoiceTermsDays) out.invoiceTermsDays = days;
  if (form.invoiceReminderDays !== undefined) {
    const reminders = parseReminderDays(form.invoiceReminderDays);
    if (reminders && reminders.join() !== before.invoiceReminderDays.join()) {
      out.invoiceReminderDays = reminders;
    }
  }
  if (
    form.autoInvoiceReminders !== undefined &&
    form.autoInvoiceReminders !== before.autoInvoiceReminders
  ) {
    out.autoInvoiceReminders = form.autoInvoiceReminders;
  }
  return out;
}

/**
 * PS-201 · who the firm is on its tax invoices (Billing page; partners edit);
 * PS-203 · whether clients are e-mailed payment reminders, and on which days.
 */
export function BillingSettingsCard({ settings }: { settings: BillingSettings }): JSX.Element {
  const { principal } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    gstin: settings.gstin ?? '',
    stateCode: settings.stateCode ?? '',
    sacDefault: settings.sacDefault,
    invoicePrefix: settings.invoicePrefix,
    invoiceTermsDays: String(settings.invoiceTermsDays),
    invoiceReminderDays: settings.invoiceReminderDays.join(', '),
    autoInvoiceReminders: settings.autoInvoiceReminders,
  });
  const reminderDays = parseReminderDays(form.invoiceReminderDays);
  const save = useMutation({
    mutationFn: () =>
      apiFetch<BillingSettings>('/billing/settings', {
        method: 'PATCH',
        body: settingsChanges(settings, form),
      }),
    onSuccess: (next) => {
      qc.setQueryData(billingSettingsQuery.queryKey, next);
      toast('Billing settings saved.');
      setEditing(false);
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save.', 'error'),
  });
  const set =
    (k: Exclude<keyof typeof form, 'autoInvoiceReminders'>) => (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Card className="mb-4">
      <CardHeader className="flex items-center justify-between">
        <CardTitle>On our invoices</CardTitle>
        {can(principal, PERMISSION.billingApprove) && !editing && (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Change
          </Button>
        )}
      </CardHeader>
      <CardBody>
        {!editing ? (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <Item label="GSTIN" value={settings.gstin ?? 'Not set'} />
            <Item label="State" value={stateLabel(settings.stateCode)} />
            <Item label="SAC" value={settings.sacDefault} />
            <Item label="Numbers" value={`${settings.invoicePrefix}/YY-YY/0001`} />
            <Item label="Payment terms" value={`${settings.invoiceTermsDays} days`} />
            <div className="col-span-full">
              <Item
                label="Payment reminders"
                value={
                  settings.autoInvoiceReminders
                    ? `Clients e-mailed ${settings.invoiceReminderDays.join(', ')} days past due`
                    : 'Sent by hand from the invoice'
                }
              />
            </div>
            {!settings.stateCode && (
              <p className="col-span-full text-xs text-warning-700">
                Set the firm’s GSTIN to charge CGST + SGST or IGST from each line’s rate.
              </p>
            )}
          </dl>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            <Field label="GSTIN">
              <Input value={form.gstin} onChange={set('gstin')} maxLength={15} />
            </Field>
            <Field label="State">
              <Select
                value={form.gstin.length >= 2 ? form.gstin.slice(0, 2) : form.stateCode}
                onChange={set('stateCode')}
                disabled={form.gstin.trim().length > 0}
              >
                <option value="">—</option>
                {Object.entries(GST_STATES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name} ({code})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Default SAC">
              <Input value={form.sacDefault} onChange={set('sacDefault')} maxLength={8} />
            </Field>
            <Field label="Number prefix">
              <Input value={form.invoicePrefix} onChange={set('invoicePrefix')} maxLength={5} />
            </Field>
            <Field label="Payment terms (days)">
              <Input
                inputMode="numeric"
                value={form.invoiceTermsDays}
                onChange={set('invoiceTermsDays')}
              />
            </Field>
            <div className="col-span-full grid grid-cols-1 gap-3 sm:grid-cols-5">
              <label className="flex items-center gap-2 text-sm text-ink sm:col-span-3">
                <input
                  type="checkbox"
                  checked={form.autoInvoiceReminders}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, autoInvoiceReminders: e.target.checked }))
                  }
                />
                E-mail clients a payment reminder automatically (when the firm reminds clients by
                e-mail)
              </label>
              <Field
                label="Reminder days past due"
                hint={reminderDays ? 'Comma-separated' : 'Up to six days, each 1 to 365.'}
              >
                <Input
                  value={form.invoiceReminderDays}
                  onChange={set('invoiceReminderDays')}
                  placeholder="7, 15, 30"
                />
              </Field>
            </div>
            <div className="col-span-full flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending || !reminderDays}>
                Save
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Item({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
