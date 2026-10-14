import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { workItemHref } from '@hsdg/contracts';
import type { MyTask } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import {
  filingContextLine,
  isTaskOverdue,
  sortMyTasks,
  todayIst,
  useMyTaskColumns,
} from '../my-task-columns';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn() }),
  usePathname: () => '/my-work',
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/components/actions/task-status-control', () => ({
  TaskStatusControl: () => <span>status</span>,
}));

const TODAY = '2026-10-14';
const task = (over: Partial<MyTask>): MyTask => ({
  id: 't1',
  engagementId: 'e1',
  title: 'Prepare GSTR-1',
  status: 'todo',
  priority: 'normal',
  dueDate: '2026-10-20',
  isOverdue: false,
  blockedByOpenCount: 0,
  version: 1,
  engagementCode: 'ENG-1',
  entityName: 'Bharat Textiles',
  filing: null,
  link: { engagementId: 'e1', engagementKind: 'compliance', taskId: over.id ?? 't1' },
  ...over,
});
const gstTask = task({
  id: 't-gst',
  filing: {
    instanceId: 'i1',
    formLabel: 'GSTR-1',
    periodLabel: 'Sep 2026',
    registrationNumber: '19AAACB1234C1Z5',
    internalDate: '2026-10-09',
    statutoryDate: '2026-10-11',
  },
  link: {
    engagementId: 'e1',
    engagementKind: 'compliance',
    instanceId: 'i1',
    stream: 'gst',
    financialYear: '2026-27',
    periodKey: '2026-09',
    section: 'outward',
    registrationNumber: '19AAACB1234C1Z5',
    taskId: 't-gst',
  },
});

function Table({ rows, onDocuments }: { rows: MyTask[]; onDocuments: (t: MyTask) => void }): JSX.Element {
  const columns = useMyTaskColumns({
    hrefOf: (t) => workItemHref(t.link!),
    onDocuments,
    today: TODAY,
  });
  return <DataTable columns={columns} data={rows} />;
}
const renderTable = (rows: MyTask[], onDocuments = jest.fn()) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Table rows={rows} onDocuments={onDocuments} />
    </QueryClientProvider>,
  );

describe('My Work task columns (WF-104)', () => {
  it('the title is a link to the filing’s month and part, not a popup', () => {
    renderTable([gstTask]);
    const link = screen.getByRole('link', { name: 'Prepare GSTR-1' });
    const url = new URL(link.getAttribute('href')!, 'http://x');
    expect(url.pathname).toBe('/engagements/e1');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      tab: 'gst',
      fy: '2026-27',
      m: '9',
      part: 'outward',
      task: 't-gst',
    });
  });

  it('the folder icon still opens the documents popup', () => {
    const onDocuments = jest.fn();
    renderTable([gstTask], onDocuments);
    fireEvent.click(screen.getByRole('button', { name: 'Documents for Prepare GSTR-1' }));
    expect(onDocuments).toHaveBeenCalledWith(gstTask);
    expect(push).not.toHaveBeenCalled();
  });

  it('shows the filing context and the statutory date beside the internal one', () => {
    renderTable([gstTask]);
    expect(screen.getByText('GSTR-1 · Sep 2026 · 19AAACB1234C1Z5')).toBeTruthy();
    expect(screen.getByTitle('Internal due date').textContent).toMatch(/9/);
    expect(screen.getByTitle('Statutory due date').textContent).toMatch(/^Statutory /);
    // Past its internal date: overdue, even before the API's own flag says so.
    expect(screen.getByTitle('Internal due date').className).toContain('text-danger-600');
  });

  it('a task with no filing shows no context line and only its own date', () => {
    renderTable([task({})]);
    expect(screen.queryByTitle('Statutory due date')).toBeNull();
    expect(filingContextLine(task({}))).toBeNull();
  });
});

describe('sortMyTasks', () => {
  it('overdue first, then by internal date, undated and closed last', () => {
    const rows = [
      task({ id: 'later', dueDate: '2026-10-30' }),
      task({ id: 'closed', status: 'done', dueDate: '2026-10-01' }),
      task({ id: 'undated', dueDate: null }),
      task({ id: 'soon', dueDate: '2026-10-16' }),
      { ...gstTask, id: 'overdue-by-filing' },
      task({ id: 'flagged', isOverdue: true, dueDate: '2026-10-13' }),
    ];
    expect(sortMyTasks(rows, TODAY).map((t) => t.id)).toEqual([
      'overdue-by-filing',
      'flagged',
      'soon',
      'later',
      'undated',
      'closed',
    ]);
  });

  it('a done task is never overdue', () => {
    expect(isTaskOverdue(task({ status: 'done', isOverdue: true }), TODAY)).toBe(false);
  });
});

describe('todayIst', () => {
  it('rolls over at midnight IST, not UTC', () => {
    expect(todayIst(new Date('2026-10-14T19:00:00Z'))).toBe('2026-10-15');
    expect(todayIst(new Date('2026-10-14T18:00:00Z'))).toBe('2026-10-14');
  });
});
