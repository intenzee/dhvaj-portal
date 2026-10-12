import { useQuery } from '@tanstack/react-query';
import { FEATURE_FLAGS, type FeatureFlag, type FeatureFlagsResponse } from '@hsdg/contracts';
import { apiFetch } from './api';

/** Every flag off — what the UI assumes until /meta/features answers. */
const ALL_OFF = Object.fromEntries(FEATURE_FLAGS.map((f) => [f, false])) as Record<
  FeatureFlag,
  boolean
>;

export const featureFlagsQuery = {
  queryKey: ['meta', 'features'] as const,
  queryFn: () => apiFetch<FeatureFlagsResponse>('/meta/features'),
  // Flags change with a deploy, not during a session.
  staleTime: 10 * 60 * 1000,
};

/**
 * Engagement Restructure phase flags (spec "Rollout"). Fails closed: while
 * loading, or if the request fails, every flag reads as off so the old screens
 * keep working.
 */
export function useFeatureFlags(): {
  flags: Record<FeatureFlag, boolean>;
  isOn: (flag: FeatureFlag) => boolean;
  isLoading: boolean;
} {
  const query = useQuery(featureFlagsQuery);
  const flags = query.data?.flags ?? ALL_OFF;
  return { flags, isOn: (flag) => flags[flag] === true, isLoading: query.isLoading };
}
