import type { BillableTimeEntry } from '@hsdg/contracts';
import { linesTotal, pickedEntries, pickedStreams, timeStatusLine } from '../time-billing';

const entry = (entryId: string, over: Partial<BillableTimeEntry> = {}) =>
  ({
    entryId,
    stream: 'gst',
    streamLabel: 'GST',
    seconds: 3600,
    status: 'unbilled',
    invoiceNumber: null,
    invoiceStatus: null,
    ...over,
  }) as BillableTimeEntry;

describe('PS-206 time billed once', () => {
  it('says where each entry stands', () => {
    expect(timeStatusLine(entry('a'))).toBe('Unbilled');
    expect(timeStatusLine(entry('a', { status: 'billed', invoiceStatus: 'draft' }))).toBe(
      'On a draft invoice',
    );
    expect(
      timeStatusLine(
        entry('a', { status: 'billed', invoiceNumber: 'INV/26-27/0004', invoiceStatus: 'issued' }),
      ),
    ).toBe('On INV/26-27/0004');
    expect(timeStatusLine(entry('a', { status: 'correction_pending' }))).toBe(
      'Correction awaiting approval',
    );
  });

  it('picks only unbilled entries that are still ticked', () => {
    const rows = [
      entry('a'),
      entry('b', { status: 'billed' }),
      entry('c', { status: 'correction_pending' }),
      entry('d'),
    ];
    expect(pickedEntries(rows, new Set(['d'])).map((e) => e.entryId)).toEqual(['a']);
  });

  it('lists each picked stream once', () => {
    const rows = [entry('a'), entry('b', { stream: 'roc', streamLabel: 'ROC' }), entry('c')];
    expect(pickedStreams(rows)).toEqual([
      { key: 'gst', label: 'GST' },
      { key: 'roc', label: 'ROC' },
    ]);
  });

  it('totals hours × rate to the paisa', () => {
    expect(
      linesTotal([
        { quantity: '1.50', unitAmount: '2000.00' },
        { quantity: '0.33', unitAmount: '1500.50' },
      ]),
    ).toBe('3495.17');
    expect(linesTotal([])).toBe('0.00');
  });
});
