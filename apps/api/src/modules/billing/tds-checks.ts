import {
  formatInr,
  tdsExpectedBy,
  tdsReturnDueDate,
  tdsSectionKind,
  toPaise,
  type TdsCheck,
  type TdsQuarter,
} from '@hsdg/contracts';

/**
 * PS-204 · what a senior would query in the 26AS before claiming the credit,
 * and when a deduction missing from it is late rather than merely not yet
 * there. Pure — tested.
 */

/** Professional fees: 10% under 194J(b) (1027 under the Income-tax Act 2025). */
export const PROFESSIONAL_RATE = 10;
/** Percentage points a rate may sit from the one it is compared with (rounding to the rupee). */
export const RATE_TOLERANCE = 0.25;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10-31' → '31 Oct 2026'. */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** taxDeducted / amountPaid as a percentage; null when either is not positive. */
export function ratePercent(tax: string, base: string): number | null {
  const t = toPaise(tax);
  const b = toPaise(base);
  if (t <= 0n || b <= 0n) return null;
  return (Number(t) / Number(b)) * 100;
}

const near = (rate: number, to: number): boolean => Math.abs(rate - to) <= RATE_TOLERANCE;
const pct = (rate: number): string => `${Number(rate.toFixed(2))}%`;

/** What a 10%-expected rate says, or null when it is 10%. */
function rateCheck(rate: number, on: 'paid' | 'fee'): TdsCheck | null {
  if (near(rate, PROFESSIONAL_RATE)) return null;
  if (near(rate, 2)) {
    return {
      code: 'rate_2',
      level: 'flag',
      message:
        'TDS at 2%, the rate for technical services (194J(a)), on professional fees that bear 10% under 194J(b): the client short-deducted, and the rest falls on our advance tax.',
    };
  }
  if (near(rate, 20)) {
    return {
      code: 'rate_20',
      level: 'flag',
      message:
        'TDS at 20%: the client did not have our PAN (section 206AA). Send it so they correct the return; the credit is ours either way.',
    };
  }
  if (near(rate, PROFESSIONAL_RATE * 1.18)) {
    return {
      code: 'tds_on_gst',
      level: 'flag',
      message: `TDS at ${pct(rate)} of the fee: the client deducted on the GST too. Under CBDT Circular 23/2017 TDS is due on the fee alone when the GST is shown apart.`,
    };
  }
  return {
    code: on === 'paid' ? 'unusual_rate' : 'booked_rate',
    level: 'flag',
    message: `TDS at ${pct(rate)} of the ${on === 'paid' ? 'amount paid' : 'fee before GST'}; 10% is due on professional fees under 194J(b).`,
  };
}

/** A 26AS credit's checks: section, rate, deposit, booking status and remarks. */
export function creditChecks(c: {
  section: string;
  amountPaid: string;
  taxDeducted: string;
  tdsDeposited: string;
  bookingStatus: string | null;
  remarks: string | null;
}): TdsCheck[] {
  const out: TdsCheck[] = [];
  const kind = tdsSectionKind(c.section);
  const certificate = c.remarks === 'F';
  if (certificate) {
    out.push({
      code: 'lower_deduction_certificate',
      level: 'note',
      message:
        'Remark F: deducted at a lower or nil rate under a certificate (section 197), so the rate is not queried.',
    });
  }
  if (kind === 'contract' || kind === 'commission' || kind === 'other') {
    const what = {
      contract: 'payments to contractors',
      commission: 'commission or brokerage',
      other: 'payments other than professional fees',
    }[kind];
    out.push({
      code: 'wrong_section',
      level: 'flag',
      message: `Deducted under ${c.section}, the section for ${what}; our fees are professional services under 194J(b). Ask the client to correct the return.`,
    });
  } else if (kind === 'director') {
    out.push({
      code: 'director_section',
      level: 'flag',
      message: `Deducted under ${c.section}, the section for a director's fees; our fees are professional services under 194J(b). Ask the client to correct the return.`,
    });
  }
  const rate = ratePercent(c.taxDeducted, c.amountPaid);
  if (rate !== null && !certificate) {
    if (near(rate, 20)) out.push(rateCheck(rate, 'paid')!);
    else if (kind === 'professional_10' || kind === 'technical_2') {
      const check = rateCheck(rate, 'paid');
      if (check) out.push(check);
    }
  }
  const deducted = toPaise(c.taxDeducted);
  const deposited = toPaise(c.tdsDeposited);
  if (deducted > 0n && deposited < deducted) {
    out.push({
      code: 'short_deposit',
      level: 'risk',
      message: `The deductor deposited ₹${formatInr(c.tdsDeposited)} of the ₹${formatInr(c.taxDeducted)} deducted; only what is deposited is ours to claim.`,
    });
  }
  if (c.bookingStatus === 'U') {
    out.push({
      code: 'status_unmatched',
      level: 'risk',
      message:
        "Unmatched (U): the deductor's deposit does not match their return, so the credit is not ours yet; they must correct the challan details.",
    });
  } else if (c.bookingStatus === 'O') {
    out.push({
      code: 'status_overbooked',
      level: 'risk',
      message:
        'Overbooked (O): the return claims more than the challan paid; the credit is not ours until the deductor pays the rest or corrects the return.',
    });
  } else if (c.bookingStatus === 'P') {
    out.push({
      code: 'status_provisional',
      level: 'note',
      message:
        "Provisional (P): a government deductor's credit, final once its pay office verifies it.",
    });
  }
  return out;
}

/** A receipt's TDS against the fee before GST, when the invoices it settled say what that was. */
export function bookedChecks(r: { tdsAmount: string; taxable: string | null }): TdsCheck[] {
  if (!r.taxable) return [];
  const rate = ratePercent(r.tdsAmount, r.taxable);
  if (rate === null) return [];
  const check = rateCheck(rate, 'fee');
  return check ? [check] : [];
}

/**
 * Booked TDS of a quarter that is not in the 26AS: late (null — ask the
 * client) once a 26AS as on or after TDS_26AS_LAG_DAYS past the return's due
 * date still lacks it; till then awaited, with the reason. With no 26AS
 * imported yet, late once that date has passed. `today` is the IST date.
 */
export function awaitedFor(
  financialYear: string,
  quarter: TdsQuarter['quarter'],
  asOn: string | null,
  today: string,
): { expectedBy: string; reason: string } | null {
  const expectedBy = tdsExpectedBy(financialYear, quarter);
  if (asOn && asOn >= expectedBy) return null;
  const due = tdsReturnDueDate(financialYear, quarter);
  if (today <= due) return { expectedBy, reason: `Return due ${longDate(due)}` };
  if (today < expectedBy) {
    return {
      expectedBy,
      reason: `Return was due ${longDate(due)}; the 26AS shows it from about ${longDate(expectedBy)}`,
    };
  }
  if (!asOn) return null;
  return {
    expectedBy,
    reason: `Your 26AS is as on ${longDate(asOn)}; import a newer one (it should show from ${longDate(expectedBy)})`,
  };
}
