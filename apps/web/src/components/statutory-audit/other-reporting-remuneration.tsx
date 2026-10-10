'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  MANAGERIAL_CATEGORIES,
  MANAGERIAL_CATEGORY_LABEL,
  REMUNERATION_OUTCOME_LABEL,
  type ManagerialCategory,
  type ManagerialPersonInput,
  type OtherReportingCapturedFacts,
  type RemunerationApprovals,
  type RemunerationResult,
} from '@hsdg/contracts';
import { Badge, Button } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';
import { num, rupees, str, type FactsPatch } from './other-reporting-ui';

/**
 * Section 197(16) managerial remuneration (spec §13): applies to a public
 * company only. Persons by category, Section 198 net profit, the approvals
 * route, and the Schedule V route on no / inadequate profits. The limits
 * (11 / 5 / 10 / 1 / 3 % and the Schedule V bands) come from the Rules Library,
 * and only the legally relevant category is tested.
 */

const OUTCOME_TONE: Record<string, string> = {
  within_limit: 'success',
  exceeds_limit: 'danger',
  schedule_v_route: 'warn',
  information_insufficient: 'warn',
  not_applicable: 'neutral',
};

const APPROVALS: Array<[keyof Omit<RemunerationApprovals, 'note'>, string]> = [
  ['overallSpecialResolution', 'Special resolution — overall limit exceeded'],
  ['executiveSpecialResolution', 'Special resolution — MD / WTD / Manager sub-limit exceeded'],
  ['nonExecutiveSpecialResolution', 'Special resolution — non-executive sub-limit exceeded'],
  ['scheduleVSpecialResolution', 'Schedule V route — special resolution passed'],
];

