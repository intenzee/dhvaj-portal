import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { WorkTask } from '@/lib/work-types';
import { pausedByStart, TaskActions } from '../task-actions';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));

const task: WorkTask = {
  id: 't1',
  engagementId: 'e1',
  title: 'GSTR-1 · Sep 2026',
  description: null,
  status: 'in_review',
  priority: 'normal',
  dueDate: null,
  isOverdue: false,
  blockedByOpenCount: 0,
  assignedToId: 'prep',
  assignedToName: 'Senior Y',
  engagementServiceId: null,
  stream: 'gst',
  reviewerId: 'me',
  reviewerName: 'Manager X',
  workType: 'filing',
  complianceInstanceId: 'i1',
  sentForReviewAt: '2026-10-14T05:00:00Z',
  reviewStartedAt: null,
  version: 3,
};

/** A list on screen under ['work', …], refetched after every move. */
let resolveRefetch: (() => void) | null = null;
function Queue(): JSX.Element {
  useQuery({
    queryKey: ['work', 'reviews'],
    queryFn: () => new Promise<number>((r) => (resolveRefetch = () => r(1))),
  });
  return <TaskActions task={task} ctx={{ me: 'me', isLead: false }} />;
}

describe('TaskActions', () => {
  it('stays disabled until the lists refetch the new version (no stale second click)', async () => {
    apiFetch.mockResolvedValue({});
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Queue />
      </QueryClientProvider>,
    );
    await act(async () => resolveRefetch?.()); // the first load
    const start = screen.getByRole('button', { name: 'Start review' });
    fireEvent.click(start);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(apiFetch.mock.calls[0]![1]).toMatchObject({ body: { version: 3 } });

    // The move succeeded; the queue is refetching: still disabled.
    await waitFor(() => expect(resolveRefetch).not.toBeNull());
    expect(screen.getByRole('button', { name: 'Start review' })).toBeDisabled();
    await act(async () => resolveRefetch?.());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Start review' })).not.toBeDisabled(),
    );
  });
});

describe('pausedByStart (WF-205)', () => {
  const running = (taskId: string | null, taskTitle: string | null) =>
    ({
      entry: { taskId, taskTitle },
      engagementCode: 'ENG-7',
      entityName: 'Bharat Textiles',
    }) as unknown as import('@hsdg/contracts').ActiveTimer;

  it('names the other task a start paused', () => {
    expect(pausedByStart('start', 't1', running('t9', 'TDS Q2'))).toBe('TDS Q2');
    expect(pausedByStart('start-review', 't1', running(null, null))).toBe('ENG-7');
  });

  it('is silent with no clock, the same task, or an action that opens none', () => {
    expect(pausedByStart('start', 't1', null)).toBeNull();
    expect(pausedByStart('start', 't1', running('t1', 'GSTR-1'))).toBeNull();
    expect(pausedByStart('send-for-review', 't1', running('t9', 'TDS Q2'))).toBeNull();
  });
});
