'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Engagement page state kept in the URL (?tab=gst&gstin=…&fy=2026-27&m=10) so
 * a link drops a colleague on the exact month. `set` merges a patch; a null /
 * empty value removes the key. History is replaced, not pushed, so the back
 * button leaves the page rather than stepping through every click.
 */
export function useUrlState(): {
  get: (key: string) => string | null;
  set: (patch: Record<string, string | null | undefined>) => void;
} {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = useCallback((key: string) => params?.get(key) ?? null, [params]);
  const set = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      router.replace(`${pathname}${mergeQuery(params?.toString() ?? '', patch)}`, { scroll: false });
    },
    [params, pathname, router],
  );
  return { get, set };
}

/** `?a=1&b=2` merged with a patch (null / '' deletes). Pure — tested. */
export function mergeQuery(current: string, patch: Record<string, string | null | undefined>): string {
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') next.delete(k);
    else next.set(k, v);
  }
  const s = next.toString();
  return s ? `?${s}` : '';
}

/** `m=10` within FY `2026-27` → `2026-10`; `m=2` → `2027-02`. */
export function monthKeyFor(fy: string, m: string | null): string | null {
  const n = Number(m);
  if (!m || !Number.isInteger(n) || n < 1 || n > 12) return null;
  const start = Number(fy.slice(0, 4));
  const year = n >= 4 ? start : start + 1;
  return `${year}-${String(n).padStart(2, '0')}`;
}

/** `2026-10` → `10` (the URL's `m`). */
export function monthParamOf(periodKey: string): string | null {
  const m = /^\d{4}-(\d{2})$/.exec(periodKey);
  return m ? String(Number(m[1])) : null;
}
