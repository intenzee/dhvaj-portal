'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { NotificationDigest as Digest, NotificationItem } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Button, EmptyState, Spinner } from '@/components/ui';
import { NotificationList } from './notification-list';
import { istDay, shiftDay } from './notifications-model';

export const digestKey = (day: string) => ['notifications', 'digest', day] as const;

/**
 * WF-305 — the daily digest: a day's informational notices (lodged filings,
 * dates coming up, reminders sent), grouped by type. They never reach the bell;
 * the morning e-mail carries yesterday's.
 */
export function NotificationDigestView({
  onOpen,
  onRead,
  onDismiss,
}: {
  onOpen: (n: NotificationItem) => void;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}): JSX.Element {
  const today = istDay();
  const [day, setDay] = useState(today);
  const digest = useQuery({
    queryKey: digestKey(day),
    queryFn: () => apiFetch<Digest>(`/notifications/digest?date=${day}`),
  });

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Button
          variant="secondary"
          aria-label="Previous day"
          onClick={() => setDay((d) => shiftDay(d, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[8rem] text-center text-sm font-medium text-ink">
          {day === today ? 'Today' : formatDate(day)}
        </span>
        <Button
          variant="secondary"
          aria-label="Next day"
          disabled={day >= today}
          onClick={() => setDay((d) => shiftDay(d, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      {digest.isLoading ? (
        <Spinner label="Loading the digest…" />
      ) : !digest.data || digest.data.total === 0 ? (
        <EmptyState>Nothing for the digest {day === today ? 'today' : 'that day'}.</EmptyState>
      ) : (
        <div className="space-y-4">
          {digest.data.groups.map((g) => (
            <section key={g.type} aria-label={g.label}>
              <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">
                {g.label} · {g.items.length}
              </h2>
              <NotificationList
                items={g.items}
                onOpen={onOpen}
                onRead={onRead}
                onDismiss={onDismiss}
              />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
