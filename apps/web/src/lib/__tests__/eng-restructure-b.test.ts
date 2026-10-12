import { AUTO_TIME } from '@hsdg/contracts';
import { availableTaskActions, type WorkTask } from '../work-types';
import { mergeQuery, monthKeyFor, monthParamOf } from '../url-state';
import { shouldBeat } from '../use-heartbeat';
import { workListQuery } from '@/components/tasks/work-list';
import { activityQuery } from '@/components/engagement/activity-tab';
import { linesFromTime } from '@/components/engagement/bill-from-time';
import { documentFilters } from '@/components/engagement/documents-tab';
import { dueItemHref } from '@/components/engagement/overview-widgets';
import { figurePayload, referenceError } from '@/components/filing/instance-workspace';
import { adjustableEntries } from '@/components/engagement/activity-tab';
import type { TimeEntryRecord } from '@hsdg/contracts';
import { periodParam, pillTone } from '@/components/filing/stream-tab';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

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

describe('availableTaskActions', () => {
  it('lets the assignee start a todo task but not complete it past the reviewer', () => {
    const a = availableTaskActions(task({}), { me: 'A', isLead: false });
    expect(a).toEqual(['start', 'block', 'send-for-review', 'cancel']);
  });
  it('offers pause (not start) while in progress', () => {
    const a = availableTaskActions(task({ status: 'in_progress' }), { me: 'A', isLead: false });
    expect(a).toContain('pause');
    expect(a).not.toContain('start');
  });
  it('lets the assignee complete when there is no reviewer', () => {
    const a = availableTaskActions(task({ reviewerId: null }), { me: 'A', isLead: false });
    expect(a).toContain('complete');
  });
  it('gives the reviewer start-review, approve and return in review', () => {
    const a = availableTaskActions(task({ status: 'in_review' }), { me: 'R', isLead: false });
    expect(a).toEqual(['start-review', 'approve', 'return']);
    const started = availableTaskActions(task({ status: 'in_review', reviewStartedAt: '2026-10-12T05:00:00Z' }), {
      me: 'R',
      isLead: false,
    });
    expect(started).toEqual(['approve', 'return']);
  });
  it('shows nothing to an outsider, and reopen only to a lead', () => {
    expect(availableTaskActions(task({}), { me: 'X', isLead: false })).toEqual([]);
    expect(availableTaskActions(task({ status: 'done' }), { me: 'A', isLead: false })).toEqual([]);
    expect(availableTaskActions(task({ status: 'done' }), { me: 'L', isLead: true })).toEqual(['reopen']);
  });
});

describe('url state', () => {
  it('merges and deletes keys', () => {
    expect(mergeQuery('tab=gst&m=10', { m: null, fy: '2026-27' })).toBe('?tab=gst&fy=2026-27');
    expect(mergeQuery('tab=gst', { tab: '' })).toBe('');
  });
  it('maps FY months both ways', () => {
    expect(monthKeyFor('2026-27', '10')).toBe('2026-10');
    expect(monthKeyFor('2026-27', '2')).toBe('2027-02');
    expect(monthKeyFor('2026-27', '13')).toBeNull();
    expect(monthKeyFor('2026-27', null)).toBeNull();
    expect(monthParamOf('2026-09')).toBe('9');
    expect(monthParamOf('2026-27-Q1')).toBeNull();
  });
});

describe('shouldBeat', () => {
  const now = 1_000_000_000;
  it('beats only when visible and recently active', () => {
    expect(shouldBeat(now, now - 60_000, true)).toBe(true);
    expect(shouldBeat(now, now - 60_000, false)).toBe(false);
    expect(shouldBeat(now, now - AUTO_TIME.activeWithinMinutes * 60_000 - 1, true)).toBe(false);
  });
});

describe('query builders', () => {
  it('work list', () => {
    expect(workListQuery({ stream: 'gst', open: true })).toBe('limit=100&stream=gst&open=true');
    expect(workListQuery({ status: 'done', open: true })).toBe('limit=100&status=done');
  });
  it('activity', () => {
    expect(activityQuery({ filter: 'filings', stream: 'gst', cursor: 'abc' })).toBe(
      'limit=50&kind=filing_lodged%2Cfiling_undone%2Cfiling_correction%2Cfiling_waived&stream=gst&cursor=abc',
    );
    expect(activityQuery({ filter: 'all' })).toBe('limit=50');
  });
  it('document filters from the URL', () => {
    const q: Record<string, string> = { dstream: 'gst', dfy: '2026-27', dsection: 'summary' };
    expect(documentFilters((k) => q[k] ?? null, 'reg-1')).toEqual({
      stream: 'gst',
      financialYear: '2026-27',
      section: 'summary',
      registrationId: 'reg-1',
    });
  });
});

