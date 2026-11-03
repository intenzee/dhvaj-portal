import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MyTask } from '@/lib/types';
import {
  addDays,
  ArticleWork,
  asWorkTask,
  groupMyWork,
  groupOf,
  MY_WORK_GROUPS,
  nextStepOf,
} from '../article-work';
import { MySetsList, sortSets, type MyWorkSet } from '../my-sets';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
jest.mock('@/lib/firm-checks', () => ({ useFirmChecks: () => ({}) }));

const TODAY = '2026-10-14';
const ME = 'article-1';
const task = (over: Partial<MyTask>): MyTask => ({
  id: 't1',
  engagementId: 'e1',
  title: 'Prepare GSTR-1',
  status: 'todo',
  priority: 'normal',
  dueDate: TODAY,
  isOverdue: false,
  blockedByOpenCount: 0,
  version: 1,
  engagementCode: 'ENG-1',
  entityName: 'Bharat Textiles',
  assignedToId: ME,
  assignedById: 'senior-1',
  assignedByName: 'Arjun Senior',
  ...over,
});

function renderWork(tasks: MyTask[]) {
  const onDocuments = jest.fn();
  const onOpen = jest.fn(() => true);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ArticleWork
        tasks={tasks}
        today={TODAY}
        me={ME}
        hrefOf={(t) => `/engagements/${t.engagementId}?task=${t.id}`}
        onOpen={onOpen}
        onDocuments={onDocuments}
      />
    </QueryClientProvider>,
  );
  return { onDocuments, onOpen };
}

describe('grouping (C-5)', () => {
  it('puts each task in Overdue / Today / This week / Later', () => {
    expect(groupOf({ dueDate: '2026-10-13' }, TODAY)).toBe('overdue');
    expect(groupOf({ dueDate: TODAY }, TODAY)).toBe('today');
    expect(groupOf({ dueDate: '2026-10-20' }, TODAY)).toBe('week');
    expect(groupOf({ dueDate: '2026-10-21' }, TODAY)).toBe('later');
    expect(groupOf({ dueDate: null }, TODAY)).toBe('later');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('keeps open work only, soonest first, undated last', () => {
    const g = groupMyWork(
      [
        task({ id: 'a', dueDate: null }),
        task({ id: 'b', dueDate: '2026-11-30' }),
        task({ id: 'c', dueDate: '2026-10-01', status: 'done' }),
        task({ id: 'd', dueDate: '2026-10-02' }),
        task({ id: 'e', dueDate: '2026-10-10', status: 'cancelled' }),
      ],
      TODAY,
    );
    expect(MY_WORK_GROUPS.map((k) => g[k].map((t) => t.id))).toEqual([['d'], [], [], ['b', 'a']]);
  });

  it('offers Start until the work is started, then Send for review', () => {
    expect(nextStepOf('todo')).toBe('start');
    expect(nextStepOf('paused')).toBe('start');
    expect(nextStepOf('in_progress')).toBe('send-for-review');
  });

  it('lets the giver stand in for an unset reviewer, so no reviewer is asked for', () => {
    expect(asWorkTask(task({}), ME)).toMatchObject({ reviewerId: 'senior-1', assignedToId: ME });
    expect(asWorkTask(task({ reviewerId: 'mgr' }), ME).reviewerId).toBe('mgr');
  });
});

describe('<ArticleWork />', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    toast.mockReset();
  });

  it('shows the groups that have work, with one next step per row', () => {
    renderWork([
      task({ id: 'late', title: 'Late one', dueDate: '2026-10-10' }),
      task({ id: 'going', title: 'Going one', status: 'in_progress', dueDate: '2026-10-18' }),
      task({ id: 'review', title: 'Under review', status: 'in_review', reviewerName: 'Arjun' }),
    ]);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('This week')).toBeInTheDocument();
    expect(screen.queryByText('Later')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start work' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send for review' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(screen.getByText('With Arjun for review')).toBeInTheDocument();
  });

  it('Start moves the task through the transition route', async () => {
    apiFetch.mockResolvedValue({});
    renderWork([task({ id: 't9', version: 4 })]);
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/tasks/t9/start', {
        method: 'POST',
        body: { version: 4 },
      }),
    );
  });

  it('opens under the row: documents, the checklist and Ask <giver>', async () => {
    apiFetch.mockResolvedValue({});
    const { onDocuments, onOpen } = renderWork([task({ complianceInstanceId: 'i1' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Open Prepare GSTR-1' }));
    fireEvent.click(screen.getByRole('button', { name: /Client documents/ }));
    expect(onDocuments).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Checklist/ }));
    expect(onOpen).toHaveBeenCalled();

    const ask = screen.getByRole('button', { name: 'Ask Arjun' });
    expect(ask).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Question for Arjun Senior'), {
      target: { value: 'Which invoices are in?' },
    });
    fireEvent.click(ask);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/tasks/t1/ask', {
        method: 'POST',
        body: { question: 'Which invoices are in?' },
      }),
    );
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Sent to Arjun Senior.'));
  });

  it('hides Ask when nobody gave the task, and the checklist without a filing', () => {
    renderWork([task({ assignedById: null, assignedByName: null })]);
    fireEvent.click(screen.getByRole('button', { name: 'Open Prepare GSTR-1' }));
    expect(screen.queryByRole('button', { name: /^Ask/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Checklist/ })).not.toBeInTheDocument();
  });

  it('says so when nothing is open', () => {
    renderWork([task({ status: 'done' })]);
    expect(screen.getByText('No open tasks assigned to you.')).toBeInTheDocument();
  });
});

describe('My sets', () => {
  const set = (over: Partial<MyWorkSet>): MyWorkSet => ({
    id: 's1',
    name: 'GSTR-1 Oct 2026',
    assignedToId: ME,
    assignedToName: 'Article',
    assignedById: 'm1',
    assignedByName: 'Manager X',
    dueDate: '2026-10-20',
    note: null,
    taskCount: 4,
    openCount: 3,
    doneCount: 1,
    createdAt: '2026-10-01T00:00:00Z',
    closedAt: null,
    ...over,
  });

  it('lists open sets first, soonest due first', () => {
    const sorted = sortSets([
      set({ id: 'closed', closedAt: '2026-10-05T00:00:00Z', dueDate: '2026-10-01' }),
      set({ id: 'late', dueDate: '2026-10-30' }),
      set({ id: 'soon', dueDate: '2026-10-16' }),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(['soon', 'late', 'closed']);
  });

  it('renders a set with who gave it, or nothing when there are none', () => {
    const { container, rerender } = render(<MySetsList sets={[set({})]} />);
    expect(screen.getByText('GSTR-1 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText(/From Manager X/)).toBeInTheDocument();
    rerender(<MySetsList sets={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
