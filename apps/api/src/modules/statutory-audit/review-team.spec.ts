import {
  isReviewOverdue,
  reviewLevelFor,
  reviewNoteIsOpen,
  summarizeReview,
  secondsToHours,
  sumMembers,
  REVIEW_LEVEL,
  REVIEW_NOTE_STATUS,
  REVIEW_TARGET_TYPE,
  type AuditTeamMember,
  type ReviewQueueItem,
} from '@hsdg/contracts';

describe('reviewNoteIsOpen (§25)', () => {
  it('treats open and responded as live, cleared as closed', () => {
    expect(reviewNoteIsOpen({ status: REVIEW_NOTE_STATUS.open })).toBe(true);
    expect(reviewNoteIsOpen({ status: REVIEW_NOTE_STATUS.responded })).toBe(true);
    expect(reviewNoteIsOpen({ status: REVIEW_NOTE_STATUS.cleared })).toBe(false);
  });
});

describe('isReviewOverdue (§25)', () => {
  const today = '2026-09-18';
  it('is overdue only with a past due date', () => {
    expect(isReviewOverdue({ dueDate: '2026-09-10' }, today)).toBe(true);
    expect(isReviewOverdue({ dueDate: '2026-09-30' }, today)).toBe(false);
    expect(isReviewOverdue({ dueDate: today }, today)).toBe(false);
    expect(isReviewOverdue({ dueDate: null }, today)).toBe(false);
  });
});

describe('reviewLevelFor (§24, §25)', () => {
  it('is partner only when the reviewer is the EP', () => {
    expect(reviewLevelFor('ep-1', 'ep-1')).toBe(REVIEW_LEVEL.partner);
    expect(reviewLevelFor('mgr-1', 'ep-1')).toBe(REVIEW_LEVEL.manager);
    expect(reviewLevelFor(null, 'ep-1')).toBe(REVIEW_LEVEL.manager);
    expect(reviewLevelFor('ep-1', null)).toBe(REVIEW_LEVEL.manager);
  });
});

describe('summarizeReview (§25)', () => {
  const q = (over: Partial<ReviewQueueItem>): ReviewQueueItem => ({
    targetType: REVIEW_TARGET_TYPE.procedure,
    targetId: 'p',
    label: 'x',
    workAreaTitle: null,
    preparerName: null,
    reviewerName: null,
    reviewLevel: REVIEW_LEVEL.manager,
    state: 'ready_for_review',
    dueDate: null,
    isOverdue: false,
    ...over,
  });

  it('splits pending review by level and counts open + blocking notes', () => {
    const queue = [
      q({ reviewLevel: REVIEW_LEVEL.manager }),
      q({ reviewLevel: REVIEW_LEVEL.manager, isOverdue: true }),
      q({ reviewLevel: REVIEW_LEVEL.partner }),
    ];
    const notes = [
      { status: REVIEW_NOTE_STATUS.open, isBlocking: true },
      { status: REVIEW_NOTE_STATUS.responded, isBlocking: false },
      { status: REVIEW_NOTE_STATUS.cleared, isBlocking: true },
    ];
    expect(summarizeReview(queue, notes)).toEqual({
      pendingManagerReview: 2,
      pendingPartnerReview: 1,
      openReviewNotes: 2,
      overdueReviews: 1,
      blockingOpenNotes: 1, // cleared blocking note does not count
    });
  });

  it('is all-zero for an empty file', () => {
    expect(summarizeReview([], [])).toEqual({
      pendingManagerReview: 0,
      pendingPartnerReview: 0,
      openReviewNotes: 0,
      overdueReviews: 0,
      blockingOpenNotes: 0,
    });
  });
});

describe('secondsToHours (§24)', () => {
  it('converts to hours at one decimal, clamping non-positive to 0', () => {
    expect(secondsToHours(3600)).toBe(1);
    expect(secondsToHours(5400)).toBe(1.5);
    expect(secondsToHours(0)).toBe(0);
    expect(secondsToHours(-10)).toBe(0);
    expect(secondsToHours(Number.NaN)).toBe(0);
  });
});

describe('sumMembers (§24)', () => {
  const m = (planned: number, actual: number): AuditTeamMember => ({
    employeeId: 'e',
    name: 'n',
    role: 'Member',
    workItems: 0,
    plannedHours: planned,
    actualHours: actual,
    isReviewer: false,
  });
  it('totals a picked field to one decimal', () => {
    const members = [m(10.5, 4.2), m(20, 8.1)];
    expect(sumMembers(members, (x) => x.plannedHours)).toBe(30.5);
    expect(sumMembers(members, (x) => x.actualHours)).toBe(12.3);
    expect(sumMembers([], (x) => x.plannedHours)).toBe(0);
  });
});
