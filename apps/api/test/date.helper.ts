/**
 * Shared date helpers for e2e specs that place records at precise distances
 * from "now". Kept in one place so the formatting has a single definition.
 *
 * Dates are computed in **UTC**, because that is the clock the database compares
 * against: the Postgres container runs in UTC, so `CURRENT_DATE` (which every
 * escalation/overdue query uses) is the UTC date. Formatting from the machine's
 * *local* components instead would drift a full day from the DB whenever the
 * host is in a timezone ahead of UTC and the local time is just past midnight —
 * silently flipping boundary cases like "due today" to "due soon".
 */

/** A YYYY-MM-DD date `n` days from today, in UTC (the date the DB compares against). */
export const dateFromToday = (n: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
