import type { RateCardRow } from '@hsdg/contracts';
import { cardsInForce, profitabilityPath, rateProblem } from '@/lib/practice-finance-api';
import { periodPresets } from '@/components/reports/profitability-period';

const card = (gradeId: string, effectiveFrom: string, cost: string): RateCardRow => ({
  id: `${gradeId}-${effectiveFrom}`,
  gradeId,
  gradeName: gradeId,
  financialYear: '2026-27',
  costRatePerHour: cost,
  chargeOutRatePerHour: cost,
  effectiveFrom,
});

describe('profitabilityPath', () => {
  it('leaves empty filters out', () => {
    expect(profitabilityPath({})).toBe('/reports/profitability');
    expect(profitabilityPath({ from: '2026-07-01', partnerId: '', entityId: undefined })).toBe(
      '/reports/profitability?from=2026-07-01',
    );
  });
  it('carries every filter, on any base', () => {
    expect(
      profitabilityPath(
        {
          from: '2026-07-01',
          to: '2026-09-30',
          by: 'partner',
          partnerId: 'p',
          officeId: 'o',
          serviceId: 's',
          entityId: 'e',
        },
        '/reports/profitability/csv',
      ),
    ).toBe(
      '/reports/profitability/csv?from=2026-07-01&to=2026-09-30&by=partner&partnerId=p&officeId=o&serviceId=s&entityId=e',
    );
  });
});

describe('cardsInForce', () => {
  it('takes each grade’s latest card on or before the day, never a future one', () => {
    const cards = [
      card('senior', '2026-12-01', '700'),
      card('senior', '2026-08-15', '600'),
      card('senior', '2026-04-01', '500'),
      card('manager', '2027-01-01', '1000'),
    ];
    const now = cardsInForce(cards, '2026-11-04');
    expect(now.get('senior')?.costRatePerHour).toBe('600');
    expect(now.has('manager')).toBe(false);
    expect(cardsInForce(cards, '2026-08-14').get('senior')?.costRatePerHour).toBe('500');
  });
});

describe('rateProblem', () => {
  it('takes rupees with up to 2 decimals, and a blank pair', () => {
    expect(rateProblem('', '')).toBeNull();
    expect(rateProblem('750', '1250.50')).toBeNull();
    expect(rateProblem('750', '')).toMatch(/rupees an hour/);
    expect(rateProblem('-1', '10')).toMatch(/rupees an hour/);
    expect(rateProblem('1.234', '10')).toMatch(/rupees an hour/);
  });
});

describe('periodPresets', () => {
  it('gives the last quarter, last and this month, this FY and last FY', () => {
    expect(periodPresets('2026-11-04')).toEqual([
      { label: 'Last quarter', from: '2026-07-01', to: '2026-09-30' },
      { label: 'Last month', from: '2026-10-01', to: '2026-10-31' },
      { label: 'This month', from: '2026-11-01', to: '2026-11-04' },
      { label: 'This FY to date', from: '2026-04-01', to: '2026-11-04' },
      { label: 'Last FY', from: '2025-04-01', to: '2026-03-31' },
    ]);
  });
  it('rolls back over January and March', () => {
    const jan = periodPresets('2027-01-10');
    expect(jan[1]).toEqual({ label: 'Last month', from: '2026-12-01', to: '2026-12-31' });
    expect(jan[3]).toEqual({ label: 'This FY to date', from: '2026-04-01', to: '2027-01-10' });
    expect(periodPresets('2028-03-05')[1]).toEqual({
      label: 'Last month',
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });
});
