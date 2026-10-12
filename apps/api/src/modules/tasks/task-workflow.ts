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

export interface TransitionInput {
  action: TaskAction;
  status: TaskStatus;
  actor: TransitionActor;
  hasAssignee: boolean;
  hasReviewer: boolean;
  /** Open tasks this one depends on (a task cannot be done while any is open). */
  blockedByOpenCount: number;
  /** Non-empty reason text supplied with the request. */
  hasReason: boolean;
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

function requireAssigneeOrLead(actor: TransitionActor, what: string): void {
  if (!actor.isAssignee && !actor.isLead) {
    throw new TransitionError('forbidden', `Only the assignee or an engagement lead may ${what}.`);
  }
}

function requireReviewerOrLead(actor: TransitionActor, what: string): void {
  if (!actor.isReviewer && !actor.isLead) {
    throw new TransitionError('forbidden', `Only the reviewer or an engagement lead may ${what}.`);
  }
}

/** Plan a transition, or throw a TransitionError. Pure. */
export function planTransition(input: TransitionInput): TransitionPlan {
  const { action, status, actor } = input;
  switch (action) {
    case TASK_ACTION.start: {
      if (!actor.isAssignee) {
        throw new TransitionError(
          'forbidden',
          input.hasAssignee
            ? 'Only the assignee can start work on this task.'
            : 'Assign the task before starting work on it.',
        );
      }
      requireFrom(status, [S.todo, S.paused, S.blocked, S.inProgress], 'start work on');
      return { ...base(S.inProgress), open: TIME_ENTRY_KIND.work, completion: 'clear' };
    }
    case TASK_ACTION.pause: {
      requireAssigneeOrLead(actor, 'pause this task');
      requireFrom(status, [S.inProgress], 'pause');
      return {
        ...base(S.paused),
        close: { kinds: [TIME_ENTRY_KIND.work], reason: TIME_STOP_REASON.paused },
      };
    }
    case TASK_ACTION.block: {
      requireAssigneeOrLead(actor, 'mark this task as waiting on the client');
      requireFrom(status, [S.todo, S.inProgress, S.paused], 'mark as waiting on client');
      if (!input.hasReason) {
        throw new TransitionError('bad_request', 'Say what is needed from the client.');
      }
      return {
        ...base(S.blocked),
        close: { kinds: [TIME_ENTRY_KIND.work], reason: TIME_STOP_REASON.blocked },
        raiseDependency: true,
      };
    }
    case TASK_ACTION.sendForReview: {
      requireAssigneeOrLead(actor, 'send this task for review');
      requireFrom(status, [S.todo, S.inProgress, S.paused], 'send for review');
      return {
        ...base(S.inReview),
        close: { kinds: [TIME_ENTRY_KIND.work], reason: TIME_STOP_REASON.submittedForReview },
        notify: 'reviewer',
        defaultReviewer: !input.hasReviewer,
        review: 'sent',
      };
    }
    case TASK_ACTION.startReview: {
      requireReviewerOrLead(actor, 'start the review');
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
      requireReviewerOrLead(actor, 'approve this task');
      requireFrom(status, [S.inReview], 'approve');
      if (input.blockedByOpenCount > 0) {
        throw new TransitionError(
          'invalid_state',
          `Cannot complete: ${input.blockedByOpenCount} blocking task(s) are not done.`,
        );
      }
      return {
        ...base(S.done),
        close: { kinds: [TIME_ENTRY_KIND.review], reason: TIME_STOP_REASON.reviewApproved },
        review: 'cleared',
        completion: 'set',
      };
    }
    case TASK_ACTION.return: {
      requireReviewerOrLead(actor, 'return this task');
      requireFrom(status, [S.inReview], 'return');
      if (!input.hasReason) {
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
      requireAssigneeOrLead(actor, 'complete this task');
      requireFrom(status, WORKABLE, 'complete');
      if (input.hasReviewer && !actor.isLead) {
        throw new TransitionError(
          'forbidden',
          'This task has a reviewer — send it for review instead of marking it done.',
        );
      }
      if (input.blockedByOpenCount > 0) {
        throw new TransitionError(
          'invalid_state',
          `Cannot complete: ${input.blockedByOpenCount} blocking task(s) are not done.`,
        );
      }
      return {
        ...base(S.done),
        close: {
          kinds: [TIME_ENTRY_KIND.work, TIME_ENTRY_KIND.review],
          reason: TIME_STOP_REASON.taskDone,
        },
        review: 'cleared',
        completion: 'set',
      };
    }
    case TASK_ACTION.cancel: {
      requireAssigneeOrLead(actor, 'cancel this task');
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
      if (!actor.isLead) {
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
