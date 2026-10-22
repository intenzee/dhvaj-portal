'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
  PERMISSION,
  ROLE,
  type Paginated,
  type PayRules,
  type PaySettingsRecord,
  type PtSlab,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import type { AdminUserRow } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { can, hasRole } from '@/lib/principal';
import { formatDate } from '@/lib/format';
import { errorText, usePayAction } from '@/lib/payroll';
import { Button, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';

/**
 * Statutory rates are settings, not code (spec §4.8): HR confirms them from a
 * date each April, and every run uses the rules in force on its month.
 */
export default function PayrollSettingsPage(): JSX.Element {
  const { principal } = useAuth();
  const settings = useQuery({
    queryKey: ['payroll', 'settings'],
    queryFn: () => apiFetch<PaySettingsRecord>('/payroll/settings'),
    retry: false,
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Payroll settings"
        subtitle="PF, ESI, professional tax, gratuity and the articles’ stipend minimum. A change applies from its date; earlier months keep the rules they ran on."
        back={{ href: '/payroll', label: 'Payroll' }}
      />
      {hasRole(principal, ROLE.managingPartner) && <Approver />}
      {settings.isLoading ? (
        <Spinner />
      ) : settings.error || !settings.data ? (
        <EmptyState>{errorText(settings.error)}</EmptyState>
      ) : (
        <RulesForm record={settings.data} editable={can(principal, PERMISSION.payrollPrepare)} />
      )}
    </div>
  );
}

function Approver(): JSX.Element {
  const approvers = useQuery({
    queryKey: ['payroll', 'approvers'],
    queryFn: () => apiFetch<{ userId: string; displayName: string }[]>('/payroll/approvers'),
  });
  const users = useQuery({
    queryKey: ['users', 'for-approver'],
    queryFn: () => apiFetch<Paginated<AdminUserRow>>('/users?limit=100'),
  });
  const [pick, setPick] = useState('');
  const set = usePayAction(
    () => apiFetch<void>('/payroll/approvers', { method: 'PUT', body: { userId: pick } }),
    'Alternate approver named.',
  );
  const clear = usePayAction(
    () => apiFetch<void>('/payroll/approvers', { method: 'DELETE' }),
    'Alternate approver removed.',
  );
  const current = approvers.data?.[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Alternate approver</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3 text-sm">
        <p className="text-ink-muted">
          You approve pay. You may name one other person to approve when you are away; they then see pay too.
          Whoever prepares a run can never approve it.
        </p>
        <p>
          Now: <span className="font-medium text-ink">{current ? current.displayName : 'nobody'}</span>
          {current && (
            <Button size="sm" variant="ghost" className="ml-2" disabled={clear.isPending} onClick={() => clear.mutate(undefined)}>
              Remove
            </Button>
          )}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Name someone">
            <Select className="w-72" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose…</option>
              {(users.data?.items ?? [])
                .filter((u) => u.isActive)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
            </Select>
          </Field>
          <Button disabled={!pick || set.isPending} onClick={() => set.mutate(undefined, { onSuccess: () => setPick('') })}>
            Name as alternate
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

const RATE = /^\d{1,2}(\.\d{1,4})?$/;
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

function RulesForm({ record, editable }: { record: PaySettingsRecord; editable: boolean }): JSX.Element {
  const [rules, setRules] = useState<PayRules>(record.rules);
  const [from, setFrom] = useState(record.effectiveFrom);
  useEffect(() => {
    setRules(record.rules);
    setFrom(record.effectiveFrom);
  }, [record]);
  const save = usePayAction(
    () =>
      apiFetch<PaySettingsRecord>('/payroll/settings', {
        method: 'POST',
        body: { effectiveFrom: from, rules },
      }),
    (r) => `Confirmed from ${formatDate(r.effectiveFrom)}.`,
  );
  const offices = Array.from(
    new Set([...Object.keys(rules.ptSlabsByOffice), ...Object.keys(rules.stipendMinimumByOffice)]),
  ).sort();
  const rates = [
    rules.pf.employeeRate,
    rules.pf.employerRate,
    rules.pf.epsRate,
    rules.pf.edliRate ?? '0.5',
    rules.pf.adminRate ?? '0.5',
    rules.esi.employeeRate,
    rules.esi.employerRate,
    rules.gratuityRate,
  ];
  const amounts = [
    rules.pf.wageCeiling,
    rules.esi.grossThreshold,
    ...Object.values(rules.stipendMinimumByOffice),
    ...Object.values(rules.ptSlabsByOffice).flatMap((s) => s.flatMap((x) => [x.from, x.amount])),
  ];
  const valid = !!from && rates.every((r) => RATE.test(r)) && amounts.every((a) => AMOUNT.test(a));

  const field = (label: string, value: string, onChange: (v: string) => void, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input className="w-32 text-right" inputMode="decimal" disabled={!editable} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
  const flag = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" disabled={!editable} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
  const setSlabs = (office: string, slabs: PtSlab[]) =>
    setRules((r) => ({ ...r, ptSlabsByOffice: { ...r.ptSlabsByOffice, [office]: slabs } }));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Provident Fund and ESI</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-4">
            {field('PF — employee %', rules.pf.employeeRate, (v) => setRules((r) => ({ ...r, pf: { ...r.pf, employeeRate: v } })))}
            {field('PF — firm %', rules.pf.employerRate, (v) => setRules((r) => ({ ...r, pf: { ...r.pf, employerRate: v } })))}
            {field('Of which pension %', rules.pf.epsRate, (v) => setRules((r) => ({ ...r, pf: { ...r.pf, epsRate: v } })))}
            {field('EDLI %', rules.pf.edliRate ?? '0.5', (v) => setRules((r) => ({ ...r, pf: { ...r.pf, edliRate: v } })))}
            {field('PF admin charges %', rules.pf.adminRate ?? '0.5', (v) => setRules((r) => ({ ...r, pf: { ...r.pf, adminRate: v } })))}
            {field('PF wage ceiling ₹', rules.pf.wageCeiling, (v) => setRules((r) => ({ ...r, pf: { ...r.pf, wageCeiling: v } })))}
          </div>
          {flag('The firm contributes on full PF wages, not just up to the ceiling', rules.pf.onFullWages, (v) =>
            setRules((r) => ({ ...r, pf: { ...r.pf, onFullWages: v } })),
          )}
          <div className="flex flex-wrap gap-4">
            {field('ESI — employee %', rules.esi.employeeRate, (v) => setRules((r) => ({ ...r, esi: { ...r.esi, employeeRate: v } })))}
            {field('ESI — firm %', rules.esi.employerRate, (v) => setRules((r) => ({ ...r, esi: { ...r.esi, employerRate: v } })))}
            {field('Covered up to ₹ gross', rules.esi.grossThreshold, (v) => setRules((r) => ({ ...r, esi: { ...r.esi, grossThreshold: v } })))}
            {field('Gratuity provision %', rules.gratuityRate, (v) => setRules((r) => ({ ...r, gratuityRate: v })))}
          </div>
          {flag('Labour Codes: wages are at least half of total pay', rules.labourCodeWages, (v) =>
            setRules((r) => ({ ...r, labourCodeWages: v })),
          )}
          {flag('Stipends carry PF, ESI and PT', rules.stipendDeductions, (v) => setRules((r) => ({ ...r, stipendDeductions: v })))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By office</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          {offices.length === 0 && <p className="text-sm text-ink-muted">No office rules yet.</p>}
          {offices.map((office) => {
            const slabs = rules.ptSlabsByOffice[office] ?? [];
            return (
              <section key={office} className="space-y-2">
                <h3 className="text-sm font-semibold text-ink">{office}</h3>
                <Field label="Articles’ stipend minimum ₹ a month">
                  <Input
                    className="w-32 text-right"
                    inputMode="decimal"
                    disabled={!editable}
                    value={rules.stipendMinimumByOffice[office] ?? ''}
                    onChange={(e) =>
                      setRules((r) => ({
                        ...r,
                        stipendMinimumByOffice: { ...r.stipendMinimumByOffice, [office]: e.target.value },
                      }))
                    }
                  />
                </Field>
                <p className="text-xs font-semibold text-ink-muted">Professional tax slabs (monthly gross)</p>
                <table className="text-sm">
                  <thead className="text-left text-xs text-ink-muted">
                    <tr>
                      <th className="pr-2 font-medium">From ₹</th>
                      <th className="pr-2 font-medium">To ₹</th>
                      <th className="pr-2 font-medium">PT ₹</th>
                      <th className="pr-2 font-medium">February ₹</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {slabs.map((s, i) => {
                      const patch = (p: Partial<PtSlab>) =>
                        setSlabs(office, slabs.map((x, j) => (j === i ? { ...x, ...p } : x)));
                      return (
                        <tr key={i}>
                          <td className="pr-2 py-1">
                            <Input className="w-28 text-right" disabled={!editable} value={s.from} onChange={(e) => patch({ from: e.target.value })} />
                          </td>
                          <td className="pr-2 py-1">
                            <Input
                              className="w-28 text-right"
                              placeholder="and above"
                              disabled={!editable}
                              value={s.to ?? ''}
                              onChange={(e) => patch({ to: e.target.value.trim() ? e.target.value : null })}
                            />
                          </td>
                          <td className="pr-2 py-1">
                            <Input className="w-24 text-right" disabled={!editable} value={s.amount} onChange={(e) => patch({ amount: e.target.value })} />
                          </td>
                          <td className="pr-2 py-1">
                            <Input
                              className="w-24 text-right"
                              placeholder="same"
                              disabled={!editable}
                              value={s.february ?? ''}
                              onChange={(e) => {
                                const v = e.target.value.trim();
                                setSlabs(
                                  office,
                                  slabs.map((x, j) => {
                                    if (j !== i) return x;
                                    const { february: _old, ...rest } = x;
                                    return v ? { ...rest, february: v } : rest;
                                  }),
                                );
                              }}
                            />
                          </td>
                          <td className="py-1">
                            {editable && (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label="Remove slab"
                                onClick={() => setSlabs(office, slabs.filter((_, j) => j !== i))}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {editable && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setSlabs(office, [...slabs, { from: '0', to: null, amount: '0' }])}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add a slab
                  </Button>
                )}
              </section>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <p className="text-sm text-ink-muted">
            In force from {formatDate(record.effectiveFrom)}
            {record.confirmedBy && `, confirmed by ${record.confirmedBy}`}.
          </p>
          {editable && (
            <>
              <Field label="Apply from" className="ml-auto">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Button disabled={!valid || save.isPending} onClick={() => save.mutate(undefined)}>
                Confirm settings
              </Button>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
