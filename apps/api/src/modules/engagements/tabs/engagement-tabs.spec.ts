import { fyOf, fyRange } from './engagement-tabs.service';

describe('financial year helpers', () => {
  it('maps a date to its April–March year', () => {
    expect(fyOf('2026-10-12')).toBe('2026-27');
    expect(fyOf('2026-04-01')).toBe('2026-27');
    expect(fyOf('2027-03-31')).toBe('2026-27');
    expect(fyOf('2099-12-01')).toBe('2099-00');
  });

  it('gives the year range', () => {
    expect(fyRange('2026-27')).toEqual({ from: '2026-04-01', to: '2027-03-31' });
  });
});
