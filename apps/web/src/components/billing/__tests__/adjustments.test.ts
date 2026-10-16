import { adjustmentKindLabel, adjustmentPreview, topGstRate } from '../adjustments';
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

  it('labels and the default rate', () => {
    expect(adjustmentKindLabel('write_off')).toBe('Write-off');
    expect(adjustmentKindLabel('credit_note')).toBe('Credit note');
    expect(statementKindLabel('write_off')).toBe('Written off');
    expect(topGstRate([{ gstRate: '5.00' }, { gstRate: '18.00' }])).toBe(18);
    expect(topGstRate([])).toBe(0);
  });
});
