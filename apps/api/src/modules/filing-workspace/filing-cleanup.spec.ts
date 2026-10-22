import { rowPeriodKeys } from './filing-cleanup.service';

describe('rowPeriodKeys', () => {
  it('takes a GST quarter with the month it shows on', () => {
    expect(rowPeriodKeys('gst', '2026-09')).toEqual(['2026-09', '2026-27:Q2']);
    expect(rowPeriodKeys('gst', '2027-03')).toEqual(['2027-03', '2026-27:Q4']);
    expect(rowPeriodKeys('gst', '2026-12')).toEqual(['2026-12', '2026-27:Q3']);
  });

  it('is just the key for other months and streams', () => {
    expect(rowPeriodKeys('gst', '2026-08')).toEqual(['2026-08']);
    expect(rowPeriodKeys('tds', '2026-09')).toEqual(['2026-09']);
    expect(rowPeriodKeys('tds', '2026-27:Q2')).toEqual(['2026-27:Q2']);
  });
});
