'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { FEATURE_FLAG } from '@hsdg/contracts';
import { useFeatureFlags } from '@/lib/feature-flags';
import { NAV_ITEMS } from '@/lib/nav';
import { Spinner } from '@/components/ui';

/**
 * Where an old route lands now that it lives in My Work, keeping the link's
 * own query (e.g. /reviews?filter=signoff → /my-work?tab=to-review&filter=signoff);
 * the target's params win. Null when the route was not folded. Pure — tested.
 */
export function foldedTarget(from: string, search: string): string | null {
  const to = NAV_ITEMS.find((i) => i.href === from)?.foldedInto;
  if (!to) return null;
  const [path = to, query = ''] = to.split('?');
  const params = new URLSearchParams(search);
  new URLSearchParams(query).forEach((v, k) => params.set(k, v));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Staff Workflow WF-106: with ff_work_links an old list route (/tasks,
 * /client-dependencies, /reviews) redirects to its My Work tab; with the flag
 * off the old page renders as before. Waits for the flags so it never flashes
 * the old page before redirecting.
 */
export function FoldedRoute({
  from,
  children,
}: {
  from: string;
  children: ReactNode;
}): JSX.Element {
  const router = useRouter();
  const { isOn, isLoading } = useFeatureFlags();
  const redirect = isOn(FEATURE_FLAG.workLinks);

  useEffect(() => {
    if (!redirect) return;
    const target = foldedTarget(from, window.location.search);
    if (target) router.replace(target);
  }, [redirect, from, router]);

  if (isLoading || redirect) return <Spinner />;
  return <>{children}</>;
}
