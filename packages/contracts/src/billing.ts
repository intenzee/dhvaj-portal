/**
 * Practice Services Phase 2 · Fees to cash (PS-201 onwards).
 *
 * The pure money helpers live here so the API, the web and the tests share one
 * rounding: GST split, Indian amount in words, the financial year and the
 * invoice number. Money crosses the wire as decimal strings ('1234.50'); the
 * helpers work in whole paise so nothing drifts in floating point.
 */

/** SAC for accounting, auditing and book-keeping services (the firm may change it). */
export const SAC_DEFAULT = '998221';

/** The GST rates a line may carry; professional services are 18%. */
export const GST_RATES = [0, 5, 12, 18, 28] as const;

/** GST rule 46: an invoice number is at most 16 characters. */
export const INVOICE_NUMBER_MAX = 16;

/** Firm billing settings (Billing → Settings): who we are on the invoice. */
export interface BillingSettings {
  firmName: string;
  address: string | null;
  gstin: string | null;
  /** Two-digit GST state code of the firm's registration; null until set. */
  stateCode: string | null;
  sacDefault: string;
  /** 1–5 capitals or digits, e.g. 'INV' → INV/26-27/0001. */
  invoicePrefix: string;
  /** Due date = issue date + this many days unless the invoice says otherwise. */
  invoiceTermsDays: number;
  version: number;
  updatedAt: string;
}

export interface UpdateBillingSettingsInput {
  gstin?: string | null;
  stateCode?: string | null;
  sacDefault?: string;
  invoicePrefix?: string;
  invoiceTermsDays?: number;
  version: number;
}

/** Voiding an issued invoice needs `billing.approve` and a reason. */
export interface VoidInvoiceInput {
  reason: string;
}

// ── Paise ────────────────────────────────────────────────────────────────

/** '1234.5' / 1234.5 → 123450n. Rejects anything that is not a plain decimal. */
export function toPaise(value: string | number): bigint {
  const s = typeof value === 'number' ? value.toFixed(2) : value.trim();
  const m = /^(-)?(\d+)(?:\.(\d{0,2})\d*)?$/.exec(s);
  if (!m) throw new Error(`Not an amount: ${String(value)}`);
  const rupees = BigInt(m[2]!);
  const paise = BigInt((m[3] ?? '').padEnd(2, '0'));
  const total = rupees * 100n + paise;
  return m[1] ? -total : total;
}

