import {
  noticeClock,
  noticeEventEffect,
  noticeTypeLabel,
  type NoticeClockInput,
} from '@hsdg/contracts';

/** PS-101 — the one rule for "what date matters now" on a notice. */
describe('noticeClock', () => {
  const today = '2026-10-16';
  const n = (over: Partial<NoticeClockInput>): NoticeClockInput => ({
    status: 'received',
    internalDueOn: '2026-10-23',
    replyDueOn: '2026-10-26',
    nextHearingOn: null,
    appealDueOn: null,
    ...over,
  });

  it('counts a reply still to file to the firm’s internal date', () => {
    expect(noticeClock(n({}), today)).toEqual({
      due: '2026-10-23',
      label: 'Reply due',
      daysLeft: 7,
      overdue: false,
    });
    expect(noticeClock(n({ status: 'in_progress' }), today)?.label).toBe('Reply due');
    // No internal date (no buffer computed yet): the department's date.
    expect(noticeClock(n({ internalDueOn: null }), today)?.due).toBe('2026-10-26');
  });

  it('is overdue once the date has passed', () => {
    expect(noticeClock(n({ internalDueOn: '2026-10-14' }), today)).toMatchObject({
      daysLeft: -2,
      overdue: true,
    });
    expect(noticeClock(n({ internalDueOn: today }), today)).toMatchObject({
      daysLeft: 0,
      overdue: false,
    });
  });

  it('shows the hearing once the reply is filed, and the earlier of the two before', () => {
    expect(
      noticeClock(n({ status: 'reply_filed', nextHearingOn: '2026-11-02' }), today),
    ).toMatchObject({
      label: 'Hearing',
      due: '2026-11-02',
    });
    expect(
      noticeClock(n({ status: 'hearing_scheduled', nextHearingOn: '2026-11-02' }), today)?.label,
    ).toBe('Hearing');
    expect(noticeClock(n({ nextHearingOn: '2026-10-20' }), today)).toMatchObject({
      label: 'Hearing',
      due: '2026-10-20',
    });
    expect(noticeClock(n({ nextHearingOn: '2026-11-20' }), today)).toMatchObject({
      label: 'Reply due',
    });
    // Reply filed, nothing scheduled: nothing to count to.
    expect(noticeClock(n({ status: 'reply_filed' }), today)).toBeNull();
  });

  it('counts an order to its appeal date, and stops once appealed or closed', () => {
    expect(
      noticeClock(n({ status: 'order_received', appealDueOn: '2027-01-01' }), today),
    ).toMatchObject({
      label: 'Appeal by',
      daysLeft: 77,
    });
    expect(noticeClock(n({ status: 'order_received' }), today)).toBeNull();
    for (const status of ['appealed', 'closed', 'withdrawn'] as const)
      expect(
        noticeClock(n({ status, nextHearingOn: '2026-10-20', appealDueOn: '2027-01-01' }), today),
      ).toBeNull();
  });

  it('counts across month and year ends', () => {
    expect(noticeClock(n({ internalDueOn: '2027-01-02' }), '2026-12-30')?.daysLeft).toBe(3);
    expect(noticeClock(n({ internalDueOn: '2027-03-01' }), '2027-02-28')?.daysLeft).toBe(1);
  });
});

describe('noticeEventEffect', () => {
  it('moves the notice with what happened', () => {
    expect(noticeEventEffect('reply_filed', 'in_progress')).toEqual({
      status: 'reply_filed',
      setsHearing: false,
    });
    expect(noticeEventEffect('hearing', 'reply_filed')).toEqual({
      status: 'hearing_scheduled',
      setsHearing: true,
    });
    expect(noticeEventEffect('adjournment_granted', 'hearing_scheduled')).toEqual({
      status: 'hearing_scheduled',
      setsHearing: true,
    });
    expect(noticeEventEffect('order', 'hearing_scheduled')).toEqual({
      status: 'order_received',
      setsHearing: false,
    });
    expect(noticeEventEffect('submission', 'received')).toEqual({
      status: 'in_progress',
      setsHearing: false,
    });
    expect(noticeEventEffect('submission', 'reply_filed')).toEqual({
      status: null,
      setsHearing: false,
    });
    expect(noticeEventEffect('note', 'received')).toEqual({ status: null, setsHearing: false });
  });

  it('leaves a closed notice alone', () => {
    expect(noticeEventEffect('order', 'closed')).toEqual({ status: null, setsHearing: false });
  });
});

describe('noticeTypeLabel', () => {
  it('names the type by form, section and title', () => {
    expect(
      noticeTypeLabel({ form: 'ASMT-10', section: 's.61', title: 'Scrutiny of returns' }),
    ).toBe('ASMT-10 · s.61 · Scrutiny of returns');
    expect(noticeTypeLabel({ form: null, section: 's.143(2)', title: 'Scrutiny assessment' })).toBe(
      's.143(2) · Scrutiny assessment',
    );
  });
});
