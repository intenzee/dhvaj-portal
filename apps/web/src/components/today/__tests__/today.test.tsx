import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TodayItem, TodayView } from '@hsdg/contracts';
import TodayPage from '@/app/(portal)/today/page';
import {
  stepSelection,
  todayContextLine,
  todayDrawerItems,
  todayRows,
  todayWorkTask,
} from '../today-model';

let search = new URLSearchParams();
const replace = jest.fn((url: string) => {
  search = new URLSearchParams(url.split('?')[1] ?? '');
});
const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/today',
  useSearchParams: () => search,
}));
const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ principal: { employeeId: 'me', roles: ['senior'], permissions: [] } }),
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));
let flagOn = true;
let runsOn = false;
jest.mock('@/lib/feature-flags', () => ({
  useFeatureFlags: () => ({
    isOn: (f: string) =>
      f === 'ff_today_view' ? flagOn : f === 'ff_filing_runs' ? runsOn : f === 'ff_work_links',
    isLoading: false,
    flags: {},
  }),
}));
jest.mock('@/components/filing/filing-drawer', () => ({
  ...jest.requireActual('@/components/filing/filing-drawer'),
  FilingDrawer: ({ items }: { items: { instanceId: string }[] }) => (
    <div data-testid="drawer" data-open={search.get('open') ?? ''}>
      {items.map((i) => i.instanceId).join(',')}
    </div>
  ),
}));

const filing = (instanceId: string) => ({
  instanceId,
  formLabel: 'GSTR-1',
  periodLabel: 'Sep 2026',
  registrationNumber: '19AAACB1234C1Z5',
  internalDate: '2026-10-09',
  statutoryDate: '2026-10-11',
});
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
const gst = item({
  key: 'task:t1',
  title: 'GSTR-1 · Sep 2026',
  filing: filing('i1'),
  internalDate: '2026-10-09',
  statutoryDate: '2026-10-11',
  isOverdue: true,
  task: {
    id: 't1',
    title: 'Prepare GSTR-1',
    status: 'todo',
    version: 2,
    assignedToId: 'me',
    assignedToName: 'Senior Y',
    reviewerId: 'mx',
    reviewerName: 'Manager X',
    sentForReviewAt: null,
    reviewStartedAt: null,
  },
  link: {
    engagementId: 'e1',
    engagementKind: 'compliance',
    instanceId: 'i1',
    stream: 'gst',
    financialYear: '2026-27',
    periodKey: '2026-09',
    section: 'outward',
    taskId: 't1',
  },
});
const call = item({
  key: 'task:t2',
  title: 'Call the client',
  task: { ...gst.task!, id: 't2', title: 'Call the client' },
  link: { engagementId: 'e1', engagementKind: 'compliance', taskId: 't2' },
});
const request = item({
  key: 'client_request:r1',
  kind: 'client_request',
  group: 'waiting',
  title: 'Bank statement',
  status: 'pending',
  link: { engagementId: 'e1', engagementKind: 'compliance', requestId: 'r1' },
});
const view: TodayView = {
  today: '2026-10-14',
  groups: [
    { group: 'prepare', items: [gst, call], total: 2 },
    { group: 'review', items: [], total: 0 },
    { group: 'waiting', items: [request], total: 1 },
    { group: 'due_soon', items: [], total: 0 },
  ],
};

function renderPage(): void {
  apiFetch.mockImplementation((url: string) =>
    Promise.resolve(url === '/work/today' ? view : null),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TodayPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  search = new URLSearchParams();
  replace.mockClear();
  push.mockClear();
  apiFetch.mockReset();
  flagOn = true;
  runsOn = false;
});

