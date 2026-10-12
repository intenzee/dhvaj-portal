import { FEATURE_FLAGS, type FeatureFlag } from '@hsdg/contracts';

/** FEATURE_FLAGS env → enabled set. Unknown names are ignored. */
export function parseFeatureFlags(
  raw: string | undefined,
  isProduction: boolean,
): ReadonlySet<FeatureFlag> {
  const value = (raw ?? (isProduction ? 'none' : 'all')).trim().toLowerCase();
  if (value === 'all') return new Set(FEATURE_FLAGS);
  if (value === 'none' || value === '') return new Set();
  const known = new Set<string>(FEATURE_FLAGS);
  return new Set(
    value
      .split(',')
      .map((f) => f.trim())
      .filter((f): f is FeatureFlag => known.has(f)),
  );
}
