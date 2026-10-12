/**
 * Change 5 — the figures a filing records ("a few numbers that make the log
 * useful later"), the schema per return, server-side validation, and the
 * cross-checks shown as warnings (never blocks). Pure and DI-free.
 */
import type { CrossCheckWarning, FigureField } from '@hsdg/contracts';

type FigureValue = string | number | null;
export type Figures = Record<string, FigureValue>;

const HEADS: Array<[string, string]> = [
  ['igst', 'IGST'],
  ['cgst', 'CGST'],
  ['sgst', 'SGST / UTGST'],
  ['cess', 'Cess'],
];

function byHead(prefix: string, label: string, required: boolean): FigureField[] {
  return HEADS.map(([k, head]) => ({
    key: `${prefix}_${k}`,
    label: `${label} — ${head}`,
    kind: 'amount' as const,
    required,
    group: label,
  }));
}

export type FigureForm =
  | 'gstr1'
  | 'gstr3b'
  | 'pmt06'
  | 'cmp08'
  | 'gst_inward'
  | 'gst_annual'
  | 'tds'
  | 'income_tax'
  | 'roc'
  | 'none';

const SCHEMAS: Record<FigureForm, FigureField[]> = {
  gstr1: [
    { key: 'taxable_value', label: 'Taxable value', kind: 'amount', required: false },
    ...byHead('tax', 'Tax', false),
  ],
  gstr3b: [
    ...byHead('output', 'Output tax', true),
    ...byHead('itc', 'ITC used', true),
    ...byHead('cash', 'Cash paid', true),
    { key: 'interest_paid', label: 'Interest paid', kind: 'amount', required: false },
    { key: 'late_fee_paid', label: 'Late fee paid', kind: 'amount', required: false },
    { key: 'closing_credit', label: 'Closing credit ledger', kind: 'amount', required: false },
  ],
  pmt06: [
    { key: 'cpin', label: 'CPIN', kind: 'text', required: true },
    { key: 'cin', label: 'CIN', kind: 'text', required: true },
    { key: 'bank', label: 'Bank', kind: 'text', required: false },
    { key: 'paid_on', label: 'Paid on', kind: 'date', required: true },
    ...byHead('paid', 'Amount paid', true),
  ],
  cmp08: [
    { key: 'tax_payable', label: 'Tax payable', kind: 'amount', required: true },
    { key: 'tax_paid', label: 'Tax paid', kind: 'amount', required: true },
    { key: 'interest_paid', label: 'Interest paid', kind: 'amount', required: false },
  ],
  gst_inward: [
    { key: 'itc_books', label: 'ITC per books', kind: 'amount', required: false },
    { key: 'itc_2b', label: 'ITC per 2B', kind: 'amount', required: false },
    { key: 'itc_eligible', label: 'Eligible ITC', kind: 'amount', required: false },
    { key: 'itc_claimed', label: 'ITC claimed', kind: 'amount', required: false },
    { key: 'itc_deferred', label: 'ITC deferred', kind: 'amount', required: false },
    { key: 'rcm_liability', label: 'RCM liability', kind: 'amount', required: false },
  ],
  gst_annual: [
    { key: 'turnover', label: 'Aggregate turnover', kind: 'amount', required: false },
    { key: 'tax_paid', label: 'Total tax paid', kind: 'amount', required: false },
    {
      key: 'additional_liability',
      label: 'Additional liability (DRC-03)',
      kind: 'amount',
      required: false,
    },
  ],
  tds: [
    { key: 'deductee_count', label: 'Deductees', kind: 'integer', required: false },
    { key: 'tax_deducted', label: 'Tax deducted', kind: 'amount', required: false },
    { key: 'tax_deposited', label: 'Tax deposited', kind: 'amount', required: false },
  ],
  income_tax: [
    { key: 'total_income', label: 'Total income', kind: 'amount', required: false },
    { key: 'tax_payable', label: 'Tax payable', kind: 'amount', required: false },
    { key: 'refund', label: 'Refund claimed', kind: 'amount', required: false },
  ],
  roc: [{ key: 'fee_paid', label: 'Filing fee paid', kind: 'amount', required: false }],
  none: [],
};

/** Forms whose figures must be entered to lodge (spec p.24). */
const FIGURES_REQUIRED: ReadonlySet<FigureForm> = new Set(['gstr3b', 'pmt06', 'cmp08']);

