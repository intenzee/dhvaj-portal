/**
 * Change 3 — the task state machine and the clock it drives. DI-free and pure so
 * every row of the spec's table is unit-tested without a database; the service
 * (task-workflow.service.ts) applies the returned plan in one transaction.
 *
 *   Event                          Task after     Clock
 *   Start work                     in_progress    opens a work entry for the assignee
 *   (starting a different task)    old → paused   closes the old entry (task_switched)
 *   Pause                          paused         closes (paused)
 *   Waiting on client              blocked        closes (blocked) + raises a client dependency
 *   Send for review                in_review      closes (submitted_for_review); reviewer notified
 *   Start review                   in_review      opens a review entry for the reviewer
 *   Approve                        done           closes the reviewer entry (review_approved)
 *   Return with points             todo           closes the reviewer entry (review_returned)
 *   Done without review / cancel   done/cancelled closes (task_done / task_cancelled)
 *   No heartbeat 15 min            paused         closes at the last heartbeat (idle)
 *   Day-end / sign-out             paused         closes (day_end / signed_out)
 */
import {
  TASK_ACTION,
  TASK_STATUS,
  TIME_ENTRY_KIND,
  TIME_STOP_REASON,
  type TaskAction,
  type TaskStatus,
  type TimeEntryKind,
  type TimeStopReason,
} from '@hsdg/contracts';

export interface TransitionActor {
  isAssignee: boolean;
  isReviewer: boolean;
  isLead: boolean;
}

/**
 * The firm's task checks (Admin → Workflow → Checks). Each true keeps the old
 * rule; false lets the work through, with a warning where something is off.
 */
export interface TaskChecks {
  /** review_required — a reviewer is defaulted on Send for review, and a task
   *  with a reviewer goes through review before Done. */
  review: boolean;
  /** task_assignee_only — only the assignee (or a lead) moves the task. */
  assigneeOnly: boolean;
  /** task_reasons_required — review points / the client's need are written down. */
  reasons: boolean;
  /** task_reopen_lead_only — only a lead reopens a finished task. */
  reopenLeadOnly: boolean;
  /** task_blockers — a task waiting on another cannot be completed. */
  blockers: boolean;
}

/** Every check on: the rules as they were before the checks could be switched off. */
export const STRICT_TASK_CHECKS: TaskChecks = {
  review: true,
  assigneeOnly: true,
  reasons: true,
  reopenLeadOnly: true,
  blockers: true,
};

export interface TransitionInput {
  action: TaskAction;
  status: TaskStatus;
  actor: TransitionActor;
  hasAssignee: boolean;
  hasReviewer: boolean;
  /** A reviewer was named with the request (Send for review). */
  reviewerGiven?: boolean;
  /** Open tasks this one depends on (a task cannot be done while any is open). */
  blockedByOpenCount: number;
  /** Non-empty reason text supplied with the request. */
  hasReason: boolean;
  /** Defaults to every check on. */
  checks?: TaskChecks;
}

export interface TransitionPlan {
  toStatus: TaskStatus;
  /** Close running entries on THIS task of these kinds, with this reason. */
  close: { kinds: TimeEntryKind[]; reason: TimeStopReason } | null;
  /** Open an entry for the caller (after closing whatever else they had running). */
  open: TimeEntryKind | null;
  /** Who to notify, if anyone. */
  notify: 'reviewer' | 'assignee' | null;
  /** Send for review with no reviewer set → default it (manager, else partner). */
  defaultReviewer: boolean;
  /** Start review by a lead who is not the reviewer → the lead becomes reviewer. */
  takeReview: boolean;
  /** Stamp sent_for_review_at / review_started_at / clear them. */
  review: 'sent' | 'started' | 'cleared' | null;
  /** Set completion stamps (done) or clear them (leaving done). */
  completion: 'set' | 'clear' | null;
  /** Raise a client dependency (Waiting on client). */
  raiseDependency: boolean;
  /** Starting an unassigned task makes the caller its assignee. */
  claim: boolean;
  /** Went ahead, but something is off (the check for it is switched off). */
  warnings: string[];
}

export type TransitionErrorCode = 'forbidden' | 'invalid_state' | 'bad_request';

