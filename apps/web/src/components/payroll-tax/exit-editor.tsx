'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ExitSettlement, ExitSettlementInput } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { errorText, monthLabel, usePayAction } from '@/lib/payroll';
import { EXIT_STATUS_LABEL, EXIT_STATUS_TONE, amountOrNull } from '@/lib/payroll-tax';
import { Badge, Button, EmptyState, Spinner } from '@/components/ui';
import { Field, Input } from '@/components/form';

type Labelled = { label: string; amount: string };

/** The settlement as a statement: what is paid, what is recovered, the net. */
export function SettlementStatement({ s }: { s: ExitSettlement }): JSX.Element | null {
  const w = s.working;
  if (!w) return null;
  return (
    <div className="space-y-3">
      <table className="w-full max-w-lg text-sm">
        <tbody className="divide-y divide-line">
          {w.items.map((i) => (
            <tr key={i.code}>
              <td className="py-1.5 pr-3">{i.label}</td>
              <td className="py-1.5 text-right tabular-nums">
                {i.kind === 'deduction' ? '− ' : ''}
                {formatMoney(i.amount)}
              </td>
            </tr>
          ))}
          <tr className="font-medium text-ink">
            <td className="py-1.5 pr-3">Net settlement</td>
            <td className="py-1.5 text-right tabular-nums">{formatMoney(w.net)}</td>
          </tr>
          {Number(w.tds) > 0 && (
            <tr className="text-ink-muted">
              <td className="py-1.5 pr-3">Estimated TDS on it, deducted by the run</td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(w.tds)}</td>
            </tr>
          )}
        </tbody>
      </table>
      {w.lastMonth && (
        <p className="text-sm text-ink-muted">
          The last month’s pay ({w.lastMonth.payableDays} days) comes with the run as usual: net{' '}
          {formatMoney(w.lastMonth.net)}.
        </p>
      )}
      <p className="text-sm text-ink-muted">
        Gratuity:{' '}
        {w.gratuity.eligible ? `${w.gratuity.countedYears} years counted.` : w.gratuity.reason}
      </p>
      {w.warnings.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-warning-700">
          {w.warnings.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Full and final for one leaver (spec §4.8): HR prepares it, the Managing
 * Partner or the alternate approves it (never the preparer), and the run of
 * its pay month pays it.
 */
export function ExitEditor({
  employeeId,
  prepares,
  approver,
}: {
  employeeId: string;
  prepares: boolean;
  approver: boolean;
}): JSX.Element {
  const q = useQuery({
    queryKey: ['payroll', 'exits', employeeId],
    queryFn: () => apiFetch<ExitSettlement>(`/payroll/exits/${employeeId}`),
    retry: false,
  });
  const [form, setForm] = useState<ExitSettlementInput | null>(null);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (q.data) {
      setForm(q.data.input);
      setOverride(!!q.data.input.gratuityOverride);
    }
  }, [q.data]);

  const base = `/payroll/exits/${employeeId}`;
  const save = usePayAction(
    (input: ExitSettlementInput & { version: number }) =>
      apiFetch<ExitSettlement>(base, { method: 'PUT', body: input }),
    'Settlement saved.',
  );
  const step = usePayAction(
    ({ to, version, reason }: { to: string; version: number; reason?: string }) =>
      apiFetch<ExitSettlement>(`${base}/${to}`, { method: 'POST', body: { version, reason } }),
    (r) => `Settlement ${EXIT_STATUS_LABEL[r.status].toLowerCase()}.`,
  );

  if (q.isLoading || (q.data && !form)) return <Spinner />;
  if (q.error || !q.data || !form) return <EmptyState>{errorText(q.error)}</EmptyState>;
  const s = q.data;
  const editable = prepares && (s.status === 'not_started' || s.status === 'draft');

  const days = (
    key: 'leaveDays' | 'noticeShortfallDays' | 'noticePayDays',
    label: string,
    hint?: string,
  ) => (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        min={0}
        value={form[key]}
        disabled={!editable}
        onChange={(e) =>
          setForm({ ...form, [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
        }
      />
    </Field>
  );
  const list = (key: 'otherEarnings' | 'otherDeductions', title: string) => (
    <div className="space-y-2">
      <div className="text-sm font-medium text-ink">{title}</div>
      {form[key].map((o: Labelled, i: number) => (
        <div key={i} className="flex gap-2">
          <Input
            aria-label={`${title} ${i + 1} label`}
            value={o.label}
            disabled={!editable}
            onChange={(e) =>
              setForm({
                ...form,
                [key]: form[key].map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
              })
            }
          />
          <Input
            aria-label={`${title} ${i + 1} amount`}
            className="w-36"
            inputMode="decimal"
            value={o.amount}
            disabled={!editable}
            onChange={(e) =>
              setForm({
                ...form,
                [key]: form[key].map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)),
              })
            }
          />
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setForm({ ...form, [key]: form[key].filter((_, j) => j !== i) })}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {editable && form[key].length < 10 && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setForm({ ...form, [key]: [...form[key], { label: '', amount: '' }] })}
        >
          Add
        </Button>
      )}
    </div>
  );

  const extrasOk = [...form.otherEarnings, ...form.otherDeductions].every(
    (o) => o.label.trim() && amountOrNull(o.amount) !== null,
  );
  const overrideOk = !override || !!form.gratuityOverride?.reason.trim();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        <Badge tone={EXIT_STATUS_TONE[s.status]}>{EXIT_STATUS_LABEL[s.status]}</Badge>
        <span>
          Joined {formatDate(s.joinedOn)} · last day {formatDate(s.exitDate)} · due by{' '}
          {formatDate(s.dueBy)} · paid with the {monthLabel(s.payMonth)} run
        </span>
        {s.preparedBy && <span>· prepared by {s.preparedBy}</span>}
        {s.approvedBy && <span>· approved by {s.approvedBy}</span>}
        {s.runStatus && <span>· run {s.runStatus}</span>}
      </div>
      {s.returnedReason && s.status === 'draft' && (
        <p className="rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
          Returned: {s.returnedReason}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {days(
          'leaveDays',
          'Leave to encash (days)',
          'Earned leave left, as HR’s leave record shows.',
        )}
        {days('noticePayDays', 'Notice paid in lieu (days)', 'The firm let them go early.')}
        {days('noticeShortfallDays', 'Notice not served (days)', 'Recovered from the settlement.')}
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={override}
            disabled={!editable}
            onChange={(e) => {
              setOverride(e.target.checked);
              setForm({
                ...form,
                gratuityOverride: e.target.checked ? { eligible: true, reason: '' } : null,
              });
            }}
          />
          Override the gratuity rule (death, disablement, a fixed-term contract…)
        </label>
        {override && form.gratuityOverride && (
          <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.gratuityOverride.eligible}
                disabled={!editable}
                onChange={(e) =>
                  setForm({
                    ...form,
                    gratuityOverride: { ...form.gratuityOverride!, eligible: e.target.checked },
                  })
                }
              />
              Pay gratuity
            </label>
            <Input
              aria-label="Why the rule is overridden"
              placeholder="Why"
              value={form.gratuityOverride.reason}
              disabled={!editable}
              onChange={(e) =>
                setForm({
                  ...form,
                  gratuityOverride: { ...form.gratuityOverride!, reason: e.target.value },
                })
              }
            />
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {list('otherEarnings', 'Anything else owed to them')}
        {list('otherDeductions', 'Anything else to recover')}
      </div>

      {editable && (
        <Button
          disabled={save.isPending || !extrasOk || !overrideOk}
          onClick={() => save.mutate({ ...form, version: s.version })}
        >
          {s.status === 'not_started' ? 'Prepare the settlement' : 'Save and work it out'}
        </Button>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">
          {s.status === 'not_started' ? 'What the defaults would pay' : 'Statement'}
        </h3>
        <SettlementStatement s={s} />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {prepares && s.status === 'draft' && (
          <Button
            disabled={step.isPending}
            onClick={() => step.mutate({ to: 'submit', version: s.version })}
          >
            Send for approval
          </Button>
        )}
        {prepares && s.status === 'submitted' && (
          <Button
            variant="secondary"
            disabled={step.isPending}
            onClick={() => step.mutate({ to: 'withdraw', version: s.version })}
          >
            Withdraw
          </Button>
        )}
        {approver && s.status === 'submitted' && (
          <>
            <Button
              disabled={step.isPending}
              onClick={() => step.mutate({ to: 'approve', version: s.version })}
            >
              Approve
            </Button>
            <Input
              aria-label="Reason to return"
              className="w-64"
              placeholder="Reason to return"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              variant="secondary"
              disabled={step.isPending || !reason.trim()}
              onClick={() =>
                step.mutate({ to: 'return', version: s.version, reason: reason.trim() })
              }
            >
              Return
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
