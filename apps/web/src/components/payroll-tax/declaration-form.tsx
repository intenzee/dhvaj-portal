'use client';

import { useState } from 'react';
import type {
  PreviousEmployment,
  SaveTaxDeclarationInput,
  TaxDeclaration,
  TaxDeclarationAmounts,
  TaxRegime,
} from '@hsdg/contracts';
import { DECLARATION_FIELDS, amountOrNull } from '@/lib/payroll-tax';
import { Button } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';

type Money = Exclude<
  keyof TaxDeclarationAmounts,
  'metroCity' | 'landlordPanGiven' | 'selfSenior' | 'parentsSenior'
>;

const PREVIOUS: { key: keyof PreviousEmployment; label: string }[] = [
  { key: 'income', label: 'Salary there' },
  { key: 'tds', label: 'TDS deducted there' },
  { key: 'pf', label: 'Your PF there' },
  { key: 'pt', label: 'Professional tax there' },
];

/**
 * A tax declaration: the regime and what the person expects to claim. Used by
 * the person on /me/tax and by HR for someone who declared on paper. The
 * regime can't change once a run has taxed the person (`regimeFixed`).
 */
export function DeclarationForm({
  value,
  onSave,
  saving,
  regimeFixed,
  readOnly,
}: {
  value: TaxDeclaration;
  onSave: (input: SaveTaxDeclarationInput) => void;
  saving?: boolean;
  regimeFixed?: boolean;
  readOnly?: boolean;
}): JSX.Element {
  const [regime, setRegime] = useState<TaxRegime>(value.regime);
  const [amounts, setAmounts] = useState<TaxDeclarationAmounts>(value.amounts);
  const [joinedMidYear, setJoinedMidYear] = useState(value.previousEmployment !== null);
  const [previous, setPrevious] = useState<PreviousEmployment>(
    value.previousEmployment ?? { income: '0', tds: '0', pf: '0', pt: '0' },
  );
  const old = regime === 'old';
  const disabled = readOnly || !!value.lockedAt;

  const bad = [
    ...DECLARATION_FIELDS.filter((f) => amountOrNull(String(amounts[f.key])) === null).map(
      (f) => f.label,
    ),
    ...(joinedMidYear
      ? PREVIOUS.filter((f) => amountOrNull(previous[f.key]) === null).map((f) => f.label)
      : []),
  ];

  const save = () =>
    onSave({
      version: value.version,
      regime,
      amounts: Object.fromEntries(
        Object.entries(amounts).map(([k, v]) => [
          k,
          typeof v === 'string' ? (amountOrNull(v) ?? v) : v,
        ]),
      ) as unknown as TaxDeclarationAmounts,
      previousEmployment: joinedMidYear
        ? (Object.fromEntries(
            PREVIOUS.map((f) => [f.key, amountOrNull(previous[f.key])]),
          ) as unknown as PreviousEmployment)
        : null,
    });

  const flag = (
    key: 'metroCity' | 'landlordPanGiven' | 'selfSenior' | 'parentsSenior',
    label: string,
  ) => (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input
        type="checkbox"
        checked={amounts[key]}
        disabled={disabled}
        onChange={(e) => setAmounts({ ...amounts, [key]: e.target.checked })}
      />
      {label}
    </label>
  );

  return (
    <div className="space-y-4">
      <Field
        label="Tax regime"
        hint={
          regimeFixed
            ? 'Fixed for the year: a salary run has already deducted tax on it. File your return in the other regime if you prefer it.'
            : 'The new regime is the default: fewer deductions, lower rates. Choose old only if your deductions are large.'
        }
      >
        <Select
          className="w-56"
          value={regime}
          disabled={disabled || regimeFixed}
          onChange={(e) => setRegime(e.target.value as TaxRegime)}
        >
          <option value="new">New regime</option>
          <option value="old">Old regime</option>
        </Select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        {DECLARATION_FIELDS.filter((f) => old || f.both).map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            <Input
              inputMode="decimal"
              value={String(amounts[f.key as Money])}
              disabled={disabled}
              onChange={(e) => setAmounts({ ...amounts, [f.key]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      {old && (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {flag('metroCity', 'I live in Delhi, Mumbai, Kolkata or Chennai')}
          {flag('landlordPanGiven', 'I have the landlord’s PAN')}
          {flag('selfSenior', 'I (or my spouse) am a senior citizen')}
          {flag('parentsSenior', 'My parents are senior citizens')}
        </div>
      )}
      {!old && (
        <p className="text-xs text-ink-muted">
          The new regime allows the standard deduction and the employer’s NPS only; switch to the
          old regime to claim HRA, 80C, 80D and the rest.
        </p>
      )}

      <div className="space-y-3 rounded-lg border border-line p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={joinedMidYear}
            disabled={disabled}
            onChange={(e) => setJoinedMidYear(e.target.checked)}
          />
          I worked elsewhere earlier this year
        </label>
        {joinedMidYear && (
          <div className="grid gap-3 sm:grid-cols-4">
            {PREVIOUS.map((f) => (
              <Field key={f.key} label={f.label}>
                <Input
                  inputMode="decimal"
                  value={previous[f.key]}
                  disabled={disabled}
                  onChange={(e) => setPrevious({ ...previous, [f.key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
        )}
      </div>

      {!disabled && (
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving || bad.length > 0}>
            {saving ? 'Saving…' : 'Save declaration'}
          </Button>
          {bad.length > 0 && (
            <span className="text-xs text-danger-700">Not an amount: {bad.join(', ')}</span>
          )}
        </div>
      )}
      {value.lockedAt && (
        <p className="text-xs text-ink-muted">
          HR has locked the declaration for the year’s close: from January only proved amounts
          count. Ask HR to unlock it to change anything.
        </p>
      )}
    </div>
  );
}