export class TransitionError extends Error {
  constructor(
    readonly code: TransitionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const S = TASK_STATUS;
const WORKABLE: TaskStatus[] = [S.todo, S.inProgress, S.paused, S.blocked];

function base(toStatus: TaskStatus): TransitionPlan {
  return {
    toStatus,
    close: null,
    open: null,
    notify: null,
    defaultReviewer: false,
    takeReview: false,
    review: null,
    completion: null,
    raiseDependency: false,
    claim: false,
    warnings: [],
  };
}

function requireFrom(status: TaskStatus, allowed: TaskStatus[], what: string): void {
  if (!allowed.includes(status)) {
    throw new TransitionError(
      'invalid_state',
      `Cannot ${what} a task that is ${status.replace('_', ' ')}.`,
    );
  }
}

/** Seeing the task makes the caller a member (RLS), so with the check off anyone may. */
function requireAssigneeOrLead(actor: TransitionActor, checks: TaskChecks, what: string): void {
  if (checks.assigneeOnly && !actor.isAssignee && !actor.isLead) {
    throw new TransitionError('forbidden', `Only the assignee or an engagement lead may ${what}.`);
  }
}

function requireReviewerOrLead(actor: TransitionActor, checks: TaskChecks, what: string): void {
  if (checks.assigneeOnly && !actor.isReviewer && !actor.isLead) {
    throw new TransitionError('forbidden', `Only the reviewer or an engagement lead may ${what}.`);
  }
}

/** Open blockers refuse completion, or warn while the check is off. */
function blockerWarnings(input: TransitionInput, checks: TaskChecks): string[] {
  if (input.blockedByOpenCount === 0) return [];
  const message = `${input.blockedByOpenCount} blocking task(s) are not done.`;
  if (checks.blockers) {
    throw new TransitionError('invalid_state', `Cannot complete: ${message}`);
  }
  return [`Completed while ${message}`];
}

/** Plan a transition, or throw a TransitionError. Pure. */
export function planTransition(input: TransitionInput): TransitionPlan {
  const { action, status, actor } = input;
  const checks = input.checks ?? STRICT_TASK_CHECKS;
  switch (action) {
    case TASK_ACTION.start: {
      if (checks.assigneeOnly && !actor.isAssignee) {
        throw new TransitionError(
          'forbidden',
          input.hasAssignee
            ? 'Only the assignee can start work on this task.'
            : 'Assign the task before starting work on it.',
        );
      }
      requireFrom(status, [S.todo, S.paused, S.blocked, S.inProgress], 'start work on');
      return {
        ...base(S.inProgress),
        open: TIME_ENTRY_KIND.work,
        completion: 'clear',
        claim: !input.hasAssignee,
      };
    }
    case TASK_ACTION.pause: {
      requireAssigneeOrLead(actor, checks, 'pause this task');
      requireFrom(status, [S.inProgress], 'pause');
      return {
        ...base(S.paused),
        close: { kinds: [TIME_ENTRY_KIND.work], reason: TIME_STOP_REASON.paused },
      };
    }
    case TASK_ACTION.block: {
      requireAssigneeOrLead(actor, checks, 'mark this task as waiting on the client');
      requireFrom(status, [S.todo, S.inProgress, S.paused], 'mark as waiting on client');
      if (checks.reasons && !input.hasReason) {
        throw new TransitionError('bad_request', 'Say what is needed from the client.');
      }
      return {
        ...base(S.blocked),
        close: { kinds: [TIME_ENTRY_KIND.work], reason: TIME_STOP_REASON.blocked },
        raiseDependency: true,
      };
    }
    case TASK_ACTION.sendForReview: {
      requireAssigneeOrLead(actor, checks, 'send this task for review');
      requireFrom(status, [S.todo, S.inProgress, S.paused], 'send for review');
      // With review optional nobody is picked for you: asking for a review
      // means naming who should do it.
      if (!checks.review && !input.hasReviewer && !input.reviewerGiven) {
        throw new TransitionError('bad_request', 'Pick who should review this task.');
      }
      return {
        ...base(S.inReview),
        close: { kinds: [TIME_ENTRY_KIND.work], reason: TIME_STOP_REASON.submittedForReview },
        notify: 'reviewer',
        defaultReviewer: checks.review && !input.hasReviewer,
        review: 'sent',
      };
    }
    case TASK_ACTION.startReview: {
      requireReviewerOrLead(actor, checks, 'start the review');
      requireFrom(status, [S.inReview], 'start reviewing');
      if (actor.isAssignee && !actor.isLead) {
        throw new TransitionError('forbidden', 'You cannot review your own work.');
      }
      return {
        ...base(S.inReview),
        open: TIME_ENTRY_KIND.review,
        takeReview: !actor.isReviewer,
        review: 'started',
      };
    }
    case TASK_ACTION.approve: {
      requireReviewerOrLead(actor, checks, 'approve this task');
      requireFrom(status, [S.inReview], 'approve');
      if (!checks.assigneeOnly && actor.isAssignee && !actor.isReviewer && !actor.isLead) {
        throw new TransitionError('forbidden', 'You cannot approve your own work.');
      }
      const warnings = blockerWarnings(input, checks);
      return {
        ...base(S.done),
        close: { kinds: [TIME_ENTRY_KIND.review], reason: TIME_STOP_REASON.reviewApproved },
        review: 'cleared',
        completion: 'set',
        warnings,
      };
    }
    case TASK_ACTION.return: {
      requireReviewerOrLead(actor, checks, 'return this task');
      requireFrom(status, [S.inReview], 'return');
      if (checks.reasons && !input.hasReason) {
        throw new TransitionError('bad_request', 'Give the review points when returning a task.');
      }
      return {
        ...base(S.todo),
        close: { kinds: [TIME_ENTRY_KIND.review], reason: TIME_STOP_REASON.reviewReturned },
        notify: 'assignee',
        review: 'cleared',
      };
    }
    case TASK_ACTION.complete: {
      requireAssigneeOrLead(actor, checks, 'complete this task');
      requireFrom(status, WORKABLE, 'complete');
      if (checks.review && input.hasReviewer && !actor.isLead) {
        throw new TransitionError(
          'forbidden',
          'This task has a reviewer — send it for review instead of marking it done.',
        );
      }
      const warnings = blockerWarnings(input, checks);
      return {
        ...base(S.done),
        close: {
          kinds: [TIME_ENTRY_KIND.work, TIME_ENTRY_KIND.review],
          reason: TIME_STOP_REASON.taskDone,
        },
        review: 'cleared',
        completion: 'set',
        warnings,
      };
    }
    case TASK_ACTION.cancel: {
      requireAssigneeOrLead(actor, checks, 'cancel this task');
      requireFrom(status, [...WORKABLE, S.inReview], 'cancel');
      return {
        ...base(S.cancelled),
        close: {
          kinds: [TIME_ENTRY_KIND.work, TIME_ENTRY_KIND.review],
          reason: TIME_STOP_REASON.taskCancelled,
        },
        review: 'cleared',
        completion: 'clear',
      };
    }
    case TASK_ACTION.reopen: {
      if (checks.reopenLeadOnly && !actor.isLead) {
        throw new TransitionError('forbidden', 'Only an engagement lead may reopen a task.');
      }
      requireFrom(status, [S.done, S.cancelled], 'reopen');
      return { ...base(S.todo), review: 'cleared', completion: 'clear' };
    }
    default:
      throw new TransitionError('bad_request', `Unknown task action.`);
  }
}

/**
 * The legacy PATCH …/tasks/:id/status (and the status dropdown) expressed as a
 * transition, so every path drives the clock the same way.
 */
export function actionForStatus(from: TaskStatus, to: TaskStatus): TaskAction | null {
  switch (to) {
    case S.inProgress:
      return TASK_ACTION.start;
    case S.paused:
      return TASK_ACTION.pause;
    case S.inReview:
      return TASK_ACTION.sendForReview;
    case S.done:
      return from === S.inReview ? TASK_ACTION.approve : TASK_ACTION.complete;
    case S.cancelled:
      return TASK_ACTION.cancel;
    case S.todo:
      if (from === S.inReview) return TASK_ACTION.return;
      if (from === S.done || from === S.cancelled) return TASK_ACTION.reopen;
      return null;
    default:
      // blocked via the dropdown carries no client request — a plain status change.
      return null;
  }
}

/** System closures (idle / day-end / sign-out) pause the task the clock ran for. */
export function statusAfterSystemClose(status: TaskStatus, kind: TimeEntryKind): TaskStatus | null {
  if (kind === TIME_ENTRY_KIND.work && status === S.inProgress) return S.paused;
  return null;
}
