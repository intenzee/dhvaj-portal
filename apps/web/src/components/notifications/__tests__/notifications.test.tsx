import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NotificationDigest, NotificationItem, NotificationPreference } from '@hsdg/contracts';
import NotificationsPage from '@/app/(portal)/notifications/page';
import {
  istDay,
  listPath,
  notificationHref,
  notificationTabs,
  shiftDay,
  tabFrom,
} from '../notifications-model';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));
let flagOn = true;
jest.mock('@/lib/feature-flags', () => ({
  useFeatureFlags: () => ({ isOn: () => flagOn, isLoading: false, flags: {} }),
}));
const push = jest.fn();
let query = '';
const replace = jest.fn((href: string) => {
  query = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
});
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/notifications',
  useSearchParams: () => new URLSearchParams(query),
}));

const LINK = {
  engagementId: 'e1',
  engagementKind: 'compliance' as const,
  instanceId: 'i1',
  stream: 'gst' as const,
  financialYear: '2026-27',
  periodKey: '2026-09',
  section: 'outward' as const,
  taskId: 't1',
};
const note = (over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'n1',
  type: 'task_review_requested',
  kind: 'actionable',
  title: 'Review requested: GSTR-1 Sep',
  body: null,
  engagementId: 'e1',
  objectType: 'task',
  objectId: 't1',
  link: LINK,
  status: 'unread',
  readAt: null,
  resolvedAt: null,
  createdAt: '2026-10-14T05:00:00Z',
  ...over,
});

describe('notifications model (WF-305)', () => {
  it('leads with what needs action once it is on; keeps all/unread otherwise', () => {
    expect(notificationTabs(true).map((t) => t.key)).toEqual([
      'action',
      'digest',
      'all',
      'settings',
    ]);
    expect(notificationTabs(false).map((t) => t.key)).toEqual(['all', 'unread']);
    expect(tabFrom(null, true)).toBe('action');
    expect(tabFrom('digest', false)).toBe('all');
    expect(listPath('action')).toContain('unreadOnly=true');
    expect(listPath('all')).toContain('scope=all');
  });

  it('opens the stored link, else the engagement, else nothing', () => {
    expect(notificationHref(note())).toBe(
      '/engagements/e1?tab=gst&fy=2026-27&m=9&part=outward&task=t1',
    );
    expect(notificationHref(note({ link: null }))).toBe('/engagements/e1');
    expect(notificationHref(note({ link: null, engagementId: null }))).toBeNull();
  });

  it('counts days in IST', () => {
    expect(istDay(new Date('2026-10-13T19:00:00Z'))).toBe('2026-10-14');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('Notifications page', () => {
  const renderPage = () =>
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <NotificationsPage />
      </QueryClientProvider>,
    );

  beforeEach(() => {
    apiFetch.mockReset();
    push.mockReset();
    replace.mockClear();
    query = '';
    flagOn = true;
  });

  it('lists what needs action and opens the filing section', async () => {
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith('/notifications?') ? { items: [note()], total: 1 } : {}),
    );
    renderPage();
    fireEvent.click(await screen.findByText('Review requested: GSTR-1 Sep'));
    expect(apiFetch).toHaveBeenCalledWith('/notifications?limit=100&unreadOnly=true');
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/notifications/n1/read', { method: 'POST' }),
    );
    expect(push).toHaveBeenCalledWith(
      '/engagements/e1?tab=gst&fy=2026-27&m=9&part=outward&task=t1',
    );
    expect(screen.getByRole('tab', { name: 'Needs action' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('shows a done badge on a notification cleared by the work', async () => {
    apiFetch.mockResolvedValue({
      items: [note({ status: 'read', resolvedAt: '2026-10-14T06:00:00Z' })],
      total: 1,
    });
    query = 'tab=all';
    renderPage();
    expect(await screen.findByText('Done')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/notifications?limit=100&scope=all');
  });

  it('the digest groups the day’s updates by type', async () => {
    const digest: NotificationDigest = {
      date: istDay(),
      total: 1,
      groups: [
        {
          type: 'filing_lodged',
          label: 'Filing lodged',
          items: [
            note({
              id: 'n2',
              type: 'filing_lodged',
              kind: 'informational',
              title: 'GSTR-1 lodged',
            }),
          ],
        },
      ],
    };
    apiFetch.mockResolvedValue(digest);
    query = 'tab=digest';
    renderPage();
    const group = await screen.findByRole('region', { name: 'Filing lodged' });
    expect(within(group).getByText('GSTR-1 lodged')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(`/notifications/digest?date=${istDay()}`);
  });

  it('settings move an update to the bell; actions are fixed', async () => {
    const prefs: NotificationPreference[] = [
      {
        type: 'filing_lodged',
        label: 'Filing lodged',
        kind: 'informational',
        delivery: 'digest',
        editable: true,
      },
      {
        type: 'task_returned',
        label: 'Returned with review points',
        kind: 'actionable',
        delivery: 'bell',
        editable: false,
      },
    ];
    apiFetch.mockResolvedValue(prefs);
    query = 'tab=settings';
    renderPage();
    fireEvent.change(await screen.findByLabelText('Filing lodged'), { target: { value: 'bell' } });
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/notifications/preferences', {
        method: 'PUT',
        body: { items: [{ type: 'filing_lodged', delivery: 'bell' }] },
      }),
    );
    expect(screen.queryByLabelText('Returned with review points')).toBeNull();
    expect(screen.getByText('Returned with review points')).toBeInTheDocument();
  });

  it('without the flag it is the old all/unread list', async () => {
    flagOn = false;
    apiFetch.mockResolvedValue({ items: [], total: 0 });
    renderPage();
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Daily digest' })).toBeNull();
  });
});
