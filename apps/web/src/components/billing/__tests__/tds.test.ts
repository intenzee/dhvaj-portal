import { parseTolerance, settingsChanges } from '../billing-settings';
import { bookingNote, financialYearsFor, importSummary, tdsReminderLine } from '../tds';

describe('PS-204 TDS against 26AS', () => {
  it('offers the year today falls in, then the ones before', () => {
    expect(financialYearsFor('2026-10-17')).toEqual(['2026-27', '2025-26', '2024-25', '2023-24']);
    expect(financialYearsFor('2027-03-31', 1)).toEqual(['2026-27', '2025-26']);
    expect(financialYearsFor('2027-04-01', 0)).toEqual(['2027-28']);
  });

  it('says what a booking status that is not final means', () => {
    expect(bookingNote('F')).toBeNull();
    expect(bookingNote(null)).toBeNull();
    expect(bookingNote('U')).toMatch(/Unmatched in TRACES/);
    expect(bookingNote('P')).toMatch(/Provisional/);
  });

  it('describes the last reminder', () => {
    expect(tdsReminderLine(null)).toBeNull();
    expect(
      tdsReminderLine({ channel: 'whatsapp', at: '2026-10-16T09:00:00.000Z', byName: 'Partner A' }),
    ).toMatch(/^Asked .+ · WhatsApp · Partner A$/);
    expect(
      tdsReminderLine({ channel: 'copy', at: '2026-10-16T09:00:00.000Z', byName: null }),
    ).toMatch(/· text copied$/);
  });

  it('sums an import up in one line', () => {
    const r = {
      batchId: 'b',
      source: '26as_text' as const,
      financialYear: '2026-27',
      pan: null,
      credits: 6,
      deductors: 3,
      tdsTotal: '17480.40',
      superseded: 1,
      warnings: [],
    };
    expect(importSummary(r)).toMatch(
      /^26AS for 2026-27: 6 credits from 3 deductors, .*17,480\.40 of TDS\. It replaced 1 row of earlier imports\.$/,
    );
    expect(
      importSummary({ ...r, source: 'form16a_pdf', credits: 1, deductors: 1, superseded: 0 }),
    ).toMatch(/^Form 16A \(2026-27\): 1 credit from 1 deductor, .* of TDS\.$/);
  });

  it('reads the match tolerance and sends it only when it changed', () => {
    expect(parseTolerance('1')).toBe('1.00');
    expect(parseTolerance(' 0.5 ')).toBe('0.50');
    expect(parseTolerance('1000')).toBe('1000.00');
    expect(parseTolerance('1000.01')).toBeNull();
    expect(parseTolerance('-1')).toBeNull();
    expect(parseTolerance('')).toBeNull();
    const before = {
      firmName: 'F',
      address: null,
      gstin: null,
      stateCode: null,
      sacDefault: '998221',
      invoicePrefix: 'INV',
      invoiceTermsDays: 15,
      invoiceReminderDays: [7, 15, 30],
      autoInvoiceReminders: false,
      tdsMatchTolerance: '1.00',
      gstFiledThrough: null,
      version: 3,
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    const form = {
      gstin: '',
      stateCode: '',
      sacDefault: '998221',
      invoicePrefix: 'INV',
      invoiceTermsDays: '15',
    };
    expect(settingsChanges(before, { ...form, tdsMatchTolerance: '1' })).toEqual({ version: 3 });
    expect(settingsChanges(before, { ...form, tdsMatchTolerance: '2.5' })).toEqual({
      version: 3,
      tdsMatchTolerance: '2.50',
    });
  });
});
