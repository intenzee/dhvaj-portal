'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FEATURE_FLAG } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { useFeatureFlags } from '@/lib/feature-flags';
import { landingPath } from '@/lib/nav';

/** The query sign-in adds to `/` so Home can forward a preparer to Today once. */
export const LANDING_PARAM = 'landing';
export const AFTER_SIGN_IN = `/?${LANDING_PARAM}=1`;

/**
 * WF-201: right after sign-in (`/?landing=1`), send the person to their landing
 * page — Today for preparers with ff_today_view, Home for everyone else — and
 * drop the marker, so Home itself stays reachable from the sidebar.
 */
export function LandingRedirect(): null {
  const params = useSearchParams();
  const router = useRouter();
  const { principal } = useAuth();
  const { isOn, isLoading } = useFeatureFlags();
  const landing = params?.get(LANDING_PARAM) === '1';
  const todayView = isOn(FEATURE_FLAG.todayView);

  useEffect(() => {
    if (!landing || isLoading || !principal) return;
    router.replace(landingPath(principal, { todayView }));
  }, [landing, isLoading, principal, todayView, router]);
  return null;
}
