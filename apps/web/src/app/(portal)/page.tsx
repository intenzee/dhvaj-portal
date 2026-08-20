'use client';

import { useQuery } from '@tanstack/react-query';
import type { DashboardSummary } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { cardsForRole } from '@/lib/dashboard-cards';
import { roleLabel } from '@/lib/principal';
import { StatCard } from '@/components/stat-card';
import { PageHeader, Spinner, EmptyState } from '@/components/ui';

/**
 * Home — the role dashboard. One endpoint returns RLS-scoped counts; the role
 * decides which cards to surface. The Managing Partner sees the firm-wide
 * accountability view; a senior/article sees their personal work.
 */
export default function HomePage(): JSX.Element {
  const { principal } = useAuth();
  const summary = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => apiFetch<DashboardSummary>('/dashboard/summary'),
  });

  const cards = cardsForRole(principal?.effectiveRole);

  return (
    <div>
      <PageHeader
        title={`Welcome, ${principal?.displayName ?? ''}`}
        subtitle={`${roleLabel(principal?.effectiveRole)} · your dashboard reflects what you can access`}
      />

      {summary.isLoading && <Spinner label="Loading your dashboard…" />}
      {summary.isError && (
        <EmptyState>Could not load the dashboard. Check that the API is reachable.</EmptyState>
      )}

      {summary.data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((card) => (
            <StatCard key={card.key} card={card} value={summary.data[card.value] as number} />
          ))}
        </div>
      )}

      {summary.data && (
        <p className="mt-4 text-xs text-ink-faint">
          &ldquo;Due soon&rdquo; uses a {summary.data.dueSoonWindowDays}-day window ·{' '}
          {summary.data.unreadNotifications} unread notification
          {summary.data.unreadNotifications === 1 ? '' : 's'}.
        </p>
      )}
    </div>
  );
}
