import {
  annualFee,
  frequencyOfFeePeriod,
  fromPaise,
  rupees,
  toPaise,
  type BillingFrequency,
  type FeePeriod,
} from '@hsdg/contracts';

const INVOICES_IN_YEAR: Partial<Record<BillingFrequency, bigint>> = {
  monthly: 12n,
  quarterly: 4n,
  annual: 1n,
};

const INVOICED: Record<BillingFrequency, string> = {
  monthly: 'monthly',
  quarterly: 'quarterly',
  annual: 'yearly',
  milestone: 'by milestone',
  on_completion: 'on completion',
  one_time: 'once',
  event: 'by event',
};

/**
 * CM-4 · the line under a fee input: "= ₹60,000 a year · invoiced monthly,
 * ₹5,000 per invoice". `frequency` is the engagement's invoicing frequency;
 * when it was never set up the fee period decides, as billing does. Null when
 * no valid amount is typed.
 */
export function feeArithmetic(
  amount: string,
  period: FeePeriod,
  frequency: BillingFrequency | null | undefined,
): string | null {
  const typed = amount.trim();
  if (!typed || !/^\d+(\.\d{0,2})?$/.test(typed)) return null;
  const year = annualFee(typed, period)!;
  if (period === 'one_time') return `= ${rupees(typed)} once · invoiced once`;
  const f = frequency ?? frequencyOfFeePeriod(period);
  const n = INVOICES_IN_YEAR[f];
  const head = `= ${rupees(year)} a year · invoiced ${INVOICED[f]}`;
  if (!n) return head;
  return `${head}, ${rupees(fromPaise(toPaise(year) / n))} per invoice`;
}
