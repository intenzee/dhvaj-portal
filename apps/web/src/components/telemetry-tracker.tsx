'use client';

import { Suspense, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { flushTelemetry, isNewRoute, rowOpenFrom, track } from '@/lib/telemetry';

function Tracker() {
  const pathname = usePathname();
  const search = useSearchParams();
  const href = search.size ? `${pathname}?${search.toString()}` : pathname;
  const prev = useRef<string | null>(null);

  useEffect(() => {
    if (href === prev.current) return;
    const open = rowOpenFrom(prev.current, href);
    if (open) track('row_open', href, open.source);
    if (isNewRoute(prev.current, href)) track('route', href);
    prev.current = href;
  }, [href]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushTelemetry(true);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  return null;
}

/**
 * Staff Workflow · How we measure it — records route changes and rows opened
 * (no content). Renders nothing.
 */
export function TelemetryTracker() {
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  );
}