describe('Today page (WF-201)', () => {
  it('shows the four groups with counts and the top item actionable in one click', async () => {
    renderPage();
    const prepare = await screen.findByRole('region', { name: /To prepare/ });
    expect(within(prepare).getByText('2')).toBeTruthy();
    expect(screen.getByRole('region', { name: /To review/ })).toBeTruthy();
    expect(screen.getByText('Nothing waiting for your review.')).toBeTruthy();
    const first = within(prepare).getAllByRole('listitem')[0]!;
    expect(within(first).getByText('GSTR-1 · Sep 2026')).toBeTruthy();
    expect(within(first).getByTitle('Internal due date').className).toContain('text-danger-600');
    // The main move only: Start work, not Cancel.
    expect(within(first).getByRole('button', { name: 'Start work' })).toBeTruthy();
    expect(within(first).queryByRole('button', { name: /Cancel/ })).toBeNull();
  });

  it('a plain click on a filing opens the drawer; the link still points at the filing', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'GSTR-1 · Sep 2026' });
    expect(link.getAttribute('href')).toContain('/engagements/e1?');
    fireEvent.click(link);
    expect(replace).toHaveBeenCalledWith('/today?open=i1', { scroll: false });
    expect(push).not.toHaveBeenCalled();
  });

  it('j / k move the selection and Enter opens it — a filing in the drawer, else its page', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'GSTR-1 · Sep 2026' });
    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getAllByRole('listitem')[0]!.getAttribute('aria-current')).toBe('true');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(replace).toHaveBeenLastCalledWith('/today?open=i1', { scroll: false });
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/engagements/e1?tab=services&task=t2');
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getAllByRole('listitem')[0]!.getAttribute('aria-current')).toBe('true');
  });

  it('the drawer walks the filings on the list', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'GSTR-1 · Sep 2026' });
    expect(screen.getByTestId('drawer').textContent).toBe('i1');
  });

  it('a filing waiting on the client offers Remind client right on the row (WF-302)', async () => {
    runsOn = true;
    const chase = item({
      key: 'task:t3',
      group: 'waiting',
      title: 'GSTR-3B · Sep 2026',
      status: 'blocked',
      filing: filing('i9'),
      link: { engagementId: 'e1', engagementKind: 'compliance', instanceId: 'i9', taskId: 't3' },
    });
    apiFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/work/today'
          ? { ...view, groups: [{ group: 'waiting', items: [chase, request], total: 2 }] }
          : url.endsWith('/client-chase/remind')
            ? { channel: 'copy', text: 'Please send the purchase register.', raised: 0 }
            : null,
      ),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TodayPage />
      </QueryClientProvider>,
    );
    const waiting = await screen.findByRole('region', { name: /Waiting on client/ });
    // Only the row on a filing can be reminded from here; a bare request opens its page.
    expect(within(waiting).getAllByRole('button', { name: 'Remind client' })).toHaveLength(1);
    fireEvent.click(within(waiting).getByRole('button', { name: 'Remind client' }));
    expect(await screen.findByDisplayValue('Please send the purchase register.')).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith('/compliance-instances/i9/client-chase/remind', {
      method: 'POST',
    });
  });

  it('Remind client stays hidden with ff_filing_runs off', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'GSTR-1 · Sep 2026' });
    expect(screen.queryByRole('button', { name: 'Remind client' })).toBeNull();
  });

  it('with ff_today_view off it points to My Work and asks for nothing', () => {
    flagOn = false;
    renderPage();
    expect(screen.getByText(/isn.t switched on/)).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalledWith('/work/today');
  });
});

describe('today-model', () => {
  it('rows run group by group; the drawer lists each filing once', () => {
    expect(todayRows(view).map((i) => i.key)).toEqual(['task:t1', 'task:t2', 'client_request:r1']);
    expect(todayRows(undefined)).toEqual([]);
    const twice = [gst, { ...gst, key: 'filing:i1' }, call];
    expect(todayDrawerItems(twice, () => '/x')).toEqual([
      { instanceId: 'i1', title: 'GSTR-1 · Sep 2026 · Bharat Textiles', href: '/x' },
    ]);
  });

  it('the context line names the client and the filing, else the engagement', () => {
    expect(todayContextLine(gst)).toBe('Bharat Textiles · GSTR-1 · Sep 2026 · 19AAACB1234C1Z5');
    expect(todayContextLine(call)).toBe('Bharat Textiles · ENG-1');
  });

  it('the task the action buttons need, or none', () => {
    expect(todayWorkTask(gst)).toMatchObject({
      id: 't1',
      engagementId: 'e1',
      status: 'todo',
      version: 2,
      assignedToId: 'me',
      reviewerId: 'mx',
      complianceInstanceId: 'i1',
      stream: 'gst',
    });
    expect(todayWorkTask(request)).toBeNull();
  });

  it('stepSelection clamps to the list', () => {
    expect(stepSelection(-1, 1, 3)).toBe(0);
    expect(stepSelection(0, -1, 3)).toBe(0);
    expect(stepSelection(2, 1, 3)).toBe(2);
    expect(stepSelection(1, 1, 3)).toBe(2);
    expect(stepSelection(0, 1, 0)).toBe(-1);
  });
});
