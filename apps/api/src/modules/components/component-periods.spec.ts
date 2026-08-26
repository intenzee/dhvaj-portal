import { enumeratePeriods, financialYearBounds } from './component-periods';

describe('component-periods', () => {
  it('derives FY bounds (Indian FY)', () => {
    expect(financialYearBounds('2026-27')).toEqual({ startYear: 2026, endYear: 2027 });
  });

  it('rejects a malformed financial year', () => {
    expect(() => financialYearBounds('2026')).toThrow();
  });

  it('enumerates 12 FY-aligned months Apr→Mar', () => {
    const p = enumeratePeriods('monthly', '2026-27');
    expect(p).toHaveLength(12);
    expect(p[0]).toEqual({
      key: '2026-04',
      label: 'Apr 2026',
      start: '2026-04-01',
      end: '2026-04-30',
    });
    expect(p[11]).toEqual({
      key: '2027-03',
      label: 'Mar 2027',
      start: '2027-03-01',
      end: '2027-03-31',
    });
    // February of the following calendar year lands correctly.
    expect(p.find((x) => x.key === '2027-02')?.end).toBe('2027-02-28');
  });

  it('enumerates 4 FY-aligned quarters', () => {
    const p = enumeratePeriods('quarterly', '2026-27');
    expect(p.map((x) => x.key)).toEqual(['2026-27-Q1', '2026-27-Q2', '2026-27-Q3', '2026-27-Q4']);
    expect(p[0]).toMatchObject({ start: '2026-04-01', end: '2026-06-30' });
    expect(p[3]).toMatchObject({ start: '2027-01-01', end: '2027-03-31' });
  });

  it('enumerates 2 halves', () => {
    const p = enumeratePeriods('half_yearly', '2026-27');
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ start: '2026-04-01', end: '2026-09-30' });
    expect(p[1]).toMatchObject({ start: '2026-10-01', end: '2027-03-31' });
  });

  it('annual and one_time yield a single FY period', () => {
    for (const freq of ['annual', 'one_time'] as const) {
      const p = enumeratePeriods(freq, '2026-27');
      expect(p).toHaveLength(1);
      expect(p[0]).toEqual({
        key: '2026-27',
        label: 'FY 2026-27',
        start: '2026-04-01',
        end: '2027-03-31',
      });
    }
  });

  it('as_required is ad-hoc — no auto-generated periods', () => {
    expect(enumeratePeriods('as_required', '2026-27')).toEqual([]);
  });
});
