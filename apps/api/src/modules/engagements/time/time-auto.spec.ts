import { dayEndCutoff, daysAgo, istToday, otherTimeWindow } from './auto-time';

describe('automatic time — pure helpers', () => {
  it('day-end cut-off is 20:00 IST (14:30 UTC) once reached, else null', () => {
    expect(dayEndCutoff(new Date('2026-10-12T14:29:00Z'))).toBeNull();
    expect(dayEndCutoff(new Date('2026-10-12T14:31:00Z'))?.toISOString()).toBe(
      '2026-10-12T14:30:00.000Z',
    );
    // 01:00 IST on the 13th is still before that day's cut-off.
    expect(dayEndCutoff(new Date('2026-10-12T19:30:00Z'))).toBeNull();
    expect(dayEndCutoff(new Date('2026-10-12T16:00:00Z'), 21)?.toISOString()).toBe(
      '2026-10-12T15:30:00.000Z',
    );
  });

  it('IST date rolls over at 18:30 UTC', () => {
    expect(istToday(new Date('2026-10-12T18:29:00Z'))).toBe('2026-10-12');
    expect(istToday(new Date('2026-10-12T18:31:00Z'))).toBe('2026-10-13');
  });

  it('other time today ends now; on a past day it ends 18:00 IST', () => {
    const now = new Date('2026-10-12T08:00:00Z');
    const today = otherTimeWindow('2026-10-12', 30, now);
    expect(today.endedAt).toEqual(now);
    expect(today.startedAt.toISOString()).toBe('2026-10-12T07:30:00.000Z');
    const past = otherTimeWindow('2026-10-10', 90, now);
    expect(past.endedAt.toISOString()).toBe('2026-10-10T12:30:00.000Z');
    expect(past.startedAt.toISOString()).toBe('2026-10-10T11:00:00.000Z');
  });

  it('daysAgo counts IST days', () => {
    const now = new Date('2026-10-12T08:00:00Z');
    expect(daysAgo('2026-10-12', now)).toBe(0);
    expect(daysAgo('2026-10-09', now)).toBe(3);
    expect(daysAgo('2026-10-13', now)).toBe(-1);
  });
});
