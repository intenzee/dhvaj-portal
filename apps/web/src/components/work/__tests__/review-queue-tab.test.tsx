import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { FilingReviewItem, WorkReviewItem, WorkReviewQueue } from '@hsdg/contracts';
import { ReviewQueueTab, reviewFilterOf, reviewTask } from '../review-queue-tab';
import { FoldedRoute, foldedTarget } from '../folded-route';
import { NavCount } from '@/components/nav-count';

const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace }),
  usePathname: () => '/my-work',
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: { employeeId: 'me' } }) }));
jest.mock('@/components/tasks/task-actions', () => ({
  TaskActions: ({ task }: { task: { id: string; version: number } }) => (
    <span>{`actions:${task.id}@${task.version}`}</span>
  ),
}));
const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({ apiFetch: (path: string) => apiFetch(path) }));
let flags: Record<string, boolean> = {};
jest.mock('@/lib/feature-flags', () => ({
  useFeatureFlags: () => ({ isOn: (f: string) => flags[f] === true, isLoading: false }),
}));

const base = {
  engagementId: 'eng-1',
  engagementCode: 'GST-26-001',
  engagementKind: 'compliance' as const,
  entityName: 'Acme Ltd',
  daysWaiting: 4,
};
const filing: FilingReviewItem = {
  ...base,
  id: 't1',
  type: 'filing_review',
  title: 'GSTR-3B · Sep 2026',
  waitingSince: '2026-10-10T05:00:00.000Z',
  taskId: 't1',
  preparerId: 'p1',
  preparerName: 'Senior Y',
  dueDate: '2026-10-18',
  internalDate: '2026-10-17',
  statutoryDate: '2026-10-20',
  reviewStarted: false,
  reviewStartedAt: null,
  taskVersion: 3,
  filing: null,
  link: { engagementId: 'eng-1', engagementKind: 'compliance', taskId: 't1', stream: 'gst' },
};
const point: WorkReviewItem = {
  ...base,
  id: 'rp1',
  type: 'review_point',
  title: 'Reconcile ITC',
  waitingSince: '2026-10-12T05:00:00.000Z',
  daysWaiting: 2,
  reviewPointId: 'rp1',
  raisedById: 'x',
  raisedByName: 'Manager X',
  isKeyMatter: true,
  link: { engagementId: 'eng-1', engagementKind: 'compliance' },
};

function wrap(ui: ReactNode): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  apiFetch.mockReset();
  replace.mockReset();
  flags = {};
});

describe('reviewFilterOf', () => {
  it('maps old /reviews filters and the item types', () => {
    expect(reviewFilterOf('signoff')).toBe('sign_off');
    expect(reviewFilterOf('high-risk')).toBe('review_point');
    expect(reviewFilterOf('review')).toBe('review_point');
    expect(reviewFilterOf('filing_review')).toBe('filing_review');
    expect(reviewFilterOf(null)).toBe('all');
    expect(reviewFilterOf('nonsense')).toBe('all');
  });
});

describe('reviewTask', () => {
  it('is an in-review task with me as reviewer and the preparer as assignee', () => {
    const t = reviewTask(filing, 'me');
    expect(t).toMatchObject({
      id: 't1',
      status: 'in_review',
      reviewerId: 'me',
      assignedToId: 'p1',
      reviewStartedAt: null,
      version: 3,
    });
    expect(reviewTask({ ...filing, reviewStarted: true }, 'me').reviewStartedAt).not.toBeNull();
  });
});

describe('ReviewQueueTab', () => {
  it('lists every item, acts on filings only, and filters by type', async () => {
    const queue: WorkReviewQueue = { items: [filing, point], total: 2 };
    apiFetch.mockResolvedValue(queue);
    render(wrap(<ReviewQueueTab initialFilter="all" />));

    expect(await screen.findByText('GSTR-3B · Sep 2026')).toBeInTheDocument();
    expect(screen.getByText('Reconcile ITC')).toBeInTheDocument();
    expect(screen.getByText('Key matter')).toBeInTheDocument();
    expect(screen.getAllByText(/^actions:/)).toHaveLength(1);
    expect(screen.getByText('actions:t1@3')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/work/reviews');

    fireEvent.click(screen.getByRole('button', { name: 'Review points (1)' }));
    expect(screen.queryByText('GSTR-3B · Sep 2026')).not.toBeInTheDocument();
    expect(screen.getByText('Reconcile ITC')).toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    apiFetch.mockResolvedValue({ items: [], total: 0 });
    render(wrap(<ReviewQueueTab initialFilter="all" />));
    expect(await screen.findByText('Nothing is waiting for your review.')).toBeInTheDocument();
  });
});

describe('foldedTarget', () => {
  it('sends a folded route to its My Work tab, keeping the link’s query', () => {
    expect(foldedTarget('/tasks', '')).toBe('/my-work?tab=tasks');
    expect(foldedTarget('/client-dependencies', '')).toBe('/my-work?tab=client-dependencies');
    expect(foldedTarget('/reviews', '?filter=signoff')).toBe(
      '/my-work?filter=signoff&tab=to-review',
    );
    expect(foldedTarget('/reviews', '?tab=x')).toBe('/my-work?tab=to-review');
    expect(foldedTarget('/engagements', '')).toBeNull();
  });
});

describe('FoldedRoute', () => {
  it('renders the old page with ff_work_links off', () => {
    render(wrap(<FoldedRoute from="/tasks">old tasks page</FoldedRoute>));
    expect(screen.getByText('old tasks page')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects to My Work with ff_work_links on', () => {
    flags = { ff_work_links: true };
    render(wrap(<FoldedRoute from="/tasks">old tasks page</FoldedRoute>));
    expect(screen.queryByText('old tasks page')).not.toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith('/my-work?tab=tasks');
  });
});

describe('NavCount', () => {
  const badge = { queryKey: ['work', 'reviews', 'count'], path: '/work/reviews/count' };

  it('shows the count, capped at 99+', async () => {
    apiFetch.mockResolvedValue({ total: 120 });
    render(wrap(<NavCount badge={badge} />));
    expect(await screen.findByText('99+')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/work/reviews/count');
  });

  it('is hidden at zero', async () => {
    apiFetch.mockResolvedValue({ total: 0 });
    const { container } = render(wrap(<NavCount badge={badge} />));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
