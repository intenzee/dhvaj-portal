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

/**
 * FEATURE_FLAG_OFFICES env → the offices each restricted flag is limited to
 * (`flag:CODE,CODE;flag:CODE`). Office codes are upper-cased; unknown flags and
 * entries with no office are ignored (that flag stays firm-wide).
 */
export function parseFlagOffices(
  raw: string | undefined,
): ReadonlyMap<FeatureFlag, ReadonlySet<string>> {
  const known = new Set<string>(FEATURE_FLAGS);
  const out = new Map<FeatureFlag, Set<string>>();
  for (const entry of (raw ?? '').split(';')) {
    const [name, offices] = entry.split(':');
    const flag = name?.trim().toLowerCase();
    if (!flag || !known.has(flag) || !offices) continue;
    const codes = offices
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    if (codes.length) out.set(flag as FeatureFlag, new Set(codes));
  }
  return out;
}
