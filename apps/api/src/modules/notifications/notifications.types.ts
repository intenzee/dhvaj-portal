import type { NotificationItem, NotificationType, WorkItemRef } from '@hsdg/contracts';

/** A notification as the recipient sees it (WF-305: with its kind and link). */
export type NotificationRecord = NotificationItem;

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
  /**
   * Where it opens. Omitted: resolved from the object (its filing, section, task
   * or request), else the engagement. Pass it when the emitter already has it.
   */
  link?: WorkItemRef | null;
}
