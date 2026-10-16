import { inDays, noticeHearingDue, noticeReplyBand } from './notice-reminders';

describe('notice reminders (PS-102)', () => {
  it('nudges the reply at 7, 3 and 1 days — the tightest band reached', () => {
    expect(noticeReplyBand(10)).toBeNull();
    expect(noticeReplyBand(8)).toBeNull();
    expect(noticeReplyBand(7)).toBe(7);
    expect(noticeReplyBand(4)).toBe(7);
    expect(noticeReplyBand(3)).toBe(3);
    expect(noticeReplyBand(2)).toBe(3);
    expect(noticeReplyBand(1)).toBe(1);
    expect(noticeReplyBand(0)).toBe(1);
    // Past the date: the last nudge, once (the dedup key carries the band).
    expect(noticeReplyBand(-5)).toBe(1);
  });

  it('nudges a hearing from 2 days before until the day itself', () => {
    expect(noticeHearingDue(3)).toBe(false);
    expect(noticeHearingDue(2)).toBe(true);
    expect(noticeHearingDue(0)).toBe(true);
    expect(noticeHearingDue(-1)).toBe(false);
  });

  it('says when, in words', () => {
    expect(inDays(0)).toBe('today');
    expect(inDays(1)).toBe('tomorrow');
    expect(inDays(3)).toBe('in 3 days');
    expect(inDays(-1)).toBe('yesterday');
    expect(inDays(-4)).toBe('4 days ago');
  });
});
