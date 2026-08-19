/**
 * Tasks & client-dependency vocabulary (Phase 9) shared by the API and web.
 *
 * Two distinct delays are tracked separately (§11): a task past its due date is
 * an INTERNAL delay; an open client dependency means the engagement is WAITING
 * FOR CLIENT.
 */

export const TASK_STATUS = {
  todo: 'todo',
  inProgress: 'in_progress',
  blocked: 'blocked',
  done: 'done',
  cancelled: 'cancelled',
} as const;
export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];
export const TASK_STATUSES: TaskStatus[] = Object.values(TASK_STATUS);
/** Statuses where a task is still live (counts toward "open"/"overdue"). */
export const OPEN_TASK_STATUSES: TaskStatus[] = [
  TASK_STATUS.todo,
  TASK_STATUS.inProgress,
  TASK_STATUS.blocked,
];

export const TASK_PRIORITY = {
  low: 'low',
  normal: 'normal',
  high: 'high',
  urgent: 'urgent',
} as const;
export type TaskPriority = (typeof TASK_PRIORITY)[keyof typeof TASK_PRIORITY];
export const TASK_PRIORITIES: TaskPriority[] = Object.values(TASK_PRIORITY);

export const CLIENT_DEPENDENCY_STATUS = {
  pending: 'pending',
  partiallyReceived: 'partially_received',
  received: 'received',
  waived: 'waived',
  cancelled: 'cancelled',
} as const;
export type ClientDependencyStatus =
  (typeof CLIENT_DEPENDENCY_STATUS)[keyof typeof CLIENT_DEPENDENCY_STATUS];
export const CLIENT_DEPENDENCY_STATUSES: ClientDependencyStatus[] =
  Object.values(CLIENT_DEPENDENCY_STATUS);
/** Statuses where the firm is still waiting on the client (drives waiting-for-client). */
export const OPEN_CLIENT_DEPENDENCY_STATUSES: ClientDependencyStatus[] = [
  CLIENT_DEPENDENCY_STATUS.pending,
  CLIENT_DEPENDENCY_STATUS.partiallyReceived,
];
