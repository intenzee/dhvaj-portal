'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { FEATURE_FLAG } from '@hsdg/contracts';
import { useFeatureFlags } from '@/lib/feature-flags';
import { foldedHref, foldedTarget } from '@/lib/nav';
import { Spinner } from '@/components/ui';

export { foldedTarget };

/** Resolves links to old list routes to their My Work tab while ff_work_links is on. */
export function useFoldedHref(): (href: string) => string {
  const { isOn } = useFeatureFlags();
  const workLinks = isOn(FEATURE_FLAG.workLinks);
  return (href) => foldedHref(href, workLinks);
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
