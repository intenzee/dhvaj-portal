'use client';

import { FEE_PERIODS, FEE_PERIOD_UNIT, type BillingFrequency, type FeePeriod } from '@hsdg/contracts';
import { Input, Select } from '@/components/form';
import { feeArithmetic } from '@/lib/fees';

/**
 * CM-4 · a fee and the period it is for, side by side — `₹ [ 5,000 ] per
 * [ month ▾ ]` — with the arithmetic underneath, so nobody types a fee without
 * saying what period it covers.
 */
export function FeeInput({
  label = 'Fee',
  amount,
  period,
  onAmount,
  onPeriod,
  frequency,
  disabled,
  id,
}: {
  label?: string;
  amount: string;
  period: FeePeriod;
  onAmount: (v: string) => void;
  onPeriod: (p: FeePeriod) => void;
  /** The engagement's invoicing frequency, when set up. */
  frequency?: BillingFrequency | null;
  disabled?: boolean;
  id?: string;
}): JSX.Element {
  const line = feeArithmetic(amount, period, frequency);
  const inputId = id ?? 'fee-amount';
  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-muted">₹</span>
        <Input
          id={inputId}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={amount}
          disabled={disabled}
          onChange={(e) => onAmount(e.target.value)}
          className="min-w-0 flex-1"
        />
        <span className="text-sm text-ink-muted">{period === 'one_time' ? '' : 'per'}</span>
        <Select
          aria-label="Fee period"
          value={period}
          disabled={disabled}
          onChange={(e) => onPeriod(e.target.value as FeePeriod)}
          className="w-32 shrink-0"
        >
          {FEE_PERIODS.map((p) => (
            <option key={p} value={p}>
              {FEE_PERIOD_UNIT[p]}
            </option>
          ))}
        </Select>
      </div>
      {line && <p className="mt-1 text-xs text-ink-faint">{line}</p>}
    </div>
  );
}