const norm = (s: string | null | undefined): string =>
  (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Which figure schema a filing uses, from its rule code / form label / section. */
export function figureForm(input: {
  ruleCode: string;
  formLabel: string | null;
  stream: string | null;
  section: string | null;
}): FigureForm {
  const id = `${norm(input.formLabel)}|${norm(input.ruleCode)}`;
  if (
    input.stream === 'gst' ||
    id.includes('GSTR') ||
    id.includes('PMT06') ||
    id.includes('CMP08')
  ) {
    if (id.includes('PMT06')) return 'pmt06';
    if (id.includes('CMP08')) return 'cmp08';
    if (id.includes('GSTR3B') || input.section === 'summary') return 'gstr3b';
    if (id.includes('GSTR1') || id.includes('IFF') || input.section === 'outward') return 'gstr1';
    if (input.section === 'inward') return 'gst_inward';
    if (input.section === 'annual' || id.includes('GSTR9')) return 'gst_annual';
    return 'none';
  }
  if (input.stream === 'tds') return 'tds';
  if (input.stream === 'income_tax') return 'income_tax';
  if (input.stream === 'roc') return 'roc';
  return 'none';
}

export function figureSchema(form: FigureForm): FigureField[] {
  return SCHEMAS[form];
}

export function figuresRequiredToLodge(form: FigureForm): boolean {
  return FIGURES_REQUIRED.has(form);
}

/**
 * Validate figures against the schema. Unknown keys are rejected; empty values
 * are dropped. `forLodge` also enforces the required fields (unless Nil).
 * Returns the cleaned figures or a list of errors.
 */
export function validateFigures(
  schema: FigureField[],
  input: Record<string, unknown>,
  opts: { forLodge: boolean; isNil?: boolean } = { forLodge: false },
): { figures: Figures; errors: string[] } {
  const errors: string[] = [];
  const fields = new Map(schema.map((f) => [f.key, f]));
  const out: Figures = {};
  for (const [key, raw] of Object.entries(input)) {
    const f = fields.get(key);
    if (!f) {
      errors.push(`Unknown figure "${key}".`);
      continue;
    }
    if (raw === null || raw === undefined || raw === '') continue;
    if (f.kind === 'amount' || f.kind === 'integer') {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
      if (!Number.isFinite(n) || n < 0) {
        errors.push(`${f.label} must be a non-negative number.`);
        continue;
      }
      if (f.kind === 'integer' && !Number.isInteger(n)) {
        errors.push(`${f.label} must be a whole number.`);
        continue;
      }
      if (f.kind === 'amount' && Math.round(n * 100) !== n * 100) {
        errors.push(`${f.label} has more than two decimals.`);
        continue;
      }
      if (n > 1e13) {
        errors.push(`${f.label} is too large.`);
        continue;
      }
      out[key] = n;
    } else if (f.kind === 'date') {
      const s = String(raw);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
        errors.push(`${f.label} must be a date (YYYY-MM-DD).`);
        continue;
      }
      out[key] = s;
    } else {
      const s = String(raw).trim();
      if (s.length > 100) {
        errors.push(`${f.label} is too long.`);
        continue;
      }
      if (s) out[key] = s;
    }
  }
  if (opts.forLodge && !opts.isNil) {
    for (const f of schema) {
      if (f.required && (out[f.key] === undefined || out[f.key] === null)) {
        errors.push(`${f.label} is required to lodge.`);
      }
    }
  }
  return { figures: out, errors };
}

const sumHeads = (f: Figures | null | undefined, prefix: string): number | null => {
  if (!f) return null;
  let any = false;
  let total = 0;
  for (const [k] of HEADS) {
    const v = f[`${prefix}_${k}`];
    if (typeof v === 'number') {
      any = true;
      total += v;
    }
  }
  return any ? total : null;
};

export interface CrossCheckInput {
  /** The month's GSTR-1 / IFF (outward) — filing date and figures. */
  outward: { filedOn: string | null; figures: Figures | null; exportsReported: boolean } | null;
  /** The month's GSTR-3B (summary). */
  summary: { filedOn: string | null; figures: Figures | null } | null;
  /** The month's inward reconciliation figures. */
  inward: { figures: Figures | null } | null;
  /** A current LUT is filed for the FY. */
  lutFiled: boolean;
}

/** Spec p.23 — cross-checks shown as warnings, never hard blocks. */
export function gstCrossChecks(i: CrossCheckInput): CrossCheckWarning[] {
  const w: CrossCheckWarning[] = [];
  if (
    i.summary?.filedOn &&
    i.outward &&
    (!i.outward.filedOn || i.summary.filedOn < i.outward.filedOn)
  ) {
    w.push({
      code: 'gstr3b_before_gstr1',
      message: 'GSTR-3B was filed before GSTR-1 for the same period.',
    });
  }
  const tax1 = sumHeads(i.outward?.figures, 'tax');
  const tax3b = sumHeads(i.summary?.figures, 'output');
  if (tax1 !== null && tax3b !== null && Math.abs(tax1 - tax3b) > 1) {
    w.push({
      code: 'outward_tax_mismatch',
      message: `3B outward tax (₹${tax3b.toFixed(2)}) differs from GSTR-1 (₹${tax1.toFixed(2)}) by more than ₹1.`,
    });
  }
  const itcUsed = sumHeads(i.summary?.figures, 'itc');
  const itc2b = i.inward?.figures?.itc_eligible ?? i.inward?.figures?.itc_2b;
  if (itcUsed !== null && typeof itc2b === 'number' && itcUsed > itc2b + 1) {
    w.push({
      code: 'itc_exceeds_2b',
      message: `ITC claimed (₹${itcUsed.toFixed(2)}) exceeds 2B eligible ITC (₹${itc2b.toFixed(2)}).`,
    });
  }
  if (i.outward?.exportsReported && !i.lutFiled) {
    w.push({
      code: 'lut_missing',
      message: 'Exports are reported but no LUT is filed for this year.',
    });
  }
  return w;
}

/** Days from `from` to `to` (YYYY-MM-DD), negative when past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}
