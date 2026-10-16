import { computeDeadlines } from '../compliance/compliance-calc';
import { validateEventDetails } from '../compliance/compliance-events';
import { APPEAL_SERVICE_BY_STREAM } from './notice-appeal.service';

/** PS-103 — the limitation arithmetic the order's filing gets (rules of migration 1772300630000). */
const due = (order: string, months: number, days: number) =>
  computeDeadlines(
    {
      referenceDate: new Date(`${order}T00:00:00Z`),
      offsetMonths: months,
      offsetDays: days,
      workingDayAdjustment: 'none',
      internalSlaOffsetDays: 7,
    },
    new Set(),
  ).statutoryDeadline;

describe('appeal limitation dates', () => {
  it('three calendar months clamp to the month end (GST s.107)', () => {
    expect(due('2026-01-31', 3, 0)).toBe('2026-04-30');
    expect(due('2026-11-30', 3, 0)).toBe('2027-02-28');
    expect(due('2027-11-30', 3, 0)).toBe('2028-02-29');
    expect(due('2026-10-16', 3, 0)).toBe('2027-01-16');
  });

  it('day counts run in calendar days (CIT(A) 30, ITAT 60)', () => {
    expect(due('2026-01-31', 0, 30)).toBe('2026-03-02');
    expect(due('2026-10-16', 0, 60)).toBe('2026-12-15');
  });
});

describe('the notice_order event', () => {
  it('keeps the notice and the rule code, nothing else', () => {
    expect(
      validateEventDetails('notice_order', {
        noticeId: '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f',
        appealRuleCode: 'GST_APPEAL_LIMITATION',
        extra: 'x',
      }),
    ).toEqual({
      details: {
        noticeId: '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f',
        appealRuleCode: 'GST_APPEAL_LIMITATION',
      },
    });
    expect(validateEventDetails('notice_order', { noticeId: 'x' })).toHaveProperty('error');
    expect(
      validateEventDetails('notice_order', { noticeId: 'x', appealRuleCode: "x'; drop" }),
    ).toHaveProperty('error');
  });

  it('opens a GST appeal or a direct-tax appeal by the notice stream', () => {
    expect(APPEAL_SERVICE_BY_STREAM.gst).toBe('GST_APPEAL_MATTER');
    expect(APPEAL_SERVICE_BY_STREAM.income_tax).toBe('TAX_APPEAL_MATTER');
    expect(APPEAL_SERVICE_BY_STREAM.tds).toBe('TAX_APPEAL_MATTER');
  });
});
