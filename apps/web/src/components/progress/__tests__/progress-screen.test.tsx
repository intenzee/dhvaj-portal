import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ProgressRow, ProgressView } from '@hsdg/contracts';
import { ProgressScreen, summaryLine } from '../progress-screen';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
let principal: unknown = null;
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal }) }));
const downloadCsv = jest.fn();
jest.mock('@/lib/csv', () => ({ downloadCsv: (...args: unknown[]) => downloadCsv(...args) }));

jest.setTimeout(20_000);

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const as = (role: string) => ({
  userId: 'u',
  email: 'x@dhvaj.in',
  displayName: 'X',
  officeId: 'o',
  officeCode: 'NORTH',
  employeeId: 'e',
  roles: [role],
  effectiveRole: undefined,
  permissions: ['engagement.read'],
  mfaRequired: false,
  mfaSatisfied: false,
});

const counts = {
  notStarted: 1,
  inProgress: 2,
  completed: 1,
  overdue: 2,
  waitingOnClient: 1,
  inReview: 1,
  total: 4,
};
const kirandeep: ProgressRow = {
  key: 'a1',
  label: 'Kirandeep Kaur',
  employeeId: 'a1',
  ...counts,
};
const personView: ProgressView = {
  groupBy: 'person',
  scope: 'tree',
  today: '2026-11-04',
  filters: {},
  totals: counts,
  rows: [kirandeep],
};
const filingRow: ProgressRow = {
  key: 'GSTR-1|2026-10',
  label: 'GSTR-1 · Oct 2026',
  formLabel: 'GSTR-1',
  periodKey: '2026-10',
  holders: [{ employeeId: 'a1', fullName: 'Kirandeep', open: 2 }],
  notStarted: 1,
  inProgress: 1,
  completed: 14,
  overdue: 1,
  waitingOnClient: 0,
  inReview: 0,
  total: 16,
};

function route(path: string): unknown {
  if (path.startsWith('/work/progress/items')) {
    return {
      items: [
        {
          taskId: 't1',
          title: 'Prepare GSTR-1',
          status: 'blocked',
          progress: 'in_progress',
          isOverdue: true,
          dueDate: '2026-11-02',
          engagementId: 'g1',
          engagementCode: 'ENG-1',
          entityName: 'Sunrise Traders',
          clientName: 'Sunrise Traders',
          assigneeId: 'a1',
          assigneeName: 'Kirandeep Kaur',
          reviewerName: null,
          filingLabel: 'GSTR-1 · Oct 2026',
          stream: 'gst',
          link: { engagementId: 'g1', engagementKind: 'compliance', taskId: 't1' },
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };
  }
  if (path.startsWith('/work/progress/tasks/t1/timeline')) {
    return {
      taskId: 't1',
      title: 'Prepare GSTR-1',
      entries: [
        { event: 'created', at: '2026-11-01T04:00:00Z', byName: 'Meera' },
        {
          event: 'assigned',
          at: '2026-11-01T04:00:00Z',
          byName: 'Meera',
          toName: 'Kirandeep Kaur',
        },
        { event: 'waiting_on_client', at: '2026-11-02T05:00:00Z', byName: 'Kirandeep Kaur' },
      ],
    };
  }
  if (path.includes('groupBy=filing')) {
    return { ...personView, groupBy: 'filing', rows: [filingRow] };
  }
  if (path.startsWith('/work/progress')) return personView;
  return [];
}

describe('Progress page (D-2)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation((path: string) => Promise.resolve(route(path)));
    downloadCsv.mockReset();
  });

  it('shows a Senior the counts, overdue first, and a row’s tasks and history under it', async () => {
    principal = as('senior');
    render(wrap(<ProgressScreen />));
    expect(
      await screen.findByText('You and the people who report to you.', { exact: false }),
    ).toBeTruthy();
    const tiles = screen.getAllByText(/^(Overdue|Not started|In progress|Completed)$/);
    expect(tiles[0]!.textContent).toBe('Overdue');
    expect(screen.getByText('1 waiting on client · 1 in review')).toBeTruthy();
    expect(apiFetch.mock.calls[0]![0]).toMatch(
      /^\/work\/progress\?groupBy=person&from=\d{4}-\d{2}-01&to=/,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Show tasks for Kirandeep Kaur' }));
    const task = await screen.findByRole('link', { name: 'Prepare GSTR-1' });
    expect(task.getAttribute('href')).toContain('/engagements/g1');
    expect(
      apiFetch.mock.calls.some(([p]) => /items\?groupBy=person&key=a1/.test(p as string)),
    ).toBe(true);
    const item = task.closest('li')!;
    expect(within(item as HTMLElement).getByText('Overdue')).toBeTruthy();
    expect(within(item as HTMLElement).getByText('In progress · Waiting on client')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Show history of Prepare GSTR-1' }));
    expect(await screen.findByText('to Kirandeep Kaur by Meera', { exact: false })).toBeTruthy();
    expect(screen.getByText('Waiting on client')).toBeTruthy();
  });

  it('switches to By filing and exports the table it shows', async () => {
    principal = as('manager');
    render(wrap(<ProgressScreen />));
    await screen.findByText('Kirandeep Kaur');
    await userEvent.click(screen.getByRole('tab', { name: 'By filing' }));
    expect(await screen.findByText('14 of 16 completed, 2 with Kirandeep, 1 overdue')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalled());
    const [name, headers, rows] = downloadCsv.mock.calls[0]!;
    expect(name).toMatch(/^progress-filing-/);
    expect(headers.slice(0, 3)).toEqual(['Filing', 'With', 'Overdue']);
    expect(rows[0].slice(0, 2)).toEqual(['GSTR-1 · Oct 2026', '2 with Kirandeep']);
  });

  it('tells an Article where their work is and who has the team view', () => {
    principal = as('article');
    render(wrap(<ProgressScreen />));
    expect(screen.getByText(/Progress is for Seniors and above/)).toBeTruthy();
    expect(screen.getByText(/ask your Senior or Manager/)).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('writes the filing line the plan asks for', () => {
    expect(summaryLine(filingRow)).toBe('14 of 16 completed, 2 with Kirandeep, 1 overdue');
  });
});
