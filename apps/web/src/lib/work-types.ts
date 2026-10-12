import type { TaskAction, TaskPriority, TaskStatus, WorkType } from '@hsdg/contracts';

/**
 * Change 3 — a task as the engagement task list returns it (stream, reviewer,
 * the filing it produces). A superset of {@link MyTask} in ./types.
 */
export interface WorkTask {
  id: string;
  engagementId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  isOverdue: boolean;
  blockedByOpenCount: number;
  assignedToId: string | null;
  assignedToName: string | null;
  engagementServiceId: string | null;
  stream: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  workType: WorkType | null;
  complianceInstanceId: string | null;
  sentForReviewAt: string | null;
  reviewStartedAt: string | null;
  version: number;
  engagementCode?: string;
  entityName?: string;
}

/** A document row with its Change 6 filing links. */
export interface FilingDocumentRow {
  id: string;
  title: string;
  documentType: string;
  currentFilename: string | null;
  createdAt: string;
  createdByName: string | null;
  complianceInstanceId?: string | null;
  periodSection?: string | null;
  slotCode?: string | null;
  periodKey?: string | null;
  financialYear?: string | null;
  registrationId?: string | null;
  stream?: string | null;
}

export interface TaskActionContext {
  /** The caller's employee id. */
  me: string | null;
  /** The caller leads the engagement (partner / manager). */
  isLead: boolean;
}

/** Plain-language button label per transition. */
export const TASK_ACTION_LABEL: Record<TaskAction, string> = {
  start: 'Start work',
  pause: 'Pause',
  block: 'Waiting on client',
  'send-for-review': 'Send for review',
  'start-review': 'Start review',
  approve: 'Approve',
  return: 'Return with points',
  complete: 'Mark done',
  cancel: 'Cancel',
  reopen: 'Reopen',
};

/**
 * The transitions to offer for a task (spec Change 3 table). The server is the
 * judge; this only hides buttons that would certainly be refused.
 */
export function availableTaskActions(task: WorkTask, ctx: TaskActionContext): TaskAction[] {
  const isAssignee = !!ctx.me && task.assignedToId === ctx.me;
  const isReviewer = !!ctx.me && task.reviewerId === ctx.me;
  const canWork = isAssignee || ctx.isLead;
  const canReview = isReviewer || ctx.isLead;
  // Done without review only when there is no reviewer, unless a lead closes it.
  const canComplete = ctx.isLead || (isAssignee && !task.reviewerId);
  const out: TaskAction[] = [];
  switch (task.status) {
    case 'todo':
    case 'paused':
    case 'blocked':
    case 'in_progress':
      if (isAssignee && task.status !== 'in_progress') out.push('start');
      if (canWork && task.status === 'in_progress') out.push('pause');
      if (canWork && task.status !== 'blocked') out.push('block', 'send-for-review');
      if (canComplete) out.push('complete');
      if (canWork) out.push('cancel');
      break;
    case 'in_review':
      if (canReview && !task.reviewStartedAt && !(isAssignee && !ctx.isLead)) out.push('start-review');
      if (canReview) out.push('approve', 'return');
      if (canWork) out.push('cancel');
      break;
    case 'done':
    case 'cancelled':
      if (ctx.isLead) out.push('reopen');
      break;
    default:
      break;
  }
  return out;
}

/** Transitions that need a typed reason (review points / what the client owes). */
export const ACTIONS_NEEDING_REASON: TaskAction[] = ['return', 'block'];
