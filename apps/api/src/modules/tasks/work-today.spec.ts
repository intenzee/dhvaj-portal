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
  it('returns the groups in order: past due lifted to Overdue, the rest by due date', () => {
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
    expect(view.groups.map((g) => g.group)).toEqual([
      'overdue',
      'due_today',
      'prepare',
      'review',
      'waiting',
      'due_soon',
    ]);
    expect(view.groups[0]!.items.map((i) => [i.key, i.group])).toEqual([['late', 'overdue']]);
    expect(view.groups[2]!.items.map((i) => i.key)).toEqual(['soon', 'later', 'undated']);
    expect(view.groups[2]!.total).toBe(3);
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
      'overdue',
      'due_today',
      'prepare',
      'review',
      'notices',
      'waiting',
      'due_soon',
    ]);
    expect(view.groups[4]!.items.map((i) => i.key)).toEqual(['notice:a', 'notice:c', 'notice:b']);
  });

  it('adds Write-offs to approve after Notices only when its rows are passed (PS-205)', () => {
    const base = { prepare: [], review: [], waiting: [], due_soon: [] };
    expect(buildTodayView(TODAY, base).groups.map((g) => g.group)).not.toContain('write_offs');
    const view = buildTodayView(TODAY, {
      ...base,
      notices: [],
      write_offs: [
        item({
          key: 'write_off:b',
          kind: 'write_off',
          group: 'write_offs',
          internalDate: '2026-10-14',
        }),
        item({
          key: 'credit_note:a',
          kind: 'credit_note',
          group: 'write_offs',
          internalDate: '2026-10-12',
        }),
      ],
    });
    expect(view.groups.map((g) => g.group)).toEqual([
      'overdue',
      'due_today',
      'prepare',
      'review',
      'notices',
      'write_offs',
      'waiting',
      'due_soon',
    ]);
    expect(view.groups[5]!.items.map((i) => i.key)).toEqual(['credit_note:a', 'write_off:b']);
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
    const prepare = v.groups.find((g) => g.group === 'prepare')!;
    expect(prepare.total).toBe(TODAY_GROUP_LIMIT + 20);
    expect(prepare.items).toHaveLength(TODAY_GROUP_LIMIT);
    expect(prepare.items[0]!.internalDate).toBe('2026-11-01');
    expect(v.groups[0]!.items.map((i) => i.key)).toEqual(['late']);
  });

  it('a filing due today by either date is Due today, even with no internal date', () => {
    const view = buildTodayView(TODAY, {
      prepare: [item({ key: 'task:t1', internalDate: '2026-10-20', statutoryDate: TODAY })],
      review: [],
      waiting: [],
      due_soon: [
        item({
          key: 'filing:i1',
          kind: 'filing',
          group: 'due_soon',
          statutoryDate: TODAY,
          link: onFiling('i1'),
        }),
        item({
          key: 'filing:i2',
          kind: 'filing',
          group: 'due_soon',
          internalDate: '2026-10-12',
          statutoryDate: '2026-10-20',
          link: onFiling('i2'),
        }),
        item({
          key: 'filing:i3',
          kind: 'filing',
          group: 'due_soon',
          statutoryDate: '2026-10-18',
          link: onFiling('i3'),
        }),
      ],
    });
    const keys = (g: string) => view.groups.find((x) => x.group === g)!.items.map((i) => i.key);
    expect(keys('due_today')).toEqual(['filing:i1', 'task:t1']);
    expect(keys('overdue')).toEqual(['filing:i2']);
    expect(keys('due_soon')).toEqual(['filing:i3']);
    expect(keys('prepare')).toEqual([]);
    expect(
      view.groups.find((x) => x.group === 'due_today')!.items.every((i) => i.group === 'due_today'),
    ).toBe(true);
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

  it('puts a tax audit with a missed milestone under Overdue, in date order (F-9)', () => {
    const view = buildTodayView(TODAY, {
      prepare: [item({ key: 'late', internalDate: '2026-10-10', isOverdue: true })],
      review: [],
      waiting: [],
      due_soon: [],
      milestones: [
        item({
          key: 'tax_audit_milestone:a1',
          kind: 'tax_audit_milestone',
          group: 'overdue',
          internalDate: '2026-09-01',
          statutoryDate: '2026-10-31',
          isOverdue: true,
        }),
        item({
          key: 'tax_audit_milestone:a2',
          kind: 'tax_audit_milestone',
          group: 'overdue',
          engagementId: 'e2',
          internalDate: '2026-10-12',
          isOverdue: true,
        }),
      ],
    });
    expect(view.groups[0]!.items.map((i) => i.key)).toEqual([
      'tax_audit_milestone:a1',
      'late',
      'tax_audit_milestone:a2',
    ]);
    const narrowed = buildTodayView(
      TODAY,
      {
        prepare: [],
        review: [],
        waiting: [],
        due_soon: [],
        milestones: [item({ key: 'tax_audit_milestone:a2', engagementId: 'e2', isOverdue: true })],
      },
      'e1',
    );
    expect(narrowed.groups[0]!.items).toEqual([]);
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

  it('a filing sent to me is a task row I can start reviewing, overdue by its earlier date', () => {
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
