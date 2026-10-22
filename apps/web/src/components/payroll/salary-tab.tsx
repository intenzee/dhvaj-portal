'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import type { PayComponent, PayKind, SalaryStructure } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { errorText, useIsPayApprover, usePayAction } from '@/lib/payroll';
import { Badge, Button, EmptyState, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { InlinePanel } from '@/components/inline-panel';

const STATUS_TONE: Record<string, string> = { proposed: 'warn', approved: 'success', rejected: 'danger' };

const monthlyTotal = (cs: PayComponent[]): number => cs.reduce((t, c) => t + Number(c.monthly || 0), 0);

/**
 * A person's pay, effective-dated (spec §4.8): every structure with who
 * proposed and approved it, a form to propose a revision, and — for the
 * Managing Partner or the alternate — approve or reject a proposal.
 */
export function SalaryTab({ employeeId }: { employeeId: string }): JSX.Element {
  const [proposing, setProposing] = useState(false);
  const list = useQuery({
    queryKey: ['payroll', 'structures', employeeId],
    queryFn: () => apiFetch<SalaryStructure[]>(`/payroll/structures?employeeId=${employeeId}`),
    retry: false,
  });

  if (list.isLoading) return <Spinner />;
  if (list.error) return <EmptyState>{errorText(list.error)}</EmptyState>;
  const rows = list.data ?? [];
  const latest = rows.find((s) => s.status === 'approved');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">
          {latest
            ? `${formatMoney(monthlyTotal(latest.components))} a month (${latest.kind}) from ${formatDate(latest.effectiveFrom)}.`
            : 'No approved pay yet.'}
        </p>
        <Button size="sm" variant="secondary" onClick={() => setProposing((v) => !v)}>
          <Plus className="h-3.5 w-3.5" /> Propose {latest ? 'a revision' : 'pay'}
        </Button>
      </div>
      <InlinePanel
        open={proposing}
        onClose={() => setProposing(false)}
        title={latest ? 'Propose a revision' : 'Propose pay'}
        description="The Managing Partner (or the named alternate) approves it; it is paid from its effective date."
      >
        <StructureForm
          employeeId={employeeId}
          from={latest ?? null}
          onDone={() => setProposing(false)}
        />
      </InlinePanel>
      {rows.length === 0 ? (
        <EmptyState>No pay structure has been proposed for this person.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {rows.map((s) => (
            <StructureRow key={s.id} s={s} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StructureRow({ s }: { s: SalaryStructure }): JSX.Element {
  const approver = useIsPayApprover();
  const [note, setNote] = useState('');
  const decide = usePayAction(
    (decision: 'approve' | 'reject') =>
      apiFetch<SalaryStructure>(`/payroll/structures/${s.id}/decision`, {
        method: 'POST',
        body: { decision, ...(note.trim() ? { note: note.trim() } : {}) },
      }),
    (r) => (r.status === 'approved' ? 'Pay approved.' : 'Proposal rejected.'),
  );
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">From {formatDate(s.effectiveFrom)}</span>
        <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
        <Badge>{s.kind}</Badge>
        {s.belowStipendMinimum && <Badge tone="danger">Below the ICAI minimum</Badge>}
        <span className="ml-auto tabular-nums text-ink">
          {formatMoney(monthlyTotal(s.components))} / month · CTC {formatMoney(s.ctc)}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        {s.components.map((c) => `${c.label} ${formatMoney(c.monthly)}`).join(' · ')}
        {' · '}PF {s.pfApplicable ? (s.epsMember === false ? 'yes (no EPS)' : 'yes') : 'no'} · ESI {s.esiApplicable ? 'yes' : 'no'} · PT{' '}
        {s.ptApplicable ? 'yes' : 'no'}
      </p>
      <p className="mt-0.5 text-xs text-ink-faint">
        Proposed by {s.proposedBy ?? '—'}
        {s.approvedBy && ` · ${s.status === 'approved' ? 'approved' : 'decided'} by ${s.approvedBy}`}
        {s.note && ` · ${s.note}`}
      </p>
      {s.status === 'proposed' && approver && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Input
            className="max-w-sm"
            placeholder="Note (needed to reject)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate('approve')}>
            Approve
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={decide.isPending || !note.trim()}
            onClick={() => decide.mutate('reject')}
          >
            Reject
          </Button>
        </div>
      )}
    </li>
  );
}

const STARTER: PayComponent[] = [
  { code: 'basic', label: 'Basic', monthly: '', pfWage: true },
  { code: 'hra', label: 'House rent allowance', monthly: '', pfWage: false },
  { code: 'special', label: 'Special allowance', monthly: '', pfWage: false },
];

/** Propose pay: components a month, statutory switches, effective date. */
export function StructureForm({
  employeeId,
  from,
  onDone,
}: {
  employeeId: string;
  from: SalaryStructure | null;
  onDone: () => void;
}): JSX.Element {
  const [kind, setKind] = useState<PayKind>(from?.kind ?? 'salary');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [components, setComponents] = useState<PayComponent[]>(
    from?.components.map((c) => ({ ...c })) ?? STARTER.map((c) => ({ ...c })),
  );
  const [pf, setPf] = useState(from?.pfApplicable ?? true);
  const [esi, setEsi] = useState(from?.esiApplicable ?? true);
  const [pt, setPt] = useState(from?.ptApplicable ?? true);
  const [eps, setEps] = useState(from?.epsMember ?? true);
  const [note, setNote] = useState('');
  const monthly = monthlyTotal(components);
  const [ctc, setCtc] = useState('');

  const set = (i: number, patch: Partial<PayComponent>) =>
    setComponents((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const valid =
    !!effectiveFrom &&
    components.length > 0 &&
    components.every((c) => /^[a-z][a-z0-9_]{1,29}$/.test(c.code) && c.label.trim() && /^\d+(\.\d{1,2})?$/.test(c.monthly));

  const save = usePayAction(
    () =>
      apiFetch<SalaryStructure>('/payroll/structures', {
        method: 'POST',
        body: {
          employeeId,
          effectiveFrom,
          kind,
          ctc: ctc.trim() || (monthly * 12).toFixed(2),
          components: components.map((c) => ({ ...c, label: c.label.trim(), pfWage: !!c.pfWage })),
          pfApplicable: pf,
          epsMember: eps,
          esiApplicable: esi,
          ptApplicable: pt,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      }),
    'Proposed — waiting for approval.',
  );

  return (
    <form
      className="space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate(undefined, { onSuccess: onDone });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Effective from" required>
          <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </Field>
        <Field label="Kind" hint="Articles are paid a stipend, in its own register.">
          <Select value={kind} onChange={(e) => setKind(e.target.value as PayKind)}>
            <option value="salary">Salary</option>
            <option value="stipend">Stipend</option>
          </Select>
        </Field>
        <Field label="Annual CTC" hint={`Blank: ${formatMoney(monthly * 12)} (12 × monthly)`}>
          <Input inputMode="decimal" value={ctc} onChange={(e) => setCtc(e.target.value)} />
        </Field>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-muted">
          <tr>
            <th className="pb-1 font-medium">Code</th>
            <th className="pb-1 font-medium">Label</th>
            <th className="pb-1 text-right font-medium">A month (₹)</th>
            <th className="pb-1 font-medium" title="Counts as wages for PF and gratuity">
              PF wage
            </th>
            <th />
          </tr>
        </thead>
        <tbody>
          {components.map((c, i) => (
            <tr key={i}>
              <td className="pr-2 pb-1">
                <Input aria-label="Code" value={c.code} onChange={(e) => set(i, { code: e.target.value })} />
              </td>
              <td className="pr-2 pb-1">
                <Input aria-label="Label" value={c.label} onChange={(e) => set(i, { label: e.target.value })} />
              </td>
              <td className="pr-2 pb-1">
                <Input
                  aria-label="Amount a month"
                  inputMode="decimal"
                  className="text-right"
                  value={c.monthly}
                  onChange={(e) => set(i, { monthly: e.target.value })}
                />
              </td>
              <td className="pb-1 text-center">
                <input
                  type="checkbox"
                  aria-label="PF wage"
                  checked={!!c.pfWage}
                  onChange={(e) => set(i, { pfWage: e.target.checked })}
                />
              </td>
              <td className="pb-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Remove"
                  onClick={() => setComponents((cs) => cs.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setComponents((cs) => [...cs, { code: '', label: '', monthly: '', pfWage: false }])}
        >
          <Plus className="h-3.5 w-3.5" /> Add a component
        </Button>
        <span className="tabular-nums text-ink">Total {formatMoney(monthly)} a month</span>
        {(
          [
            ['PF', pf, setPf],
            ['Pension (EPS) member', eps, setEps],
            ['ESI', esi, setEsi],
            ['Professional tax', pt, setPt],
          ] as const
        ).map(([label, on, toggle]) => (
          <label key={label} className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} /> {label}
          </label>
        ))}
      </div>
      <Field label="Note" hint="Why: an annual revision, a promotion, the joining offer.">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid || save.isPending}>
          Propose
        </Button>
      </div>
    </form>
  );
}
