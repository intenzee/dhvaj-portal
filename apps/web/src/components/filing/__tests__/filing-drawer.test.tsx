import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ActiveTimer } from '@hsdg/contracts';
import {
  drawerItemsFrom,
  drawerNeighbours,
  FilingDrawer,
  workspaceTitle,
  type DrawerItem,
} from '../filing-drawer';
import { clockIsOn } from '../filing-clock';

let search = new URLSearchParams();
const replace = jest.fn((url: string) => {
  search = new URLSearchParams(url.split('?')[1] ?? '');
});
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace }),
  usePathname: () => '/today',
  useSearchParams: () => search,
}));
const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ principal: { employeeId: 'me', roles: [] } }),
}));
jest.mock('../instance-workspace', () => ({
  workspaceKey: (id: string) => ['filing', 'instance', id],
  InstanceWorkspace: ({ instanceId, ctx }: { instanceId: string; ctx: { isLead: boolean } }) => (
    <div data-testid="workspace">
      {instanceId} lead={String(ctx.isLead)}
    </div>
  ),
}));

const items: DrawerItem[] = [
  { instanceId: 'i1', title: 'GSTR-1 · Sep 2026', href: '/engagements/e1?tab=gst&m=9' },
  { instanceId: 'i2', title: 'GSTR-3B · Sep 2026' },
  { instanceId: 'i3', title: 'TDS · Q2' },
];

function renderDrawer(): ReturnType<typeof render> {
  apiFetch.mockImplementation((url: string) => {
    if (url === '/engagements/time/active') return Promise.resolve(null);
    if (url.startsWith('/compliance-instances/'))
      return Promise.resolve({ instance: { engagementId: 'e1' } });
    return Promise.resolve({ engagementPartnerId: 'me', engagementManagerId: null, team: [] });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FilingDrawer items={items} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  search = new URLSearchParams();
  replace.mockClear();
  apiFetch.mockReset();
});

describe('drawerNeighbours', () => {
  it('walks the list from the open filing', () => {
    expect(drawerNeighbours(items, 'i2')).toEqual({ index: 1, prev: items[0], next: items[2] });
    expect(drawerNeighbours(items, 'i1')).toMatchObject({ index: 0, prev: null, next: items[1] });
    expect(drawerNeighbours(items, 'i3')).toMatchObject({ index: 2, prev: items[1], next: null });
  });

  it('a filing not in the list (or none) has no neighbours', () => {
    expect(drawerNeighbours(items, 'gone')).toEqual({ index: -1, prev: null, next: null });
    expect(drawerNeighbours(items, null)).toEqual({ index: -1, prev: null, next: null });
  });
});

describe('drawerItemsFrom', () => {
  it('keeps each filing once, in list order, and skips rows with none', () => {
    const link = (instanceId?: string) => ({
      engagementId: 'e1',
      engagementKind: 'compliance' as const,
      ...(instanceId ? { instanceId } : {}),
    });
    const rows = [
      { t: 'a', link: link('i2') },
      { t: 'b', link: link() },
      { t: 'c', link: link('i1') },
      { t: 'd', link: link('i2') },
      { t: 'e', link: null },
    ];
    expect(
      drawerItemsFrom(
        rows,
        (r) => r.t,
        (r) => `/x/${r.t}`,
      ),
    ).toEqual([
      { instanceId: 'i2', title: 'a', href: '/x/a' },
      { instanceId: 'i1', title: 'c', href: '/x/c' },
    ]);
  });
});

describe('FilingDrawer (WF-202)', () => {
  it('renders nothing without ?open=', () => {
    renderDrawer();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the open filing, with my lead context from its engagement', async () => {
    search = new URLSearchParams('open=i1');
    renderDrawer();
    expect(screen.getByRole('heading', { name: 'GSTR-1 · Sep 2026' })).toBeTruthy();
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect((await screen.findByTestId('workspace')).textContent).toBe('i1 lead=true');
    expect(screen.getByRole('link', { name: 'Open in engagement' }).getAttribute('href')).toBe(
      '/engagements/e1?tab=gst&m=9',
    );
    expect(document.activeElement).toBe(screen.getByRole('heading'));
  });

  it('Next / Previous move ?open= along the list, keeping the rest of the URL', () => {
    search = new URLSearchParams('tab=tasks&open=i2');
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Next filing' }));
    expect(replace).toHaveBeenLastCalledWith('/today?tab=tasks&open=i3', { scroll: false });
    fireEvent.click(screen.getByRole('button', { name: 'Previous filing' }));
    expect(replace).toHaveBeenLastCalledWith('/today?tab=tasks&open=i1', { scroll: false });
  });

  it('Esc closes, unless it is typed in a field', async () => {
    search = new URLSearchParams('open=i1');
    renderDrawer();
    await screen.findByTestId('workspace');
    const field = document.createElement('input');
    document.body.appendChild(field);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(replace).not.toHaveBeenCalled();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/today', { scroll: false }));
    field.remove();
  });
});

describe('workspaceTitle', () => {
  const ws = (i: object) =>
    ({
      instance: { formLabel: 'GSTR-1', ruleName: 'GSTR-1 (monthly)', periodKey: '2026-09', ...i },
    }) as never;
  it('names a filing that has left the list by form and period', () => {
    expect(workspaceTitle(ws({}))).toBe('GSTR-1 · Sep 2026');
    expect(workspaceTitle(ws({ formLabel: null }))).toBe('GSTR-1 (monthly) · Sep 2026');
    expect(workspaceTitle(ws({ periodKey: null }))).toBe('GSTR-1');
  });
});

describe('clockIsOn (WF-205)', () => {
  const timer = (instanceId?: string) =>
    ({ link: { engagementId: 'e1', engagementKind: 'compliance', instanceId } }) as ActiveTimer;
  it('only when the running clock is on this filing', () => {
    expect(clockIsOn(timer('i1'), 'i1')).toBe(true);
    expect(clockIsOn(timer('i2'), 'i1')).toBe(false);
    expect(clockIsOn(timer(undefined), 'i1')).toBe(false);
    expect(clockIsOn(null, 'i1')).toBe(false);
  });
});
