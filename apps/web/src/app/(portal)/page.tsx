'use client';

import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import type { DashboardSummary } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { stripCardsForRole } from '@/lib/dashboard-cards';
import { StatCard } from '@/components/stat-card';
import { Button, Spinner, EmptyState } from '@/components/ui';
import { MyEngagementsPanel } from '@/components/dashboard/my-engagements';
import { UpcomingDeadlinesPanel } from '@/components/dashboard/upcoming-deadlines';
import { MyTasksPanel } from '@/components/dashboard/my-tasks';
import { ReviewQueuePanel } from '@/components/dashboard/review-queue';
import { ClientDependenciesPanel } from '@/components/dashboard/client-dependencies';
import { ComplianceMiniCalendar } from '@/components/dashboard/compliance-mini-calendar';
import { ProfileCard } from '@/components/dashboard/profile-card';

/**
 * Home — the practice cockpit. A role-scoped stat strip over one RLS-scoped
 * summary, then working panels (engagements, deadlines, tasks, review queue,
 * client dependencies, compliance calendar, profile) each wired to live data.
 */
export default function HomePage(): JSX.Element {
  const { principal } = useAuth();
  const summary = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => apiFetch<DashboardSummary>('/dashboard/summary'),
  });

  const strip = stripCardsForRole(principal?.effectiveRole);
  const firstName = principal?.displayName.split(' ').slice(0, 2).join(' ') ?? '';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Welcome, {firstName}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Here&rsquo;s what&rsquo;s happening across your practice today.
          </p>
        </div>
        <Button variant="secondary" size="sm">
          <Sparkles className="h-4 w-4" /> Customise
        </Button>
      </div>

      {/* Stat strip */}
      {summary.isLoading && <Spinner label="Loading your dashboard…" />}
      {summary.isError && (
        <EmptyState>Could not load the dashboard. Check that the API is reachable.</EmptyState>
      )}
      {summary.data && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {strip.map((card) => (
            <StatCard key={card.key} card={card} value={summary.data[card.value] as number} />
          ))}
        </div>
      )}

      {/* Row A: engagements · deadlines · tasks */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-6">
          <MyEngagementsPanel />
        </div>
        <div className="xl:col-span-3">
          <UpcomingDeadlinesPanel />
        </div>
        <div className="xl:col-span-3">
          <MyTasksPanel />
        </div>
      </div>

      {/* Row B: review queue · client deps · calendar · profile */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        <ReviewQueuePanel />
        <ClientDependenciesPanel />
        <ComplianceMiniCalendar />
        <ProfileCard />
      </div>
    </div>
  );
}
