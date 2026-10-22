'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Pencil } from 'lucide-react';
import { IFSC_PATTERN, PAN_PATTERN, type EmployeePayDetails } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { errorText, usePayAction } from '@/lib/payroll';
import { Button, EmptyState, Spinner } from '@/components/ui';
import { Field, Input } from '@/components/form';
import { InlinePanel } from '@/components/inline-panel';

/**
 * Bank account, PAN and statutory numbers (spec §4.8): masked; showing a full
 * number is audited. HR edits; a changed account is flagged on the next run.
 */
export function BankIdsTab({ employeeId }: { employeeId: string }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState<Record<string, string>>({});
  const details = useQuery({
    queryKey: ['payroll', 'pay-details', employeeId],
    queryFn: () => apiFetch<EmployeePayDetails>(`/payroll/employees/${employeeId}/pay-details`),
    retry: false,
  });
  const reveal = usePayAction(
    (field: 'account' | 'pan') =>
      apiFetch<{ value: string }>(`/payroll/employees/${employeeId}/pay-details/reveal`, {
        method: 'POST',
        body: { field },
      }).then((r) => {
        setShown((s) => ({ ...s, [field]: r.value }));
        return r;
      }),
    'Shown — this is recorded in the audit trail.',
  );

  if (details.isLoading) return <Spinner />;
  if (details.error) return <EmptyState>{errorText(details.error)}</EmptyState>;
  const d = details.data!;
  const rows: [string, string | null, ('account' | 'pan')?][] = [
    ['Account holder', d.accountHolder],
    ['Account number', shown.account ?? d.accountMasked, 'account'],
    ['IFSC', d.ifsc],
    ['Bank', d.bankName],
    ['PAN', shown.pan ?? d.panMasked, 'pan'],
    ['UAN (PF)', d.uan],
    ['ESI number', d.esiNumber],
    ['Aadhaar (last four)', d.aadhaarLast4],
  ];

  return (
    <div className="space-y-3">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value, field]) => (
          <div key={label} className="flex items-center justify-between gap-2 border-b border-line py-1.5">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="flex items-center gap-1 font-medium tabular-nums text-ink">
              {value ?? <span className="font-normal text-ink-faint">—</span>}
              {field && value && !shown[field] && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Show the full ${label.toLowerCase()}`}
                  title="Show the full number (audited)"
                  disabled={reveal.isPending}
                  onClick={() => reveal.mutate(field)}
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-faint">
          {d.updatedAt ? `Last changed ${formatDate(d.updatedAt)}.` : 'Nothing recorded yet.'} A person
          asks to change their own account from My pay; HR verifies it with them.
        </p>
        <Button size="sm" variant="secondary" onClick={() => setEditing((v) => !v)}>
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
      </div>
      <InlinePanel
        open={editing}
        onClose={() => setEditing(false)}
        title="Bank and statutory numbers"
        description="Account and PAN are stored encrypted. Leave PAN blank to keep the one on file."
      >
        <PayDetailsForm employeeId={employeeId} current={d} onDone={() => setEditing(false)} />
      </InlinePanel>
    </div>
  );
}

function PayDetailsForm({
  employeeId,
  current,
  onDone,
}: {
  employeeId: string;
  current: EmployeePayDetails;
  onDone: () => void;
}): JSX.Element {
  const [f, setF] = useState({
    accountHolder: current.accountHolder ?? '',
    accountNumber: '',
    ifsc: current.ifsc ?? '',
    bankName: current.bankName ?? '',
    pan: '',
    uan: current.uan ?? '',
    esiNumber: current.esiNumber ?? '',
    aadhaarLast4: current.aadhaarLast4 ?? '',
  });
  const on = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: k === 'ifsc' || k === 'pan' ? e.target.value.toUpperCase() : e.target.value }));
  const valid =
    f.accountHolder.trim() &&
    /^[0-9A-Za-z]{6,20}$/.test(f.accountNumber) &&
    IFSC_PATTERN.test(f.ifsc) &&
    (!f.pan || PAN_PATTERN.test(f.pan)) &&
    (!f.uan || /^\d{12}$/.test(f.uan)) &&
    (!f.esiNumber || /^\d{10,17}$/.test(f.esiNumber)) &&
    (!f.aadhaarLast4 || /^\d{4}$/.test(f.aadhaarLast4));
  const save = usePayAction(
    () =>
      apiFetch<EmployeePayDetails>(`/payroll/employees/${employeeId}/pay-details`, {
        method: 'PUT',
        body: Object.fromEntries(
          Object.entries({ ...f, accountHolder: f.accountHolder.trim() }).filter(([, v]) => v !== ''),
        ),
      }),
    'Saved.',
  );
  return (
    <form
      className="grid gap-3 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate(undefined, { onSuccess: onDone });
      }}
    >
      <Field label="Account holder" required>
        <Input value={f.accountHolder} onChange={on('accountHolder')} />
      </Field>
      <Field label="Account number" required hint="Enter it in full each time it is saved.">
        <Input value={f.accountNumber} onChange={on('accountNumber')} autoComplete="off" />
      </Field>
      <Field label="IFSC" required>
        <Input value={f.ifsc} onChange={on('ifsc')} maxLength={11} />
      </Field>
      <Field label="Bank">
        <Input value={f.bankName} onChange={on('bankName')} />
      </Field>
      <Field label="PAN">
        <Input value={f.pan} onChange={on('pan')} maxLength={10} autoComplete="off" />
      </Field>
      <Field label="UAN (PF)">
        <Input value={f.uan} onChange={on('uan')} maxLength={12} />
      </Field>
      <Field label="ESI number">
        <Input value={f.esiNumber} onChange={on('esiNumber')} maxLength={17} />
      </Field>
      <Field label="Aadhaar — last four only">
        <Input value={f.aadhaarLast4} onChange={on('aadhaarLast4')} maxLength={4} />
      </Field>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid || save.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