/** 123450n → '1234.50'. */
export function fromPaise(paise: bigint): string {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const rupees = abs / 100n;
  const rest = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${rupees.toString()}.${rest}`;
}

/** a × b / d rounded half up, for non-negative a, b and positive d. */
function mulDivRound(a: bigint, b: bigint, d: bigint): bigint {
  return (a * b * 2n + d) / (2n * d);
}

/** A rate as basis points of a percent: '18' → 1800n, '2.5' → 250n. */
function rateBp(rate: string | number): bigint {
  const bp = toPaise(rate);
  if (bp < 0n || bp > 10000n) throw new Error(`Not a GST rate: ${String(rate)}`);
  return bp;
}

// ── GST split ────────────────────────────────────────────────────────────

export interface GstLine {
  /** quantity × unit amount, before tax. */
  taxableValue: string | number;
  gstRate: string | number;
}

export interface GstRateBand {
  rate: string;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
}

export interface GstSplit {
  /** Firm state = place of supply → CGST + SGST; otherwise IGST. */
  intraState: boolean;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  tax: string;
  total: string;
  /** One band per rate, highest first, as printed on the invoice. */
  byRate: GstRateBand[];
}

/**
 * The CGST/SGST or IGST on an invoice's lines. Tax is worked per rate on the
 * summed taxable value and rounded to the paisa, half up; intra-state each
 * half is rounded on its own so CGST always equals SGST. A missing place of
 * supply is taken as the firm's own state. Pure — tested.
 */
export function gstSplit(
  lines: GstLine[],
  firmState: string | null,
  placeOfSupply: string | null,
): GstSplit {
  const intraState = !placeOfSupply || !firmState || placeOfSupply === firmState;
  const bands = new Map<bigint, bigint>();
  for (const line of lines) {
    const bp = rateBp(line.gstRate);
    bands.set(bp, (bands.get(bp) ?? 0n) + toPaise(line.taxableValue));
  }
  let taxable = 0n;
  let cgst = 0n;
  let sgst = 0n;
  let igst = 0n;
  const byRate: GstRateBand[] = [];
  for (const [bp, base] of [...bands].sort((a, b) => (b[0] > a[0] ? 1 : b[0] < a[0] ? -1 : 0))) {
    const sign = base < 0n ? -1n : 1n;
    const abs = base * sign;
    const half = intraState ? sign * mulDivRound(abs, bp, 20000n) : 0n;
    const whole = intraState ? 0n : sign * mulDivRound(abs, bp, 10000n);
    taxable += base;
    cgst += half;
    sgst += half;
    igst += whole;
    byRate.push({
      rate: fromPaise(bp).replace(/\.?0+$/, '') || '0',
      taxable: fromPaise(base),
      cgst: fromPaise(half),
      sgst: fromPaise(half),
      igst: fromPaise(whole),
    });
  }
  const tax = cgst + sgst + igst;
  return {
    intraState,
    taxable: fromPaise(taxable),
    cgst: fromPaise(cgst),
    sgst: fromPaise(sgst),
    igst: fromPaise(igst),
    tax: fromPaise(tax),
    total: fromPaise(taxable + tax),
    byRate,
  };
}

// ── Amount in words (Indian numbering) ──────────────────────────────────

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  const rest = n % 10;
  return rest ? `${TENS[Math.floor(n / 10)]!}-${ONES[rest]!}` : TENS[Math.floor(n / 10)]!;
}

function below1000(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]!} Hundred` : '', rest ? below100(rest) : '']
    .filter(Boolean)
    .join(' ');
}

/** Whole rupees in lakh and crore: 11800000n → 'One Crore Eighteen Lakh'. */
function indianWords(n: bigint): string {
  if (n === 0n) return 'Zero';
  const parts: string[] = [];
  const crore = n / 10000000n;
  let rest = Number(n % 10000000n);
  if (crore > 0n) parts.push(`${indianWords(crore)} Crore`);
  const lakh = Math.floor(rest / 100000);
  rest %= 100000;
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

/**
 * The total as printed on a tax invoice: '118000' → 'Rupees One Lakh Eighteen
 * Thousand Only'; '10.50' → 'Rupees Ten and Fifty Paise Only'. Pure — tested.
 */
export function amountInWords(amount: string | number): string {
  const paise = toPaise(amount);
  if (paise < 0n) return `Minus ${amountInWords(fromPaise(-paise))}`;
  const rupees = paise / 100n;
  const rest = Number(paise % 100n);
  const words = `Rupees ${indianWords(rupees)}`;
  return rest ? `${words} and ${below100(rest)} Paise Only` : `${words} Only`;
}

// ── Financial year and the invoice number ───────────────────────────────

/** '2026-10-16' → '2026-27'; April starts the year. Pure — tested. */
export function financialYearOf(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * `<prefix>/<YY-YY>/<seq>`: ('INV', '2026-27', 1) → 'INV/26-27/0001'. The year
 * is shortened so a five-letter prefix still fits rule 46's 16 characters.
 * Mirrors hsdg.next_invoice_number. Pure — tested.
 */
export function invoiceNumberFor(prefix: string, financialYear: string, seq: number): string {
  return `${prefix}/${financialYear.slice(2)}/${String(seq).padStart(4, '0')}`;
}

/** '118000' → '1,18,000.00' (lakh grouping). Pure — tested. */
export function formatInr(amount: string | number): string {
  const [whole, paise] = fromPaise(toPaise(amount)).split('.') as [string, string];
  const neg = whole.startsWith('-');
  const digits = neg ? whole.slice(1) : whole;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${rest ? `${rest},${last3}` : last3}.${paise}`;
}
