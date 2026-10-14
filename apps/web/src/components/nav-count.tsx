'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { NavItem } from '@/lib/nav';

/**
 * The sidebar's count pill for a nav item (WF-105: reviews waiting on My Work).
 * Hidden at zero; polls like the notification bell, and refreshes whenever the
 * work behind it is invalidated (its key sits under ['work', …]).
 */
export function NavCount({ badge }: { badge: NonNullable<NavItem['badge']> }): JSX.Element | null {
  const { data } = useQuery({
    queryKey: badge.queryKey,
    queryFn: () => apiFetch<{ total: number }>(badge.path),
    refetchInterval: 60_000,
  });
  const total = data?.total ?? 0;
  if (total === 0) return null;
  return (
    <span
      className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-semibold text-white"
      aria-label={`${total} waiting`}
    >
      {total > 99 ? '99+' : total}
    </span>
  );
}
