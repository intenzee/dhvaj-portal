import {
  daysBetween,
  figureForm,
  figureSchema,
  figuresRequiredToLodge,
  gstCrossChecks,
  validateFigures,
} from './filing-figures';
import { applicableItems, templateCandidates } from './compliance-checklist';

describe('figureForm', () => {
  const f = (ruleCode: string, formLabel: string | null, stream: string | null, section: string | null) =>
    figureForm({ ruleCode, formLabel, stream, section });

  it('maps GST returns by form label and section', () => {
    expect(f('GST_GSTR3B_MONTHLY', 'GSTR-3B', 'gst', 'summary')).toBe('gstr3b');
    expect(f('GST_GSTR1_MONTHLY', 'GSTR-1', 'gst', 'outward')).toBe('gstr1');
    expect(f('GST_IFF', 'IFF', 'gst', 'outward')).toBe('gstr1');
    expect(f('GST_PMT06', 'PMT-06', 'gst', 'summary')).toBe('pmt06');
    expect(f('GST_CMP08', 'CMP-08', 'gst', 'summary')).toBe('cmp08');
    expect(f('GST_2B_RECON', null, 'gst', 'inward')).toBe('gst_inward');
    expect(f('GST_GSTR9', 'GSTR-9', 'gst', 'annual')).toBe('gst_annual');
  });

  it('maps the other streams', () => {
    expect(f('TDS_24Q', '24Q', 'tds', null)).toBe('tds');
    expect(f('ITR', 'ITR-6', 'income_tax', null)).toBe('income_tax');
    expect(f('ROC_AOC4', 'AOC-4', 'roc', null)).toBe('roc');
    expect(f('BK_MONTH', null, 'bookkeeping', null)).toBe('none');
  });

  it('requires figures to lodge only for payment-bearing returns', () => {
    expect(figuresRequiredToLodge('gstr3b')).toBe(true);
    expect(figuresRequiredToLodge('pmt06')).toBe(true);
    expect(figuresRequiredToLodge('cmp08')).toBe(true);
    expect(figuresRequiredToLodge('gstr1')).toBe(false);
    expect(figureSchema('none')).toEqual([]);
  });
});

describe('validateFigures', () => {
  const schema = figureSchema('gstr3b');

  it('cleans numbers, drops blanks and rejects unknown keys', () => {
    const r = validateFigures(schema, { output_igst: '1,200.50', output_cgst: '', bogus: 1 });
    expect(r.figures).toEqual({ output_igst: 1200.5 });
    expect(r.errors).toEqual(['Unknown figure "bogus".']);
  });

  it('rejects negatives and more than two decimals', () => {
    const r = validateFigures(schema, { output_igst: -1, output_cgst: 1.234 });
    expect(r.errors).toHaveLength(2);
  });

  it('enforces required fields on lodge unless Nil', () => {
    expect(validateFigures(schema, {}, { forLodge: true }).errors.length).toBe(12);
    expect(validateFigures(schema, {}, { forLodge: true, isNil: true }).errors).toEqual([]);
    expect(validateFigures(schema, {}, { forLodge: false }).errors).toEqual([]);
  });

  it('checks dates and integers', () => {
    const pmt = validateFigures(figureSchema('pmt06'), { paid_on: '12/10/2026' });
    expect(pmt.errors[0]).toMatch(/date/);
    const tds = validateFigures(figureSchema('tds'), { deductee_count: 2.5 });
    expect(tds.errors[0]).toMatch(/whole number/);
  });
});

describe('gstCrossChecks', () => {
  it('flags 3B filed before GSTR-1', () => {
    const w = gstCrossChecks({
      outward: { filedOn: '2026-10-12', figures: null, exportsReported: false },
      summary: { filedOn: '2026-10-10', figures: null },
      inward: null,
      lutFiled: true,
    });
    expect(w.map((x) => x.code)).toEqual(['gstr3b_before_gstr1']);
  });

  it('flags outward tax mismatch over ₹1 and ITC over 2B', () => {
    const w = gstCrossChecks({
      outward: { filedOn: '2026-10-11', figures: { tax_igst: 100, tax_cgst: 50 }, exportsReported: false },
      summary: { filedOn: '2026-10-20', figures: { output_igst: 100, output_cgst: 55, itc_igst: 500 } },
      inward: { figures: { itc_2b: 400 } },
      lutFiled: true,
    });
    expect(w.map((x) => x.code)).toEqual(['outward_tax_mismatch', 'itc_exceeds_2b']);
  });

  it('tolerates ₹1 rounding and flags exports without LUT', () => {
    const w = gstCrossChecks({
      outward: { filedOn: '2026-10-11', figures: { tax_igst: 100 }, exportsReported: true },
      summary: { filedOn: '2026-10-20', figures: { output_igst: 100.8 } },
      inward: null,
      lutFiled: false,
    });
    expect(w.map((x) => x.code)).toEqual(['lut_missing']);
  });
});

describe('daysBetween', () => {
  it('counts calendar days, negative when past', () => {
    expect(daysBetween('2026-10-12', '2026-10-20')).toBe(8);
    expect(daysBetween('2026-10-12', '2026-10-11')).toBe(-1);
  });
});

describe('checklist templates', () => {
  it('resolves most specific first', () => {
    expect(templateCandidates('GST_GSTR3B_MONTHLY', 'gst', 'summary')).toEqual([
      'FILING_GST_GSTR3B_MONTHLY',
      'FILING_GST_SUMMARY',
      'FILING_GST',
      'FILING_GENERIC',
    ]);
    expect(templateCandidates('roc-aoc4', 'roc', null)).toEqual(['FILING_ROC_AOC4', 'FILING_ROC', 'FILING_GENERIC']);
  });

  it('drops items whose profile attribute is not true', () => {
    const items = [
      { code: 'SALES', label: 'Sales register' },
      { code: 'EINV', label: 'E-invoice report', onlyIf: 'eInvoicing' },
      { code: 'EXP', label: 'Shipping bills', onlyIf: 'exporter' },
    ];
    expect(applicableItems(items, { eInvoicing: true, exporter: false }).map((i) => i.code)).toEqual([
      'SALES',
      'EINV',
    ]);
  });
});
