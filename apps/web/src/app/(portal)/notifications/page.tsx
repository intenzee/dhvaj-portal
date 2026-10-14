'use client';

import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck } from 'lucide-react';
import { FEATURE_FLAG, type NotificationItem, type Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useToast } from '@/lib/toast';
import { useUrlState } from '@/lib/url-state';
import { cn } from '@/lib/cn';
import { PageHeader, Spinner, EmptyState, Button } from '@/components/ui';
import { NotificationList } from '@/components/notifications/notification-list';
import { NotificationDigestView } from '@/components/notifications/notification-digest';
import { NotificationSettings } from '@/components/notifications/notification-settings';
import {
  listPath,
  notificationHref,
  notificationTabs,
  tabFrom,
} from '@/components/notifications/notifications-model';

const EMPTY: Record<string, string> = {
  action: 'Nothing needs you right now.',
  unread: 'No unread notifications.',
  all: 'No notifications yet.',
};

/**
 * Notifications. With ff_filing_runs (WF-305) the page leads with what needs
 * action — the bell's list — then the daily digest of updates, everything, and
 * the per-type settings; each notification opens the exact filing section,
 * task or request it is about.
 */
function NotificationsScreen(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const url = useUrlState();
  const { isOn, isLoading: flagsLoading } = useFeatureFlags();
  const actionable = isOn(FEATURE_FLAG.filingRuns);
  const tabs = notificationTabs(actionable);
  const tab = tabFrom(url.get('tab'), actionable);
  const listed = tab !== 'digest' && tab !== 'settings';

  const notifications = useQuery({
    queryKey: ['notifications', 'list', tab],
    queryFn: () => apiFetch<Paginated<NotificationItem>>(listPath(tab)),
    enabled: listed && !flagsLoading,
  });

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: invalidate,
    onError: () => toast('Could not update the notification.', 'error'),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => apiFetch(`/notifications/${id}/dismiss`, { method: 'POST' }),
    onSuccess: invalidate,
    onError: () => toast('Could not dismiss the notification.', 'error'),
  });
  const markAll = useMutation({
    mutationFn: () => apiFetch<{ updated: number }>('/notifications/read-all', { method: 'POST' }),
    onSuccess: (r) => {
      toast(r.updated > 0 ? `Marked ${r.updated} read.` : 'Nothing unread.');
      invalidate();
    },
    onError: () => toast('Could not mark all read.', 'error'),
  });

  const open = (n: NotificationItem): void => {
    if (n.status === 'unread') markRead.mutate(n.id);
    const href = notificationHref(n);
    if (href) router.push(href);
  };

  const items = notifications.data?.items ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        subtitle={
          actionable
            ? 'What needs you, and a daily digest of everything else.'
            : 'Material events across your engagements.'
        }
        actions={
          listed ? (
            <Button
              variant="secondary"
              disabled={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              <CheckCheck className="h-4 w-4" /> Mark all read
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex gap-1 border-b border-line-strong" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => url.set({ tab: t.key === tabs[0]!.key ? null : t.key })}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition',
              tab === t.key
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'digest' ? (
        <NotificationDigestView
          onOpen={open}
          onRead={(id) => markRead.mutate(id)}
          onDismiss={(id) => dismiss.mutate(id)}
        />
      ) : tab === 'settings' ? (
        <NotificationSettings />
      ) : notifications.isLoading || flagsLoading ? (
        <Spinner label="Loading notifications…" />
      ) : items.length === 0 ? (
        <EmptyState>{EMPTY[tab]}</EmptyState>
      ) : (
        <NotificationList
          items={items}
          onOpen={open}
          onRead={(id) => markRead.mutate(id)}
          onDismiss={(id) => dismiss.mutate(id)}
        />
      )}
    </div>
  );
}

export default function NotificationsPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <NotificationsScreen />
    </Suspense>
  );
}
