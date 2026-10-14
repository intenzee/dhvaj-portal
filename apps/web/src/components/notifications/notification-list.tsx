'use client';

import { Check, X, ArrowRight } from 'lucide-react';
import {
  NOTIFICATION_TYPE_LABEL,
  type NotificationItem,
  type NotificationType,
} from '@hsdg/contracts';
import { humanize, formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge, Card } from '@/components/ui';
import { notificationHref, toneForType } from './notifications-model';

/** One list of notifications: open (to its exact place), mark read, dismiss. */
export function NotificationList({
  items,
  onOpen,
  onRead,
  onDismiss,
}: {
  items: NotificationItem[];
  onOpen: (n: NotificationItem) => void;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}): JSX.Element {
  return (
    <Card className="divide-y divide-line">
      {items.map((n) => {
        const unread = n.status === 'unread';
        const href = notificationHref(n);
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
              onClick={() => onOpen(n)}
              className="min-w-0 flex-1 text-left"
              title={href ? 'Open' : undefined}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'truncate text-sm',
                    unread ? 'font-semibold text-ink' : 'text-ink-muted',
                  )}
                >
                  {n.title}
                </span>
                <Badge tone={toneForType(n.type)}>
                  {NOTIFICATION_TYPE_LABEL[n.type as NotificationType] ?? humanize(n.type)}
                </Badge>
                {n.resolvedAt && <Badge tone="success">Done</Badge>}
                {href && <ArrowRight className="h-3.5 w-3.5 text-ink-faint" />}
              </div>
              {n.body && <p className="mt-0.5 truncate text-sm text-ink-muted">{n.body}</p>}
              <p className="mt-0.5 text-xs text-ink-faint">{formatDate(n.createdAt)}</p>
            </button>
            <div className="flex shrink-0 items-center gap-1">
              {unread && (
                <button
                  onClick={() => onRead(n.id)}
                  title="Mark read"
                  aria-label={`Mark read: ${n.title}`}
                  className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-sunken hover:text-ink"
                >
                  <Check className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => onDismiss(n.id)}
                title="Dismiss"
                aria-label={`Dismiss: ${n.title}`}
                className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-sunken hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
