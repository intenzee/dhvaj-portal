/**
 * Shared date helpers for e2e specs that place records at precise distances
 * from "now". Kept in one place so the local-clock formatting (which must track
 * the machine date the DB compares against) has a single definition.
 */

/** A YYYY-MM-DD date `n` days from today (local clock). */
export const dateFromToday = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
