import { TASK_ACTION, TASK_STATUS, TIME_STOP_REASON, type TaskStatus } from '@hsdg/contracts';
import {
  actionForStatus,
  planTransition,
  statusAfterSystemClose,
  TransitionError,
  type TransitionInput,
} from './task-workflow';

const assignee = { isAssignee: true, isReviewer: false, isLead: false };
const reviewer = { isAssignee: false, isReviewer: true, isLead: false };
const lead = { isAssignee: false, isReviewer: false, isLead: true };
const stranger = { isAssignee: false, isReviewer: false, isLead: false };

function input(over: Partial<TransitionInput>): TransitionInput {
  return {
    action: TASK_ACTION.start,
    status: TASK_STATUS.todo,
    actor: assignee,
    hasAssignee: true,
    hasReviewer: true,
    blockedByOpenCount: 0,
    hasReason: false,
    ...over,
  };
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof TransitionError ? e.code : 'other';
  }
  return undefined;
}

describe('task workflow — Change 3 state table', () => {
  it('Start work → in_progress, opens a work entry for the assignee', () => {
    const p = planTransition(input({ action: TASK_ACTION.start }));
    expect(p.toStatus).toBe(TASK_STATUS.inProgress);
    expect(p.open).toBe('work');
    expect(p.close).toBeNull();
  });

  it('Start work resumes a paused or blocked task', () => {
    for (const status of [TASK_STATUS.paused, TASK_STATUS.blocked] as TaskStatus[]) {
      expect(planTransition(input({ status })).toStatus).toBe(TASK_STATUS.inProgress);
    }
  });

  it('only the assignee starts work (a lead must assign themselves first)', () => {
    expect(code(() => planTransition(input({ actor: lead })))).toBe('forbidden');
    expect(code(() => planTransition(input({ actor: reviewer })))).toBe('forbidden');
  });

  it('cannot start a task in review or done', () => {
    for (const status of [TASK_STATUS.inReview, TASK_STATUS.done, TASK_STATUS.cancelled]) {
      expect(code(() => planTransition(input({ status })))).toBe('invalid_state');
    }
  });

  it('Pause → paused, closes the work entry (paused)', () => {
    const p = planTransition(input({ action: TASK_ACTION.pause, status: TASK_STATUS.inProgress }));
    expect(p.toStatus).toBe(TASK_STATUS.paused);
    expect(p.close).toEqual({ kinds: ['work'], reason: TIME_STOP_REASON.paused });
    expect(p.open).toBeNull();
  });

  it('Waiting on client → blocked, closes (blocked) and raises a client dependency', () => {
    const p = planTransition(
      input({ action: TASK_ACTION.block, status: TASK_STATUS.inProgress, hasReason: true }),
    );
    expect(p.toStatus).toBe(TASK_STATUS.blocked);
    expect(p.close?.reason).toBe(TIME_STOP_REASON.blocked);
    expect(p.raiseDependency).toBe(true);
  });

  it('Waiting on client needs to say what is needed', () => {
    expect(
      code(() => planTransition(input({ action: TASK_ACTION.block, status: TASK_STATUS.todo }))),
    ).toBe('bad_request');
  });

  it('Send for review → in_review, closes (submitted_for_review), notifies the reviewer', () => {
    const p = planTransition(
      input({ action: TASK_ACTION.sendForReview, status: TASK_STATUS.inProgress }),
    );
    expect(p.toStatus).toBe(TASK_STATUS.inReview);
    expect(p.close?.reason).toBe(TIME_STOP_REASON.submittedForReview);
    expect(p.notify).toBe('reviewer');
    expect(p.review).toBe('sent');
    expect(p.defaultReviewer).toBe(false);
  });

  it('Send for review with no reviewer defaults one', () => {
    const p = planTransition(
      input({ action: TASK_ACTION.sendForReview, status: TASK_STATUS.paused, hasReviewer: false }),
    );
    expect(p.defaultReviewer).toBe(true);
  });

  it('Start review → stays in_review, opens a review entry for the reviewer', () => {
    const p = planTransition(
      input({ action: TASK_ACTION.startReview, status: TASK_STATUS.inReview, actor: reviewer }),
    );
    expect(p.toStatus).toBe(TASK_STATUS.inReview);
    expect(p.open).toBe('review');
    expect(p.takeReview).toBe(false);
  });

  it('a lead who is not the reviewer takes the review over', () => {
    const p = planTransition(
      input({ action: TASK_ACTION.startReview, status: TASK_STATUS.inReview, actor: lead }),
    );
    expect(p.takeReview).toBe(true);
  });

  it('the assignee cannot review their own work', () => {
    expect(
      code(() =>
        planTransition(
          input({
            action: TASK_ACTION.startReview,
            status: TASK_STATUS.inReview,
            actor: { isAssignee: true, isReviewer: true, isLead: false },
          }),
        ),
      ),
    ).toBe('forbidden');
  });

  it('Approve → done, closes the reviewer entry (review_approved)', () => {
    const p = planTransition(
      input({ action: TASK_ACTION.approve, status: TASK_STATUS.inReview, actor: reviewer }),
    );
    expect(p.toStatus).toBe(TASK_STATUS.done);
    expect(p.close).toEqual({ kinds: ['review'], reason: TIME_STOP_REASON.reviewApproved });
    expect(p.completion).toBe('set');
  });

  it('Approve is refused while a blocking task is open', () => {
    expect(
      code(() =>
        planTransition(
          input({
            action: TASK_ACTION.approve,
            status: TASK_STATUS.inReview,
            actor: reviewer,
            blockedByOpenCount: 1,
          }),
        ),
      ),
    ).toBe('invalid_state');
  });

  it('Return with points → todo, closes the reviewer entry (review_returned), notifies assignee', () => {
    const p = planTransition(
      input({
        action: TASK_ACTION.return,
        status: TASK_STATUS.inReview,
        actor: reviewer,
        hasReason: true,
      }),
    );
    expect(p.toStatus).toBe(TASK_STATUS.todo);
    expect(p.close?.reason).toBe(TIME_STOP_REASON.reviewReturned);
    expect(p.notify).toBe('assignee');
  });

  it('Return needs the review points', () => {
    expect(
      code(() =>
        planTransition(
          input({ action: TASK_ACTION.return, status: TASK_STATUS.inReview, actor: reviewer }),
        ),
      ),
    ).toBe('bad_request');
  });

  it('Done without review is allowed when the task has no reviewer (task_done)', () => {
    const p = planTransition(
      input({ action: TASK_ACTION.complete, status: TASK_STATUS.inProgress, hasReviewer: false }),
    );
    expect(p.toStatus).toBe(TASK_STATUS.done);
    expect(p.close?.reason).toBe(TIME_STOP_REASON.taskDone);
  });

  it('Done without review is refused to the assignee when a reviewer is set', () => {
    expect(
      code(() =>
        planTransition(input({ action: TASK_ACTION.complete, status: TASK_STATUS.inProgress })),
      ),
    ).toBe('forbidden');
    // …but a lead may close it.
    expect(
      planTransition(
        input({ action: TASK_ACTION.complete, status: TASK_STATUS.inProgress, actor: lead }),
      ).toStatus,
    ).toBe(TASK_STATUS.done);
  });

  it('Cancel → cancelled, closes every entry on the task (task_cancelled)', () => {
    const p = planTransition(input({ action: TASK_ACTION.cancel, status: TASK_STATUS.inReview }));
    expect(p.toStatus).toBe(TASK_STATUS.cancelled);
    expect(p.close).toEqual({ kinds: ['work', 'review'], reason: TIME_STOP_REASON.taskCancelled });
  });

  it('Reopen is lead-only and only from done / cancelled', () => {
    expect(
      code(() => planTransition(input({ action: TASK_ACTION.reopen, status: TASK_STATUS.done }))),
    ).toBe('forbidden');
    expect(
      planTransition(input({ action: TASK_ACTION.reopen, status: TASK_STATUS.done, actor: lead }))
        .toStatus,
    ).toBe(TASK_STATUS.todo);
    expect(
      code(() =>
        planTransition(input({ action: TASK_ACTION.reopen, status: TASK_STATUS.todo, actor: lead })),
      ),
    ).toBe('invalid_state');
  });

  it('a non-member of the task (not assignee/reviewer/lead) can do nothing', () => {
    for (const action of [
      TASK_ACTION.pause,
      TASK_ACTION.sendForReview,
      TASK_ACTION.approve,
      TASK_ACTION.cancel,
    ]) {
      expect(
        code(() =>
          planTransition(input({ action, status: TASK_STATUS.inProgress, actor: stranger })),
        ),
      ).toBe('forbidden');
    }
  });

  it('idle / day-end / sign-out pause a running work task; a review stays in review', () => {
    expect(statusAfterSystemClose(TASK_STATUS.inProgress, 'work')).toBe(TASK_STATUS.paused);
    expect(statusAfterSystemClose(TASK_STATUS.inReview, 'review')).toBeNull();
  });
});

describe('legacy status changes map onto transitions', () => {
  it.each([
    ['todo', 'in_progress', 'start'],
    ['in_progress', 'paused', 'pause'],
    ['in_progress', 'in_review', 'send-for-review'],
    ['in_review', 'done', 'approve'],
    ['in_progress', 'done', 'complete'],
    ['in_review', 'todo', 'return'],
    ['done', 'todo', 'reopen'],
    ['todo', 'cancelled', 'cancel'],
    ['in_progress', 'blocked', null],
    ['paused', 'todo', null],
  ] as const)('%s → %s = %s', (from, to, action) => {
    expect(actionForStatus(from as TaskStatus, to as TaskStatus)).toBe(action);
  });
});
