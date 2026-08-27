'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCheck, X, ArrowRight } from 'lucide-react';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { humanize, formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { NotificationRow } from '@/lib/types';
import { cn } from '@/lib/cn';
import { PageHeader, Card, Spinner, EmptyState, Button, Badge } from '@/components/ui';

type Tab = 'all' | 'unread';

/** §24 severity → badge tone. Overdue/critical read red, warnings amber. */
const TYPE_TONE: Record<string, 'danger' | 'warn' | 'info' | 'neutral'> = {
  statutory_deadline_overdue: 'danger',
  internal_sla_overdue: 'danger',
  deadline_layer_overdue: 'danger',
  client_commitment_overdue: 'danger',
  client_dependency_overdue: 'danger',
  high_risk_exception: 'danger',
  compliance_due_today: 'warn',
  statutory_deadline_approaching: 'warn',
  internal_sla_approaching: 'warn',
  review_pending: 'warn',
  ep_signoff_pending: 'warn',
  client_dependency_reminder: 'warn',
  task_assigned: 'info',
  ep_changed: 'info',
  engagement_reopened: 'info',
};
const toneForType = (type: string): 'danger' | 'warn' | 'info' | 'neutral' =>
  TYPE_TONE[type] ?? 'neutral';

export default function NotificationsPage(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('all');

  const notifications = useQuery({
    queryKey: ['notifications', 'list', tab],
    queryFn: () =>
      apiFetch<Paginated<NotificationRow>>(
        `/notifications?limit=100${tab === 'unread' ? '&unreadOnly=true' : ''}`,
      ),
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

  const open = (n: NotificationRow): void => {
    if (n.status === 'unread') markRead.mutate(n.id);
    if (n.engagementId) router.push(`/engagements/${n.engagementId}`);
  };

  const items = notifications.data?.items ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        subtitle="Material events across your engagements."
        actions={
          <Button variant="secondary" disabled={markAll.isPending} onClick={() => markAll.mutate()}>
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
        }
      />

      <div className="mb-4 flex gap-1 border-b border-line-strong">
        {(['all', 'unread'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium capitalize transition',
              tab === t
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {notifications.isLoading ? (
        <Spinner label="Loading notifications…" />
      ) : items.length === 0 ? (
        <EmptyState>{tab === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}</EmptyState>
      ) : (
        <Card className="divide-y divide-line">
          {items.map((n) => {
            const unread = n.status === 'unread';
            return (
              <div
                key={n.id}
                className={cn('flex items-start gap-3 px-4 py-3', unread && 'bg-primary-50/40')}
              >
                <span
                  className={cn(
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                    unread ? 'bg-primary-600' : 'bg-transparent',
                  )}
                  aria-hidden
                />
                <button
                  onClick={() => open(n)}
                  className="min-w-0 flex-1 text-left"
                  title={n.engagementId ? 'Open engagement' : undefined}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn('truncate text-sm', unread ? 'font-semibold text-ink' : 'text-ink-muted')}>
                      {n.title}
                    </span>
                    <Badge tone={toneForType(n.type)}>{humanize(n.type)}</Badge>
                    {n.engagementId && <ArrowRight className="h-3.5 w-3.5 text-ink-faint" />}
                  </div>
                  {n.body && <p className="mt-0.5 truncate text-sm text-ink-muted">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-ink-faint">{formatDate(n.createdAt)}</p>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {unread && (
                    <button
                      onClick={() => markRead.mutate(n.id)}
                      title="Mark read"
                      className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-sunken hover:text-ink"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => dismiss.mutate(n.id)}
                    title="Dismiss"
                    className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-sunken hover:text-ink"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
