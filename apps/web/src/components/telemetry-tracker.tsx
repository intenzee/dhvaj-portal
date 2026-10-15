'use client';

import { Suspense, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  INPUT_WINDOW_MS,
  classifyChange,
  flushTelemetry,
  rowOpenFrom,
  track,
} from '@/lib/telemetry';

function Tracker() {
  const pathname = usePathname();
  const search = useSearchParams();
  const href = search.size ? `${pathname}?${search.toString()}` : pathname;
  const prev = useRef<string | null>(null);
  // The last click, key press or Back/Forward not yet spent on a URL change:
  // one input makes at most one step, and whatever the app changes after it
  // on its own is a redirect.
  const input = useRef<number | null>(null);

  useEffect(() => {
    const mark = () => {
      input.current = Date.now();
    };
    const onHide = () => flushTelemetry(true);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
    };
    document.addEventListener('pointerdown', mark, true);
    document.addEventListener('keydown', mark, true);
    window.addEventListener('popstate', mark);
    document.addEventListener('visibilitychange', onVisibility);
    // A reload or a link out of the app: send what is queued before it goes.
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('pointerdown', mark, true);
      document.removeEventListener('keydown', mark, true);
      window.removeEventListener('popstate', mark);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  useEffect(() => {
    if (href === prev.current) return;
    const byPerson = input.current !== null && Date.now() - input.current <= INPUT_WINDOW_MS;
    const kind = classifyChange(prev.current, href, byPerson);
    if (byPerson) {
      const open = rowOpenFrom(prev.current, href);
      if (open) track('row_open', href, open.source);
    }
    if (kind) track(kind, href);
    if (kind === 'route' && prev.current) input.current = null;
    prev.current = href;
  }, [href]);

  return null;
}

/**
 * Staff Workflow · How we measure it — records the pages a person moves to,
 * the URLs the app changes on its own, and rows opened (no content). Renders
 * nothing.
 */
export function TelemetryTracker() {
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  );
}
