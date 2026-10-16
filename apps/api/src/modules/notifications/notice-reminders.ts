/**
 * PS-102 — when the sweep nudges a notice's owner. Pure, so the bands are
 * unit-tested without a database; notifications-scan.service.ts applies them.
 */

/** Days before the internal reply date that each nudge goes out. */
export const NOTICE_REPLY_BANDS = [7, 3, 1] as const;
/** Days before a hearing that its nudge goes out. */
export const NOTICE_HEARING_LEAD_DAYS = 2;

/**
 * The reply band a notice is in, `daysLeft` days from its internal reply date:
 * the tightest band it has reached (7 → 3 → 1). A date already past still
 * gets the 1-day nudge once, when the sweep first sees it. Null when more than
 * 7 days away.
 */
export function noticeReplyBand(daysLeft: number): number | null {
  let band: number | null = null;
  for (const b of NOTICE_REPLY_BANDS) if (daysLeft <= b) band = b;
  return band;
}

/** A hearing today, tomorrow or the day after is nudged; a past one is not. */
export function noticeHearingDue(daysLeft: number): boolean {
  return daysLeft >= 0 && daysLeft <= NOTICE_HEARING_LEAD_DAYS;
}

/** "in 3 days" / "tomorrow" / "today" / "2 days ago" — for the nudge's title. */
export function inDays(daysLeft: number): string {
  if (daysLeft === 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  if (daysLeft > 1) return `in ${daysLeft} days`;
  return daysLeft === -1 ? 'yesterday' : `${-daysLeft} days ago`;
}