export function OtherReportingRemuneration({
  facts,
  result,
  publicCompany,
  publicSource,
  disabled,
  onSave,
}: {
  facts: OtherReportingCapturedFacts;
  result: RemunerationResult | undefined;
  publicCompany: boolean | null;
  publicSource: string | null;
  disabled: boolean;
  onSave: (patch: FactsPatch) => void;
}): JSX.Element {
  const [persons, setPersons] = useState<ManagerialPersonInput[]>(facts.managerialPersons);
  const [profit, setProfit] = useState(str(facts.section198NetProfit));
  const [capital, setCapital] = useState(str(facts.effectiveCapital));
  const [inadequate, setInadequate] = useState(facts.inadequateProfits);
  const [approvals, setApprovals] = useState<RemunerationApprovals>(facts.approvals);
  const setPerson = (i: number, patch: Partial<ManagerialPersonInput>) =>
    setPersons(persons.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  if (publicCompany === false)
    return (
      <p className="text-sm text-ink-muted">
        Not applicable — Section 197(16) reporting applies to a public company only
        {publicSource ? ` (${publicSource})` : ''}.
      </p>
    );

  const sv = result?.scheduleV;
  const invalid = persons.some((p) => !p.name.trim());

  return (
    <div className="space-y-3 text-sm">
      {publicCompany == null && (
        <p className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-800">
          Public-company status is not confirmed{publicSource ? ` (${publicSource})` : ''} —
          record an applicability override on the Section 197(16) card once it is known.
        </p>
      )}
      {result && (
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={OUTCOME_TONE[result.outcome] ?? 'neutral'}>
            {REMUNERATION_OUTCOME_LABEL[result.outcome]}
          </Badge>
          <span className="text-ink-muted">{result.basis}</span>
        </p>
      )}

      <table className="w-full text-sm" aria-label="Managerial persons">
        <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
          <tr>
            <th className="py-1">Name</th>
            <th>DIN</th>
            <th>Category</th>
            <th>Remuneration (₹)</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {persons.map((p, i) => (
            <tr key={p.id ?? `new-${i}`}>
              <td className="py-1 pr-2">
                <Input
                  aria-label="Name"
                  value={p.name}
                  disabled={disabled}
                  onChange={(e) => setPerson(i, { name: e.target.value })}
                />
              </td>
              <td className="pr-2">
                <Input
                  aria-label="DIN"
                  value={p.din ?? ''}
                  disabled={disabled}
                  onChange={(e) => setPerson(i, { din: e.target.value || null })}
                />
              </td>
              <td className="pr-2">
                <Select
                  aria-label="Category"
                  value={p.category}
                  disabled={disabled}
                  onChange={(e) => setPerson(i, { category: e.target.value as ManagerialCategory })}
                >
                  {MANAGERIAL_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {MANAGERIAL_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </td>
              <td className="pr-2">
                <Input
                  aria-label="Remuneration"
                  inputMode="decimal"
                  value={str(p.remuneration)}
                  disabled={disabled}
                  onChange={(e) => setPerson(i, { remuneration: num(e.target.value) })}
                />
              </td>
              <td>
                {!disabled && (
                  <button
                    type="button"
                    aria-label={`Remove ${p.name || 'person'}`}
                    className="text-ink-faint hover:text-danger-600"
                    onClick={() => setPersons(persons.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Section 198 net profit (₹)" hint="Negative for a loss">
          <Input
            inputMode="decimal"
            value={profit}
            disabled={disabled}
            onChange={(e) => setProfit(e.target.value)}
          />
        </Field>
        <Field label="Effective capital (₹)" hint="Used for the Schedule V band">
          <Input
            inputMode="decimal"
            value={capital}
            disabled={disabled}
            onChange={(e) => setCapital(e.target.value)}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-ink">
        <input
          type="checkbox"
          checked={inadequate}
          disabled={disabled}
          onChange={(e) => setInadequate(e.target.checked)}
        />
        Profits are inadequate for the ordinary limits (Schedule V route)
      </label>
      <fieldset className="space-y-1">
        <legend className="text-xs font-semibold text-ink">Shareholder approvals</legend>
        {APPROVALS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-ink">
            <input
              type="checkbox"
              checked={approvals[k]}
              disabled={disabled}
              onChange={(e) => setApprovals({ ...approvals, [k]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setPersons([...persons, { name: '', category: 'managing_director', remuneration: null }])
            }
          >
            <Plus className="h-3.5 w-3.5" /> Add person
          </Button>
          <Button
            size="sm"
            disabled={invalid}
            onClick={() =>
              onSave({
                managerialPersons: persons.map((p) => ({ ...p, name: p.name.trim() })),
                section198NetProfit: num(profit),
                effectiveCapital: num(capital),
                inadequateProfits: inadequate,
                approvals,
                hasManagingOrWholeTimeDirector: persons.some(
                  (p) => p.category !== 'non_executive_director',
                ),
              })
            }
          >
            Save remuneration
          </Button>
        </div>
      )}

      {result && result.categories.some((c) => c.applicable) && (
        <table className="w-full text-sm" aria-label="Section 197 limit tests">
          <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="py-1">Test</th>
              <th>Limit</th>
              <th>Permitted</th>
              <th>Paid</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {result.categories
              .filter((c) => c.applicable)
              .map((c) => (
                <tr key={c.key}>
                  <td className="py-1">{c.label}</td>
                  <td>{c.limitPercent != null ? `${c.limitPercent}%` : '—'}</td>
                  <td>{rupees(c.permittedAmount)}</td>
                  <td>
                    {rupees(c.paidAmount)}
                    {c.paidPercent != null && ` (${c.paidPercent.toFixed(2)}%)`}
                  </td>
                  <td>
                    {c.within == null ? (
                      <Badge tone="warn">Pending</Badge>
                    ) : c.within ? (
                      <Badge tone="success">Within</Badge>
                    ) : c.approvalRoute ? (
                      <Badge tone="info">Exceeds — approved</Badge>
                    ) : (
                      <Badge tone="danger">Exceeds</Badge>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      {sv?.triggered && (
        <div className="space-y-1 rounded-md border border-line p-3" aria-label="Schedule V">
          <p className="font-medium text-ink">Schedule V route</p>
          <p className="text-ink-muted">{sv.basis}</p>
          <p className="text-ink">
            Band: {sv.band?.label ?? '—'} · Ceiling per person: {rupees(sv.ceiling)}
            {sv.doubled && ' (doubled — special resolution)'}
          </p>
          {sv.exceeding.length > 0 && (
            <p className="text-danger-700">Above the ceiling: {sv.exceeding.join(', ')}</p>
          )}
        </div>
      )}
    </div>
  );
}
