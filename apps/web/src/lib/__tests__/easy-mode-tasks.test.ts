import { RELAXED_FIRM_CHECKS, STRICT_FIRM_CHECKS } from '@hsdg/contracts';
import {
  availableTaskActions,
  needsReviewerPick,
  reasonRequired,
  type TaskActionContext,
  type WorkTask,
} from '../work-types';

const task = (over: Partial<WorkTask>): WorkTask => ({
  id: 't1',
  engagementId: 'e1',
  title: 'Prepare 3B',
  description: null,
  status: 'todo',
  priority: 'normal',
  dueDate: null,
  isOverdue: false,
  blockedByOpenCount: 0,
  assignedToId: 'A',
  assignedToName: 'Asha',
  engagementServiceId: null,
  stream: 'gst',
  reviewerId: 'R',
  reviewerName: 'Ravi',
  workType: null,
  complianceInstanceId: null,
  sentForReviewAt: null,
  reviewStartedAt: null,
  version: 1,
  ...over,
});

const relaxed = (me: string): TaskActionContext => ({
  me,
  isLead: false,
  checks: RELAXED_FIRM_CHECKS,
});
const strict = (me: string): TaskActionContext => ({
  me,
  isLead: false,
  checks: STRICT_FIRM_CHECKS,
});

describe('task buttons follow the firm checks', () => {
  it('a teammate who is not the assignee sees the work buttons when task_assignee_only is off', () => {
    expect(availableTaskActions(task({}), strict('X'))).toEqual([]);
    expect(availableTaskActions(task({}), relaxed('X'))).toEqual([
      'start',
      'block',
      'send-for-review',
      'complete',
      'cancel',
    ]);
  });

  it('no checks given means every check is on', () => {
    expect(availableTaskActions(task({}), { me: 'X', isLead: false })).toEqual([]);
  });

  it('a task with a reviewer can be marked done when review is optional', () => {
    expect(availableTaskActions(task({}), strict('A'))).not.toContain('complete');
    expect(availableTaskActions(task({}), relaxed('A'))).toContain('complete');
  });

  it('the team reopens when task_reopen_lead_only is off', () => {
    expect(availableTaskActions(task({ status: 'done' }), strict('A'))).toEqual([]);
    expect(availableTaskActions(task({ status: 'done' }), relaxed('A'))).toEqual(['reopen']);
  });

  it('nobody is offered approval of their own work', () => {
    const own = availableTaskActions(task({ status: 'in_review' }), relaxed('A'));
    expect(own).not.toContain('approve');
    expect(availableTaskActions(task({ status: 'in_review' }), relaxed('X'))).toContain('approve');
  });

  it('reasons are optional and a reviewer is asked for only when review is optional', () => {
    expect(reasonRequired('return', strict('A'))).toBe(true);
    expect(reasonRequired('return', relaxed('A'))).toBe(false);
    expect(needsReviewerPick(task({ reviewerId: null }), relaxed('A'))).toBe(true);
    expect(needsReviewerPick(task({ reviewerId: null }), strict('A'))).toBe(false);
    expect(needsReviewerPick(task({}), relaxed('A'))).toBe(false);
  });
});
