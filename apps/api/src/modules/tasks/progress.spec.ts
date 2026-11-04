import { TIMELINE_EVENT, type ProgressRow } from '@hsdg/contracts';
import {
  buildTimeline,
  countsOf,
  filingKey,
  filingLabel,
  parseFilingKey,
  sortProgressRows,
  statusEvent,
  type TaskHeadRow,
} from './progress';

const row = (label: string, overdue: number, open: number): ProgressRow => ({
  key: label,
  label,
  notStarted: open,
  inProgress: 0,
  completed: 0,
  overdue,
  waitingOnClient: 0,
  inReview: 0,
  total: open,
});

describe('progress helpers (D-1)', () => {
  it('round-trips a filing key, a form with a "|" in it and a missing period included', () => {
    expect(parseFilingKey(filingKey('GSTR-1', '2026-10'))).toEqual({
      formLabel: 'GSTR-1',
      periodKey: '2026-10',
    });
    expect(parseFilingKey(filingKey('A|B', '2026-10'))).toEqual({
      formLabel: 'A|B',
      periodKey: '2026-10',
    });
    expect(parseFilingKey(filingKey('ITR', null))).toEqual({ formLabel: 'ITR', periodKey: null });
  });

  it('names a filing "Form · Mon YYYY", the form alone without a period', () => {
    expect(filingLabel('GSTR-1', '2026-10')).toBe('GSTR-1 · Oct 2026');
    expect(filingLabel('ITR', null)).toBe('ITR');
  });

  it('sorts overdue first, then the most open work, then by name', () => {
    const out = sortProgressRows([
      row('Zed', 0, 9),
      row('Amy', 2, 1),
      row('Bob', 0, 9),
      row('Cat', 5, 0),
    ]);
    expect(out.map((r) => r.label)).toEqual(['Cat', 'Amy', 'Bob', 'Zed']);
  });

  it('totals the three statuses; overdue is an overlay, not added', () => {
    expect(
      countsOf({
        not_started: 2,
        in_progress: 3,
        completed: 4,
        overdue: 3,
        waiting: 1,
        in_review: 1,
      }),
    ).toMatchObject({
      notStarted: 2,
      inProgress: 3,
      completed: 4,
      overdue: 3,
      waitingOnClient: 1,
      inReview: 1,
      total: 9,
    });
  });

  it.each([
    [null, 'todo', TIMELINE_EVENT.created],
    ['todo', 'in_progress', TIMELINE_EVENT.started],
    ['paused', 'in_progress', TIMELINE_EVENT.started],
    ['in_progress', 'paused', TIMELINE_EVENT.paused],
    ['in_progress', 'blocked', TIMELINE_EVENT.waitingOnClient],
    ['in_progress', 'in_review', TIMELINE_EVENT.sentForReview],
    ['in_review', 'in_progress', TIMELINE_EVENT.sentBack],
    ['in_review', 'done', TIMELINE_EVENT.approved],
    ['in_progress', 'done', TIMELINE_EVENT.completed],
    ['in_progress', 'cancelled', TIMELINE_EVENT.cancelled],
    ['done', 'in_progress', TIMELINE_EVENT.reopened],
    ['todo', 'todo', null],
  ])('reads %s → %s as %s', (from, to, event) => {
    expect(statusEvent(from, to)).toBe(event);
  });

  const head: TaskHeadRow = {
    created_at: '2026-11-01T04:00:00Z',
    created_by_name: 'Meera',
    assignee_name: 'Kirandeep',
    assigned_by_name: null,
    assigned_at: null,
  };

  it('builds a timeline oldest first, created before assigned at the same instant', () => {
    const entries = buildTimeline(
      head,
      [
        {
          from_status: 'in_progress',
          to_status: 'in_review',
          actor_name: 'Kirandeep',
          reason: null,
          at: '2026-11-03T05:00:00Z',
        },
        {
          from_status: null,
          to_status: 'todo',
          actor_name: 'Meera',
          reason: null,
          at: '2026-11-01T04:00:00Z',
        },
        {
          from_status: 'todo',
          to_status: 'in_progress',
          actor_name: 'Kirandeep',
          reason: null,
          at: '2026-11-02T05:00:00Z',
        },
        {
          from_status: 'in_review',
          to_status: 'done',
          actor_name: 'Meera',
          reason: null,
          at: '2026-11-04T05:00:00Z',
        },
      ],
      [],
      [{ filed_by_name: 'Meera', reference_no: 'AA0711260001', at: '2026-11-04T06:00:00Z' }],
    );
    expect(entries.map((e) => e.event)).toEqual([
      TIMELINE_EVENT.created,
      TIMELINE_EVENT.assigned,
      TIMELINE_EVENT.started,
      TIMELINE_EVENT.sentForReview,
      TIMELINE_EVENT.approved,
      TIMELINE_EVENT.filed,
    ]);
    // No hand-over history: the current holder, given by whoever created it.
    expect(entries[1]).toMatchObject({ byName: 'Meera', toName: 'Kirandeep' });
    expect(entries[5]).toMatchObject({ byName: 'Meera', note: 'AA0711260001' });
  });

  it('uses the hand-over history when there is one, and adds created when no event has it', () => {
    const entries = buildTimeline(
      head,
      [],
      [
        {
          kind: 'assignee',
          by_name: 'Meera',
          to_name: 'Ravi',
          reason: null,
          at: '2026-11-01T04:00:00Z',
        },
        {
          kind: 'assignee',
          by_name: 'Meera',
          to_name: 'Kirandeep',
          reason: 'Ravi on leave',
          at: '2026-11-02T04:00:00Z',
        },
        {
          kind: 'reviewer',
          by_name: 'Meera',
          to_name: 'Anil',
          reason: null,
          at: '2026-11-02T04:30:00Z',
        },
      ],
      [],
    );
    expect(entries.map((e) => [e.event, e.toName ?? null])).toEqual([
      [TIMELINE_EVENT.created, null],
      [TIMELINE_EVENT.assigned, 'Ravi'],
      [TIMELINE_EVENT.assigned, 'Kirandeep'],
      [TIMELINE_EVENT.reviewerSet, 'Anil'],
    ]);
    expect(entries[2]).toMatchObject({ note: 'Ravi on leave' });
  });
});
