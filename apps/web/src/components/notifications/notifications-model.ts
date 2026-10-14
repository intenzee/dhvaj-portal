import {
  NOTIFICATION_DELIVERY,
  workItemHref,
  type NotificationDelivery,
  type NotificationItem,
} from '@hsdg/contracts';

/**
 * Staff Workflow WF-305 — the notifications page's pure rules. Tested.
 */

export type NotificationTab = 'action' | 'digest' | 'all' | 'settings' | 'unread';

/** With actionable notifications on: what needs doing, the digest, everything, settings. */
export function notificationTabs(actionable: boolean): { key: NotificationTab; label: string }[] {
  return actionable
    ? [
        { key: 'action', label: 'Needs action' },
        { key: 'digest', label: 'Daily digest' },
        { key: 'all', label: 'All' },
        { key: 'settings', label: 'Settings' },
      ]
    : [
        { key: 'all', label: 'All' },
        { key: 'unread', label: 'Unread' },
      ];
}

/** A tab from the URL, or the first one this mode has. */
export function tabFrom(value: string | null, actionable: boolean): NotificationTab {
  const tabs = notificationTabs(actionable);
  return tabs.find((t) => t.key === value)?.key ?? tabs[0]!.key;
}

/** The list query for a tab (digest and settings have their own). */
export function listPath(tab: NotificationTab): string {
  if (tab === 'action') return '/notifications?limit=100&unreadOnly=true';
  if (tab === 'unread') return '/notifications?limit=100&unreadOnly=true';
  return '/notifications?limit=100&scope=all';
}

/** Where a notification opens: its stored work link, else its engagement. */
export function notificationHref(
  n: Pick<NotificationItem, 'link' | 'engagementId'>,
): string | null {
  if (n.link) return workItemHref(n.link);
  return n.engagementId ? `/engagements/${n.engagementId}` : null;
}

/** Today in IST (yyyy-mm-dd) — the digest's day. */
export function istDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** `day` moved by `delta` days. */
export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export const DELIVERY_LABEL: Record<NotificationDelivery, string> = {
  [NOTIFICATION_DELIVERY.bell]: 'Bell',
  [NOTIFICATION_DELIVERY.digest]: 'Daily digest',
  [NOTIFICATION_DELIVERY.off]: 'Off',
};

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
  task_review_requested: 'warn',
  task_returned: 'warn',
  time_adjustment_pending: 'warn',
  client_dependency_reminder: 'warn',
  task_assigned: 'info',
  ep_changed: 'info',
  engagement_reopened: 'info',
};
export const toneForType = (type: string): 'danger' | 'warn' | 'info' | 'neutral' =>
  TYPE_TONE[type] ?? 'neutral';
