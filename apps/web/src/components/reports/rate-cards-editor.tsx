'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import type { Paginated, RateCardsResponse } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import type { EmployeeRow } from '@/lib/types';
import {
  cardsInForce,
  deleteEmployeeRate,
  deleteRateCard,
  fetchRateCards,
  putEmployeeRate,
  putRateCards,
  putWorkingCalendar,
  rateCardsKey,
  rateProblem,
} from '@/lib/practice-finance-api';
import { Field, Input, Select } from '@/components/form';
import { Button, Spinner } from '@/components/ui';
import { ExpandToggle, InlinePanel } from '@/components/inline-panel';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const message = (e: unknown) => (e instanceof Error ? e.message : 'That did not save.');

/** The firm's rates by grade and by person, and the working calendar (PS-302). */
export function RateCardsEditor({ today }: { today: string }): JSX.Element {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: rateCardsKey, queryFn: fetchRateCards });
  const [open, setOpen] = useState<'grades' | 'person' | 'calendar' | null>(null);
  const done = (data: RateCardsResponse) => {
    qc.setQueryData(rateCardsKey, data);
    void qc.invalidateQueries({ queryKey: ['reports'] });
    setOpen(null);
  };

  if (q.isLoading) return <Spinner label="Loading rate cards…" />;
  if (!q.data) return <p className="text-sm text-ink-muted">Rate cards could not be loaded.</p>;
  const data = q.data;
  const now = cardsInForce(data.cards, today);

  const toggle = (k: 'grades' | 'person' | 'calendar', label: string) => (
    <button
      type="button"
      className="group inline-flex items-center gap-2 text-sm font-medium text-ink hover:text-primary-600"
      onClick={() => setOpen(open === k ? null : k)}
      aria-expanded={open === k}
    >
      <ExpandToggle open={open === k} /> {label}
    </button>
  );

  return (
    <div className="space-y-5">
      <div>
        <div className="scroll-slim overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="py-2 pr-4 font-semibold">Grade</th>
                <th className="py-2 pr-4 text-right font-semibold">Cost / hour</th>
                <th className="py-2 pr-4 text-right font-semibold">Charge-out / hour</th>
                <th className="py-2 pr-4 font-semibold">From</th>
                <th className="py-2 pr-4 font-semibold">Earlier</th>
              </tr>
            </thead>
            <tbody>
              {data.grades.map((g) => {
                const cur = now.get(g.id);
                const history = data.cards.filter((c) => c.gradeId === g.id && c !== cur);
                return (
                  <tr key={g.id} className="border-b border-line align-top last:border-0">
                    <td className="py-2 pr-4 font-medium text-ink">{g.name}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {cur ? formatMoney(cur.costRatePerHour) : <Unset />}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {cur ? formatMoney(cur.chargeOutRatePerHour) : <Unset />}
                    </td>
                    <td className="py-2 pr-4 text-ink-muted">
                      {cur ? `${formatDate(cur.effectiveFrom)} (FY ${cur.financialYear})` : '—'}
                    </td>
                    <td className="py-2 pr-4 text-xs text-ink-muted">
                      {history.length === 0
                        ? '—'
                        : history.map((h) => (
                            <span key={h.id} className="mr-3 inline-flex items-center gap-1">
                              {h.effectiveFrom > today ? 'From' : 'Until then'}{' '}
                              {formatDate(h.effectiveFrom)}: {formatMoney(h.costRatePerHour)} /{' '}
                              {formatMoney(h.chargeOutRatePerHour)}
                              <RemoveButton
                                label={`Remove ${g.name} rates from ${h.effectiveFrom}`}
                                run={() => deleteRateCard(h.id)}
                                onDone={done}
                              />
                            </span>
                          ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2">{toggle('grades', 'Set rates from a day')}</div>
        {open === 'grades' && (
          <GradeRatesForm
            open={open === 'grades'}
            onClose={() => setOpen(null)}
            data={data}
            today={today}
            onDone={done}
          />
        )}
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-ink">A person’s own rates</h3>
        <p className="mb-2 text-xs text-ink-muted">
          Over their grade’s card from the day given — for someone paid or billed differently.
        </p>
        {data.overrides.length === 0 ? (
          <p className="text-sm text-ink-faint">Nobody has their own rates; grades apply.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {data.overrides.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
                <span className="font-medium text-ink">{o.employeeName}</span>
                {o.gradeName && <span className="text-xs text-ink-faint">{o.gradeName}</span>}
                <span className="tabular-nums">
                  {formatMoney(o.costRatePerHour)} cost · {formatMoney(o.chargeOutRatePerHour)}{' '}
                  charge-out
                </span>
                <span className="text-ink-muted">from {formatDate(o.effectiveFrom)}</span>
                {o.note && <span className="text-xs text-ink-muted">{o.note}</span>}
                <RemoveButton
                  label={`Remove ${o.employeeName}'s rates from ${o.effectiveFrom}`}
                  run={() => deleteEmployeeRate(o.id)}
                  onDone={done}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">{toggle('person', 'Set a person’s rates')}</div>
        {open === 'person' && (
          <PersonRateForm
            open={open === 'person'}
            onClose={() => setOpen(null)}
            today={today}
            onDone={done}
          />
        )}
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-ink">Working calendar</h3>
        <p className="text-sm text-ink-muted">
          {data.calendar.workingWeekdays.map((d) => WEEKDAYS[d - 1]).join(', ')} ·{' '}
          {Number(data.calendar.workingHoursPerDay)} hours a day, less the firm’s holidays — the
          available hours behind utilisation’s chargeable %.
        </p>
        <div className="mt-2">{toggle('calendar', 'Change the working calendar')}</div>
        {open === 'calendar' && (
          <CalendarForm
            open={open === 'calendar'}
            onClose={() => setOpen(null)}
            data={data}
            onDone={done}
          />
        )}
      </div>
    </div>
  );
}

function Unset(): JSX.Element {
  return <span className="text-warning-700">Not set</span>;
}

function RemoveButton({
  label,
  run,
  onDone,
}: {
  label: string;
  run: () => Promise<RateCardsResponse>;
  onDone: (d: RateCardsResponse) => void;
}): JSX.Element {
  const m = useMutation({ mutationFn: run, onSuccess: onDone });
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={m.isPending}
      onClick={() => m.mutate()}
      className="rounded p-0.5 text-ink-faint hover:bg-danger-50 hover:text-danger-600"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

function GradeRatesForm({
  open,
  onClose,
  data,
  today,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  data: RateCardsResponse;
  today: string;
  onDone: (d: RateCardsResponse) => void;
}): JSX.Element | null {
  const [from, setFrom] = useState(today);
  const now = useMemo(() => cardsInForce(data.cards, today), [data.cards, today]);
  const [rates, setRates] = useState<Record<string, { cost: string; charge: string }>>(() =>
    Object.fromEntries(
      data.grades.map((g) => [
        g.id,
        {
          cost: now.get(g.id)?.costRatePerHour ?? '',
          charge: now.get(g.id)?.chargeOutRatePerHour ?? '',
        },
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const filled = data.grades.filter((g) => rates[g.id]?.cost.trim() || rates[g.id]?.charge.trim());
  const problem =
    filled
      .map((g) => rateProblem(rates[g.id]!.cost, rates[g.id]!.charge))
      .find((p) => p !== null) ?? (filled.length === 0 ? 'Give at least one grade’s rates.' : null);
  const save = useMutation({
    mutationFn: () =>
      putRateCards({
        effectiveFrom: from,
        rates: filled.map((g) => ({
          gradeId: g.id,
          costRatePerHour: rates[g.id]!.cost.trim(),
          chargeOutRatePerHour: rates[g.id]!.charge.trim(),
        })),
      }),
    onSuccess: onDone,
    onError: (e) => setError(message(e)),
  });
  return (
    <InlinePanel
      open={open}
      onClose={onClose}
      title="Set rates from a day"
      description="Each grade’s rates from this day on; work before it keeps the earlier card. A grade left blank keeps its own."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!!problem || !from || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save rates'}
          </Button>
        </div>
      }
    >
      <Field label="From" required className="mb-3 max-w-xs">
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="Rates from"
        />
      </Field>
      <div className="grid gap-2">
        {data.grades.map((g) => (
          <div key={g.id} className="grid grid-cols-[8rem_1fr_1fr] items-center gap-2">
            <span className="text-sm font-medium text-ink">{g.name}</span>
            <Input
              inputMode="decimal"
              placeholder="Cost / hour"
              aria-label={`${g.name} cost per hour`}
              value={rates[g.id]?.cost ?? ''}
              onChange={(e) =>
                setRates((r) => ({ ...r, [g.id]: { ...r[g.id]!, cost: e.target.value } }))
              }
            />
            <Input
              inputMode="decimal"
              placeholder="Charge-out / hour"
              aria-label={`${g.name} charge-out per hour`}
              value={rates[g.id]?.charge ?? ''}
              onChange={(e) =>
                setRates((r) => ({ ...r, [g.id]: { ...r[g.id]!, charge: e.target.value } }))
              }
            />
          </div>
        ))}
      </div>
      {(problem || error) && (
        <p role="alert" className="mt-3 text-sm text-danger-700">
          {problem ?? error}
        </p>
      )}
    </InlinePanel>
  );
}

function PersonRateForm({
  open,
  onClose,
  today,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  today: string;
  onDone: (d: RateCardsResponse) => void;
}): JSX.Element | null {
  const people = useQuery({
    queryKey: ['employees', 'active', 100],
    queryFn: () => apiFetch<Paginated<EmployeeRow>>('/employees?limit=100&status=active'),
    enabled: open,
  });
  const [employeeId, setEmployeeId] = useState('');
  const [from, setFrom] = useState(today);
  const [cost, setCost] = useState('');
  const [charge, setCharge] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const problem = !cost.trim() || !charge.trim() ? null : rateProblem(cost, charge);
  const ready = !!employeeId && !!from && !!cost.trim() && !!charge.trim() && !problem;
  const save = useMutation({
    mutationFn: () =>
      putEmployeeRate({
        employeeId,
        effectiveFrom: from,
        costRatePerHour: cost.trim(),
        chargeOutRatePerHour: charge.trim(),
        note: note.trim() || null,
      }),
    onSuccess: onDone,
    onError: (e) => setError(message(e)),
  });
  return (
    <InlinePanel
      open={open}
      onClose={onClose}
      title="Set a person’s rates"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Person" required>
          <Select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            aria-label="Person"
          >
            <option value="">Choose…</option>
            {(people.data?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} · {p.gradeName} · {p.officeCode}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" required>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From"
          />
        </Field>
        <Field label="Cost / hour" required>
          <Input
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            aria-label="Cost per hour"
          />
        </Field>
        <Field label="Charge-out / hour" required>
          <Input
            inputMode="decimal"
            value={charge}
            onChange={(e) => setCharge(e.target.value)}
            aria-label="Charge-out per hour"
          />
        </Field>
        <Field label="Note" className="sm:col-span-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            aria-label="Note"
            placeholder="Why this person differs from their grade"
          />
        </Field>
      </div>
      {(problem || error) && (
        <p role="alert" className="mt-3 text-sm text-danger-700">
          {problem ?? error}
        </p>
      )}
    </InlinePanel>
  );
}

function CalendarForm({
  open,
  onClose,
  data,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  data: RateCardsResponse;
  onDone: (d: RateCardsResponse) => void;
}): JSX.Element | null {
  const [days, setDays] = useState<number[]>(data.calendar.workingWeekdays);
  const [hours, setHours] = useState(String(Number(data.calendar.workingHoursPerDay)));
  const [error, setError] = useState<string | null>(null);
  const okHours =
    /^\d{1,2}(\.\d{1,2})?$/.test(hours.trim()) && Number(hours) > 0 && Number(hours) <= 24;
  const save = useMutation({
    mutationFn: () =>
      putWorkingCalendar({ workingWeekdays: days, workingHoursPerDay: hours.trim() }),
    onSuccess: onDone,
    onError: (e) => setError(message(e)),
  });
  return (
    <InlinePanel
      open={open}
      onClose={onClose}
      title="Working calendar"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={days.length === 0 || !okHours || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <fieldset className="mb-3">
        <legend className="mb-1 text-sm font-medium text-ink">Working days</legend>
        <div className="flex flex-wrap gap-3">
          {WEEKDAYS.map((label, i) => (
            <label key={label} className="inline-flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={days.includes(i + 1)}
                onChange={(e) =>
                  setDays((d) =>
                    e.target.checked
                      ? [...d, i + 1].sort((a, b) => a - b)
                      : d.filter((x) => x !== i + 1),
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Hours in a working day" required className="max-w-xs">
        <Input
          inputMode="decimal"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          aria-label="Hours in a working day"
        />
      </Field>
      {(!okHours || days.length === 0 || error) && (
        <p role="alert" className="mt-3 text-sm text-danger-700">
          {days.length === 0
            ? 'Choose at least one working day.'
            : !okHours
              ? 'Hours are more than 0 and at most 24, like 8 or 7.5.'
              : error}
        </p>
      )}
    </InlinePanel>
  );
}
