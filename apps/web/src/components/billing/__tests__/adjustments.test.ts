import type { InvoiceAdjustment, InvoiceLineItem } from '@hsdg/contracts';
import {
  adjustmentKindLabel,
  adjustmentPreview,
  creditNotePreview,
  creditedByLine,
} from '../adjustments';
import { statementKindLabel } from '../receipts';

const invoice = {
  balance: '118000.00',
  cgst: '9000.00',
  sgst: '9000.00',
  igst: '0.00',
  placeOfSupplyState: '07',
  isReverseCharge: false,
};
const gst = { firmState: '07', rate: 18 };

describe('PS-205 adjustments', () => {
  it('a write-off is its amount, never taxed', () => {
    expect(adjustmentPreview('write_off', '5000', invoice, gst)).toEqual({
      ok: true,
      taxable: '5000.00',
      cgst: '0.00',
      sgst: '0.00',
      igst: '0.00',
      total: '5000.00',
    });
  });

  it('a credit note adds GST as the invoice charged it (reuses gstSplit)', () => {
    expect(adjustmentPreview('credit_note', '5000', invoice, gst)).toMatchObject({
      ok: true,
      cgst: '450.00',
      sgst: '450.00',
      total: '5900.00',
    });
    expect(
      adjustmentPreview('credit_note', '5000', { ...invoice, placeOfSupplyState: '27' }, gst),
    ).toMatchObject({ igst: '900.00', total: '5900.00' });
  });

  it('no GST on a credit note when the invoice charged none', () => {
    expect(
      adjustmentPreview('credit_note', '5000', { ...invoice, isReverseCharge: true }, gst),
    ).toMatchObject({ total: '5000.00' });
    expect(
      adjustmentPreview('credit_note', '5000', { ...invoice, cgst: '0', sgst: '0' }, gst),
    ).toMatchObject({ total: '5000.00' });
  });

  it('refuses nothing, nonsense, or more than is owed', () => {
    expect(adjustmentPreview('write_off', '', invoice, gst)).toMatchObject({ ok: false });
    expect(adjustmentPreview('write_off', 'abc', invoice, gst)).toMatchObject({ ok: false });
    expect(adjustmentPreview('write_off', '118000.01', invoice, gst)).toEqual({
      ok: false,
      error: 'More than the 118000.00 still owed.',
    });
    // 100,000 + 18% = 1,18,000 fits exactly.
    expect(adjustmentPreview('credit_note', '100000', invoice, gst)).toMatchObject({ ok: true });
  });

  it('labels', () => {
    expect(adjustmentKindLabel('write_off')).toBe('Write-off');
    expect(adjustmentKindLabel('credit_note')).toBe('Credit note');
    expect(statementKindLabel('write_off')).toBe('Written off');
  });
});

describe('PS-205 credit notes per invoice line', () => {
  const line = (id: string, taxableValue: string, gstRate: string, description: string) =>
    ({ id, taxableValue, gstRate, description }) as InvoiceLineItem;
  const inv = {
    ...invoice,
    balance: '13900.00',
    lines: [line('a', '10000.00', '18.00', 'GST returns'), line('b', '2000.00', '5.00', 'Courier')],
  };
  const cn = (status: InvoiceAdjustment['status'], lines: [string, string][]) =>
    ({
      kind: 'credit_note',
      status,
      lines: lines.map(([invoiceLineId, taxableValue]) => ({ invoiceLineId, taxableValue })),
    }) as InvoiceAdjustment;

  it('adds up what pending and approved credit notes take off each line', () => {
    const m = creditedByLine([
      cn('approved', [['a', '1000.00']]),
      cn('pending', [
        ['a', '500.00'],
        ['b', '2000.00'],
      ]),
      cn('rejected', [['a', '9000.00']]),
      { kind: 'write_off', status: 'approved', lines: [] } as unknown as InvoiceAdjustment,
    ]);
    expect(Object.fromEntries(m)).toEqual({ a: '1500.00', b: '2000.00' });
  });

  it('taxes each line at its own rate and skips blank lines', () => {
    const r = creditNotePreview({ a: '1000', b: ' ' }, inv, '07', new Map());
    expect(r).toMatchObject({ ok: true, taxable: '1000.00', total: '1180.00' });
    const both = creditNotePreview({ a: '1000', b: '2000' }, inv, '07', new Map());
    expect(both).toMatchObject({ ok: true, total: '3280.00' });
  });

  it('refuses more than is left of a line, or nothing at all', () => {
    expect(creditNotePreview({ b: '1' }, inv, '07', new Map([['b', '2000.00']]))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/left to credit/),
    });
    expect(creditNotePreview({}, inv, '07', new Map())).toMatchObject({ ok: false });
  });
});
