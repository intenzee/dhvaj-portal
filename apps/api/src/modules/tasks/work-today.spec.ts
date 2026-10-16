import {
  TODAY_GROUP_LIMIT,
  type FilingReviewItem,
  type ReviewPointItem,
  type TodayItem,
} from '@hsdg/contracts';
import { buildTodayView, reviewToToday } from './work-today';

const TODAY = '2026-10-14';

const item = (over: Partial<TodayItem> & { key: string }): TodayItem => ({
  kind: 'task',
  group: 'prepare',
  title: over.key,
  engagementId: 'e1',
  engagementCode: 'ENG-1',
  engagementKind: 'compliance',
  entityName: 'Bharat Textiles',
  filing: null,
  internalDate: null,
  statutoryDate: null,
  status: 'todo',
  isOverdue: false,
  blockedByOpenCount: 0,
  task: null,
  link: { engagementId: 'e1', engagementKind: 'compliance' },
  ...over,
});
const onFiling = (instanceId: string) => ({
  engagementId: 'e1',
  engagementKind: 'compliance' as const,
  instanceId,
});

describe('buildTodayView (WF-201)', () => {
  it('returns the four groups in order, each overdue first then by internal date', () => {
    const view = buildTodayView(TODAY, {
      prepare: [
        item({ key: 'undated' }),
        item({ key: 'later', internalDate: '2026-10-20' }),
        item({ key: 'late', internalDate: '2026-10-10', isOverdue: true }),
        item({ key: 'soon', internalDate: '2026-10-15' }),
      ],
      review: [],
      waiting: [],
      due_soon: [],
    });
    expect(view.today).toBe(TODAY);
    expect(view.groups.map((g) => g.group)).toEqual(['prepare', 'review', 'waiting', 'due_soon']);
    expect(view.groups[0]!.items.map((i) => i.key)).toEqual(['late', 'soon', 'later', 'undated']);
    expect(view.groups[0]!.total).toBe(4);
  });

  it('adds Notices after To review only when its rows are passed (ff_notices on), earliest clock first (PS-102)', () => {
    const base = { prepare: [], review: [], waiting: [], due_soon: [] };
    expect(buildTodayView(TODAY, base).groups.map((g) => g.group)).not.toContain('notices');
    const notice = (key: string, internalDate: string, isOverdue = false): TodayItem =>
      item({ key, kind: 'notice', group: 'notices', internalDate, isOverdue });
    const view = buildTodayView(TODAY, {
      ...base,
      notices: [
        notice('notice:b', '2026-10-20'),
        notice('notice:a', '2026-10-09', true),
        notice('notice:c', '2026-10-16'),
      ],
    });
    expect(view.groups.map((g) => g.group)).toEqual([
      'prepare',
      'review',
      'notices',
      'waiting',
      'due_soon',
    ]);
    expect(view.groups[2]!.items.map((i) => i.key)).toEqual(['notice:a', 'notice:c', 'notice:b']);
  });

  it('a filing already listed above is not repeated under Due this week', () => {
    const view = buildTodayView(TODAY, {
      prepare: [item({ key: 'task:t1', link: onFiling('i1') })],
      review: [item({ key: 'task:t2', group: 'review', link: onFiling('i2') })],
      waiting: [item({ key: 'client_request:r1', group: 'waiting', link: onFiling('i3') })],
      due_soon: ['i1', 'i2', 'i3', 'i4'].map((id) =>
        item({ key: `filing:${id}`, kind: 'filing', group: 'due_soon', link: onFiling(id) }),
      ),
    });
    const due = view.groups.find((g) => g.group === 'due_soon')!;
    expect(due.items.map((i) => i.key)).toEqual(['filing:i4']);
    expect(due.total).toBe(1);
  });

  it('sends the most urgent TODAY_GROUP_LIMIT rows of a group and counts them all', () => {
    const many = Array.from({ length: TODAY_GROUP_LIMIT + 20 }, (_, n) =>
      item({ key: `t${n}`, internalDate: `2026-11-${String((n % 28) + 1).padStart(2, '0')}` }),
    );
    const late = item({ key: 'late', internalDate: '2026-09-01', isOverdue: true });
    const v = buildTodayView('2026-10-14', {
      prepare: [...many, late],
      review: [],
      waiting: [],
      due_soon: [],
    });
    const prepare = v.groups[0]!;
    expect(prepare.total).toBe(TODAY_GROUP_LIMIT + 21);
    expect(prepare.items).toHaveLength(TODAY_GROUP_LIMIT);
    expect(prepare.items[0]!.key).toBe('late');
  });

  it('?engagementId= keeps one engagement in every group', () => {
    const view = buildTodayView(
      TODAY,
      {
        prepare: [item({ key: 'a' }), item({ key: 'b', engagementId: 'e2' })],
        review: [item({ key: 'c', group: 'review', engagementId: 'e2' })],
        waiting: [],
        due_soon: [],
      },
      'e2',
    );
    expect(view.groups.flatMap((g) => g.items.map((i) => i.key))).toEqual(['b', 'c']);
  });
});

describe('reviewToToday', () => {
  const filingReview: FilingReviewItem = {
    id: 't2',
    type: 'filing_review',
    engagementId: 'e1',
    engagementCode: 'ENG-1',
    engagementKind: 'compliance',
    entityName: 'Bharat Textiles',
    title: 'GSTR-1 · Sep 2026',
    waitingSince: '2026-10-12T05:00:00.000Z',
    daysWaiting: 2,
    link: onFiling('i1'),
    taskId: 't2',
    preparerId: 'prep',
    preparerName: 'Senior Y',
    dueDate: null,
    internalDate: '2026-10-09',
    statutoryDate: '2026-10-11',
    reviewStarted: false,
    reviewStartedAt: null,
    taskVersion: 4,
    filing: null,
  };

  it('a filing sent to me is a task row I can start reviewing, overdue by its internal date', () => {
    const row = reviewToToday(filingReview, TODAY, 'me');
    expect(row).toMatchObject({
      key: 'task:t2',
      kind: 'task',
      group: 'review',
      status: 'in_review',
      isOverdue: true,
      task: { id: 't2', version: 4, assignedToId: 'prep', reviewerId: 'me', reviewStartedAt: null },
    });
  });

  it('a review point has no task and no date', () => {
    const point: ReviewPointItem = {
      ...filingReview,
      id: 'rp1',
      type: 'review_point',
      title: 'Reconcile ITC',
      reviewPointId: 'rp1',
      raisedById: 'ep',
      raisedByName: 'EP',
      isKeyMatter: false,
    } as ReviewPointItem;
    expect(reviewToToday(point, TODAY, 'me')).toMatchObject({
      key: 'review_point:rp1',
      kind: 'review_point',
      task: null,
      internalDate: null,
      isOverdue: false,
    });
  });
});
