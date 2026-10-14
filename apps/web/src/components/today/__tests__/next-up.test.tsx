import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TodayItem, TodayView } from '@hsdg/contracts';
import { NextUpStrip, nextUp } from '../next-up';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
jest.mock('@/lib/feature-flags', () => ({
  useFeatureFlags: () => ({ isOn: () => true, isLoading: false, flags: {} }),
}));

const item = (key: string, over: Partial<TodayItem> = {}): TodayItem => ({
  key,
  kind: 'task',
  group: 'prepare',
  title: key,
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
  link: { engagementId: 'e1', engagementKind: 'compliance', taskId: key },
  ...over,
});
const view = (prepare: TodayItem[], review: TodayItem[] = []): TodayView => ({
  today: '2026-10-14',
  groups: [
    { group: 'prepare', items: prepare, total: prepare.length },
    { group: 'review', items: review, total: review.length },
    { group: 'waiting', items: [], total: 0 },
    { group: 'due_soon', items: [], total: 0 },
  ],
});

function renderStrip(v: TodayView): ReturnType<typeof render> {
  apiFetch.mockResolvedValue(v);
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextUpStrip engagementId="e1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => apiFetch.mockReset());

describe('Next up for you (WF-204)', () => {
  it('shows my next three items as links to the work, asking for this engagement only', async () => {
    renderStrip(
      view(
        [
          item('t-later', { internalDate: '2026-10-25' }),
          item('t-soon', { internalDate: '2026-10-16' }),
          item('t-undated'),
        ],
        [item('t-late', { group: 'review', internalDate: '2026-10-10', isOverdue: true })],
      ),
    );
    const nav = await screen.findByRole('navigation', { name: 'Next up for you' });
    const links = nav.querySelectorAll('a');
    expect([...links].map((a) => a.querySelector('span')?.textContent)).toEqual([
      't-late',
      't-soon',
      't-later',
    ]);
    expect(links[0]!.getAttribute('href')).toBe('/engagements/e1?tab=services&task=t-late');
    expect(apiFetch).toHaveBeenCalledWith('/work/today?engagementId=e1');
  });

  it('is hidden when I have nothing on the engagement', async () => {
    const { container } = renderStrip(view([]));
    await new Promise((r) => setTimeout(r, 0));
    expect(apiFetch).toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });

  it('nextUp takes at most three, overdue first', () => {
    const v = view([item('a'), item('b'), item('c'), item('d', { isOverdue: true })]);
    expect(nextUp(v).map((i) => i.key)).toEqual(['d', 'a', 'b']);
    expect(nextUp(undefined)).toEqual([]);
  });
});
