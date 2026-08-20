import type { NotificationStatus, NotificationType } from '@hsdg/contracts';

/** A notification as the recipient sees it. */
export interface NotificationRecord {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  engagementId: string | null;
  objectType: string | null;
  objectId: string | null;
  status: NotificationStatus;
  readAt: string | null;
  createdAt: string;
}

/**
 * A single notification to emit. Recipients are engagement employees (the emit
 * function resolves each to its linked user; employees without a login are
 * skipped). `dedupKey` makes a date-driven emission idempotent.
 */
export interface NotificationEvent {
  type: NotificationType;
  recipientEmployeeIds: Array<string | null | undefined>;
  title: string;
  body?: string | null;
  engagementId?: string | null;
  objectType?: string | null;
  objectId?: string | null;
  dedupKey?: string | null;
}
