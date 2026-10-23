import {
  FIRM_CHECK,
  type FirmCheckKey,
  type FirmChecks,
  type TaskAction,
  type TaskPriority,
  type TaskStatus,
  type WorkType,
} from '@hsdg/contracts';

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
  /** The firm's checks (useFirmChecks). Left out, every check is on. */
  checks?: FirmChecks;
}

/** A check is on (the old rule holds); with no checks given, all are on. */
function strict(ctx: TaskActionContext, key: FirmCheckKey): boolean {
  return ctx.checks ? ctx.checks[key] === true : true;
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

/** The label in context: picking a paused or blocked task back up reads "Resume work". */
export function taskActionLabel(action: TaskAction, status: string): string {
  if (action === 'start' && (status === 'blocked' || status === 'paused')) return 'Resume work';
  return TASK_ACTION_LABEL[action];
}

/**
 * The transitions to offer for a task (spec Change 3 table). The server is the
 * judge; this only hides buttons that would certainly be refused.
 */
export function availableTaskActions(task: WorkTask, ctx: TaskActionContext): TaskAction[] {
  const isAssignee = !!ctx.me && task.assignedToId === ctx.me;
  const isReviewer = !!ctx.me && task.reviewerId === ctx.me;
  // With task_assignee_only off, anyone who can see the task is on the team and may move it.
  const assigneeOnly = strict(ctx, FIRM_CHECK.taskAssigneeOnly);
  const review = strict(ctx, FIRM_CHECK.reviewRequired);
  const canStart = assigneeOnly ? isAssignee : !!ctx.me;
  const canWork = !assigneeOnly || isAssignee || ctx.isLead;
  const canReview = !assigneeOnly || isReviewer || ctx.isLead;
  // Done without review only when there is no reviewer, unless a lead closes it
  // (or review is optional).
  const canComplete = canWork && (ctx.isLead || !review || !task.reviewerId);
  const ownWork = isAssignee && !isReviewer && !ctx.isLead;
  const out: TaskAction[] = [];
  switch (task.status) {
    case 'todo':
    case 'paused':
    case 'blocked':
    case 'in_progress':
      if (canStart && task.status !== 'in_progress') out.push('start');
      if (canWork && task.status === 'in_progress') out.push('pause');
      if (canWork && task.status !== 'blocked') out.push('block', 'send-for-review');
      if (canComplete) out.push('complete');
      if (canWork) out.push('cancel');
      break;
    case 'in_review':
      if (canReview && !task.reviewStartedAt && !(isAssignee && !ctx.isLead))
        out.push('start-review');
      if (canReview && !(ownWork && !assigneeOnly)) out.push('approve');
      if (canReview) out.push('return');
      if (canWork) out.push('cancel');
      break;
    case 'done':
    case 'cancelled':
      if (ctx.isLead || (!strict(ctx, FIRM_CHECK.taskReopenLeadOnly) && !!ctx.me)) out.push('reopen');
      break;
    default:
      break;
  }
  return out;
}

/** Transitions that need a typed reason (review points / what the client owes). */
export const ACTIONS_NEEDING_REASON: TaskAction[] = ['return', 'block'];

/** Whether the reason for this transition must be filled in (task_reasons_required). */
export function reasonRequired(action: TaskAction, ctx: TaskActionContext): boolean {
  return ACTIONS_NEEDING_REASON.includes(action) && strict(ctx, FIRM_CHECK.taskReasonsRequired);
}

/**
 * Send for review asks who should review when review is optional and the task
 * has no reviewer yet — nobody is picked for you.
 */
export function needsReviewerPick(task: WorkTask, ctx: TaskActionContext): boolean {
  return !strict(ctx, FIRM_CHECK.reviewRequired) && !task.reviewerId;
}
