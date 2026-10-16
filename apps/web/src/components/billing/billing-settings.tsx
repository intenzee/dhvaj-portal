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

/** The settings the PATCH sends: only what changed, with the version read. Pure — tested. */
export function settingsChanges(
  before: BillingSettings,
  form: {
    gstin: string;
    stateCode: string;
    sacDefault: string;
    invoicePrefix: string;
    invoiceTermsDays: string;
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
  return out;
}

/** PS-201 · who the firm is on its tax invoices (Billing page; partners edit). */
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
  });
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
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
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
            <div className="col-span-full flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
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