describe('filing helpers', () => {
  it('turns form figures into numbers / nulls', () => {
    const schema = [
      { key: 'igst', label: 'IGST', kind: 'amount' as const, required: true },
      { key: 'arn', label: 'ARN', kind: 'text' as const, required: false },
      { key: 'blank', label: 'Blank', kind: 'integer' as const, required: false },
    ];
    expect(figurePayload(schema, { igst: '1,25,000.50', arn: ' X1 ', blank: '' })).toEqual({
      igst: 125000.5,
      arn: 'X1',
      blank: null,
    });
  });
  it('colours pills and picks the period URL key', () => {
    expect(pillTone({ workflowStatus: 'filed', isOverdue: false, isLate: false })).toContain('success');
    expect(pillTone({ workflowStatus: 'filed', isOverdue: false, isLate: true })).toContain('warning');
    expect(pillTone({ workflowStatus: 'in_preparation', isOverdue: true, isLate: false })).toContain('danger');
    expect(periodParam('gst', '2026-10')).toEqual({ key: 'm', value: '10' });
    expect(periodParam('tds', '2026-27-Q2')).toEqual({ key: 'p', value: '2026-27-Q2' });
  });
  it('deep-links an Overview item to its GST month', () => {
    expect(
      dueItemHref('e1', {
        instanceId: 'i',
        stream: 'gst',
        label: 'GSTR-3B',
        periodKey: '2026-09',
        periodLabel: 'Sep 2026',
        section: 'summary',
        dueDate: '2026-10-20',
        daysLeft: 8,
        workflowStatus: 'in_preparation',
        registrationNumber: '27AAAAA0000A1Z5',
      }),
    ).toBe('/engagements/e1?tab=gst&m=9&gstin=27AAAAA0000A1Z5');
  });
  it('bills only streams with billable time and a rate', () => {
    const rows = [
      { key: 'gst', label: 'GST', totalSeconds: 5400, billableSeconds: 5400, nonBillableSeconds: 0, entryCount: 2 },
      { key: 'tds', label: 'TDS', totalSeconds: 3600, billableSeconds: 3600, nonBillableSeconds: 0, entryCount: 1 },
      { key: 'roc', label: 'ROC', totalSeconds: 600, billableSeconds: 0, nonBillableSeconds: 600, entryCount: 1 },
    ];
    expect(linesFromTime(rows, { gst: '2000', roc: '1000' }, '')).toEqual([
      { description: 'GST — professional time', quantity: '1.50', unitAmount: '2000.00', sortOrder: 0 },
    ]);
  });
});

describe('lodge and time-correction guards', () => {
  it('checks a GST ARN', () => {
    expect(referenceError('arn', 'AA190920261234X')).toBeNull();
    expect(referenceError('arn', 'aa190920261234x')).toMatch(/15 upper-case/);
    expect(referenceError('arn', 'AA1909')).toMatch(/15 upper-case/);
    expect(referenceError('srn', 'F12345678')).toBeNull();
    expect(referenceError('ack', ' ')).toMatch(/Enter/);
  });
  it('offers only my finished original entries from the last 3 days', () => {
    const now = Date.parse('2026-10-12T10:00:00Z');
    const base = {
      engagementId: 'e',
      employeeName: 'A',
      durationSeconds: 600,
      note: null,
      stoppedReason: null,
      taskId: null,
      taskTitle: null,
      engagementServiceId: null,
      entryKind: 'work',
      source: 'auto',
      category: null,
      isBillable: true,
    };
    const e = (over: Record<string, unknown>) =>
      ({
        ...base,
        id: 'x',
        employeeId: 'me',
        startedAt: '2026-10-11T05:00:00Z',
        endedAt: '2026-10-11T05:10:00Z',
        isRunning: false,
        adjustsEntryId: null,
        ...over,
      }) as unknown as TimeEntryRecord;
    const out = adjustableEntries(
      [
        e({ id: 'ok' }),
        e({ id: 'other', employeeId: 'B' }),
        e({ id: 'running', isRunning: true, endedAt: null }),
        e({ id: 'adj', adjustsEntryId: 'ok' }),
        e({ id: 'old', startedAt: '2026-10-01T05:00:00Z' }),
      ],
      'me',
      now,
    ).map((x) => x.id);
    expect(out).toEqual(['ok']);
  });
});
