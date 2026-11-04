/**
 * Quick tasks: an urgent job handed to one person from "New → New task" —
 * the client, what to do, who does it. It reaches them at once, and they
 * answer like a chat: Received, Doing (done in 1 h / 2 h / …), Done.
 */

export const QUICK_TASK_STATUSES = ['sent', 'received', 'doing', 'done', 'cancelled'] as const;
export type QuickTaskStatus = (typeof QUICK_TASK_STATUSES)[number];

export const QUICK_TASK_STATUS_LABEL: Record<QuickTaskStatus, string> = {
  sent: 'Sent',
  received: 'Received',
  doing: 'Doing',
  done: 'Done',
  cancelled: 'Cancelled',
};

/** Still to finish. */
export const QUICK_TASK_OPEN: readonly QuickTaskStatus[] = ['sent', 'received', 'doing'];

/** The quick answers the assignee taps, with how long it will take (minutes). */
export const QUICK_TASK_ETA_CHOICES: { label: string; minutes: number }[] = [
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 hr', minutes: 60 },
  { label: '2 hr', minutes: 120 },
  { label: '4 hr', minutes: 240 },
  { label: 'Today', minutes: -1 },
  { label: 'Tomorrow', minutes: -2 },
];

/** Who may set a status: the assignee works it; the assigner cancels or reopens it. */
export const QUICK_TASK_ASSIGNEE_STATUSES: readonly QuickTaskStatus[] = [
  'received',
  'doing',
  'done',
];
export const QUICK_TASK_ASSIGNER_STATUSES: readonly QuickTaskStatus[] = [
  'cancelled',
  'sent',
  'done',
];

export interface QuickTaskPerson {
  id: string;
  name: string;
  code: string | null;
  officeCode: string | null;
  role: string | null;
}

export interface QuickTaskMessage {
  id: string;
  authorId: string | null;
  authorName: string | null;
  mine: boolean;
  body: string | null;
  status: QuickTaskStatus | null;
  etaAt: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface QuickTaskSummary {
  id: string;
  number: number;
  title: string;
  urgent: boolean;
  status: QuickTaskStatus;
  entityId: string | null;
  entityLabel: string | null;
  assignedBy: QuickTaskPerson;
  assignedTo: QuickTaskPerson;
  /** The caller's side: they gave it, or it was given to them. */
  side: 'sent' | 'received' | 'other';
  etaAt: string | null;
  dueAt: string | null;
  /** The ETA (or due time) passed and it is not done. */
  late: boolean;
  lastActivityAt: string;
  lastMessage: string | null;
  unread: number;
  createdAt: string;
}

export interface QuickTaskDetail extends QuickTaskSummary {
  details: string | null;
  receivedAt: string | null;
  startedAt: string | null;
  doneAt: string | null;
  cancelledAt: string | null;
  messages: QuickTaskMessage[];
  /** The statuses the caller may set now. */
  canSet: QuickTaskStatus[];
  canWrite: boolean;
  version: number;
}

/** POST /quick-tasks */
export interface CreateQuickTaskInput {
  entityId?: string | null;
  title: string;
  details?: string | null;
  assignedToEmployeeId: string;
  urgent?: boolean;
  dueAt?: string | null;
}

/** POST /quick-tasks/:id/reply — a status, an ETA, a message, or any of them. */
export interface QuickTaskReplyInput {
  status?: QuickTaskStatus;
  /** Minutes from now; -1 end of today (7 pm IST), -2 tomorrow 1 pm IST. */
  etaMinutes?: number;
  body?: string;
}

/** GET /quick-tasks/inbox — the top bar's count and the pop-up. */
export interface QuickTaskInbox {
  unread: number;
  open: number;
  /** Given to the caller and not yet acknowledged (status sent): the pop-up. */
  waiting: QuickTaskSummary[];
}

/** The time an ETA choice means, from `now`. Pure — tested. */
export function quickTaskEta(minutes: number, now: Date = new Date()): Date {
  if (minutes >= 0) return new Date(now.getTime() + minutes * 60_000);
  // IST is UTC+5:30; "today" is 7 pm IST, "tomorrow" 1 pm IST.
  const ist = new Date(now.getTime() + 330 * 60_000);
  const day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const at = (dayOffset: number, hour: number) =>
    new Date(day + dayOffset * 86_400_000 + hour * 3_600_000 - 330 * 60_000);
  if (minutes === -1) {
    const evening = at(0, 19);
    return evening.getTime() > now.getTime() ? evening : at(1, 10);
  }
  return at(1, 13);
}
