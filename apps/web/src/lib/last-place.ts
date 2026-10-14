/**
 * WF-203: the last tab and period someone had open on each engagement, kept in
 * this browser so the Engagements list reopens it. Best effort — storage can be
 * blocked or cleared, and every read and write is wrapped.
 */

const KEY = (engagementId: string): string => `hsdg.lastPlace.${engagementId}`;
/** Only these parameters are a "place" (tab, year, registration, period, part). */
const PLACE_PARAMS = ['tab', 'fy', 'gstin', 'm', 'p', 'part'];

export function rememberPlace(engagementId: string, search: string): void {
  const all = new URLSearchParams(search);
  const place = new URLSearchParams();
  for (const k of PLACE_PARAMS) {
    const v = all.get(k);
    if (v) place.set(k, v);
  }
  try {
    if (place.get('tab')) window.localStorage.setItem(KEY(engagementId), place.toString());
  } catch {
    /* storage unavailable: nothing to remember */
  }
}

/** `/engagements/:id?…` at the remembered place, or null with none. */
export function rememberedHref(engagementId: string): string | null {
  try {
    const q = window.localStorage.getItem(KEY(engagementId));
    return q ? `/engagements/${engagementId}?${q}` : null;
  } catch {
    return null;
  }
}
