import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AssignableTask, WorkSetDetail, WorkSetSummary } from '@hsdg/contracts';
import { AssignWorkScreen, filingOf, openTasksPath } from '../assign-work';
import { WorkSetDetailScreen } from '../work-set-detail';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

jest.setTimeout(20_000);

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const task = (over: Partial<AssignableTask>): AssignableTask => ({
  id: 't1',
  title: 'Prepare GSTR-1 · Oct 2026',
  status: 'todo',
  dueDate: '2026-11-09',
  engagementId: 'g1',
  engagementCode: 'ENG-001',
  entityId: 'c1',
  entityName: 'Acme Traders',
  officeId: null,
  officeCode: null,
  instanceId: 'i1',
  stream: 'gst',
  formLabel: 'GSTR-1',
  periodKey: '2026-10',
  assignedToId: 'm',
  assignedToName: 'Meera Rao',
  reviewerId: null,
  reviewerName: null,
  workSetId: null,
  workSetName: null,
  movable: true,
  ...over,
});

const summary: WorkSetSummary = {
  id: 's1',
  name: 'GSTR-1 Oct 2026 — Arjun',
  assignedToId: 'a',
  assignedToName: 'Arjun Mehta',
  assignedById: 'm',
  assignedByName: 'Meera Rao',
  dueDate: '2026-11-09',
  note: null,
  taskCount: 2,
  openCount: 2,
  doneCount: 0,
  createdAt: '2026-11-03T10:00:00Z',
  closedAt: null,
};

describe('work set helpers', () => {
  it('builds the open-tasks path from the filters it was given', () => {
    expect(openTasksPath({})).toBe('/work-sets/open-tasks');
    expect(openTasksPath({ stream: 'gst', form: '', period: '2026-10', dueWithinDays: 0 })).toBe(
      '/work-sets/open-tasks?stream=gst&period=2026-10&dueWithinDays=0',
    );
  });

  it('names a task’s filing by form and period', () => {
    expect(filingOf({ formLabel: 'GSTR-1', periodKey: '2026-10' })).toBe('GSTR-1 · Oct 2026');
    expect(filingOf({ formLabel: 'ITR', periodKey: '2026-27' })).toBe('ITR · FY 2026-27');
    expect(filingOf({ formLabel: null, periodKey: null })).toBeNull();
  });
});

describe('AssignWorkScreen', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    toast.mockReset();
    push.mockReset();
  });

  it('gives the ticked tasks to the picked person and opens the set', async () => {
    const busy = task({ id: 't3', status: 'in_progress', movable: false, entityName: 'Busy Co' });
    apiFetch.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
      if (path === '/work-sets/people') {
        return Promise.resolve([{ id: 'a', fullName: 'Arjun Mehta', gradeName: 'Senior' }]);
      }
      if (path.startsWith('/work-sets/open-tasks')) {
        return Promise.resolve([task({}), task({ id: 't2', entityName: 'Bharat Steel' }), busy]);
      }
      if (path.startsWith('/work-sets?mine=')) return Promise.resolve([]);
      if (path === '/work-sets' && init?.method === 'POST') {
        return Promise.resolve({ ...summary, tasks: [], canSplit: true });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    const user = userEvent.setup();
    render(wrap(<AssignWorkScreen />));

    await screen.findByText('Bharat Steel');
    const give = screen.getByRole('button', { name: 'Give' });
    expect(give).toBeDisabled();
    // A task someone is working on stays with them.
    expect(screen.getAllByRole('checkbox', { name: /Tick Prepare/ })[2]!).toBeDisabled();

    await user.click(
      screen.getByRole('checkbox', { name: 'Tick every task that can be handed on' }),
    );
    expect(screen.getByText('2 tasks ticked')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: /Give to/ }), 'a');
    await user.click(give);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/work-sets/s1'));
    expect(apiFetch).toHaveBeenCalledWith('/work-sets', {
      method: 'POST',
      body: { taskIds: ['t1', 't2'], assignedToId: 'a', dueDate: null, name: null, note: null },
    });
    expect(toast).toHaveBeenCalledWith(
      'Gave 2 to Arjun Mehta as “GSTR-1 Oct 2026 — Arjun”.',
      'success',
    );
  });

  it('shows only the sets given to them to someone who does not give work', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/work-sets/people') return Promise.reject(new Error('forbidden'));
      if (path === '/work-sets?mine=assigned_to') return Promise.resolve([summary]);
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    render(wrap(<AssignWorkScreen />));

    expect(await screen.findByText('GSTR-1 Oct 2026 — Arjun')).toBeInTheDocument();
    expect(screen.queryByText('Give a set of work')).not.toBeInTheDocument();
    expect(screen.queryByText('Given by you')).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining('open-tasks'));
  });
});

describe('WorkSetDetailScreen', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    toast.mockReset();
  });

  const detail = (canSplit: boolean): WorkSetDetail => ({
    ...summary,
    canSplit,
    tasks: [
      task({ assignedToId: 'a', assignedToName: 'Arjun Mehta', reviewerName: 'Meera Rao' }),
      task({ id: 't2', entityName: 'Bharat Steel', assignedToName: 'Arjun Mehta' }),
    ],
  });

  it('hands the ticked tasks on to someone below', async () => {
    apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === '/work-sets/s1') return Promise.resolve(detail(true));
      if (path === '/work-sets/people?below=true') {
        return Promise.resolve([{ id: 'k', fullName: 'Khushi Sharma', gradeName: 'Article' }]);
      }
      if (path === '/work-sets/s1/split' && init?.method === 'POST') {
        return Promise.resolve({ moved: 1 });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    const user = userEvent.setup();
    render(wrap(<WorkSetDetailScreen id="s1" />));

    await screen.findByText('Bharat Steel');
    expect(
      screen.getByText('Given to Arjun Mehta · by Meera Rao · due 09 Nov 2026'),
    ).toBeInTheDocument();
    await user.click(screen.getAllByRole('checkbox')[1]!);
    await screen.findByRole('option', { name: 'Khushi Sharma · Article' });
    await user.selectOptions(screen.getByRole('combobox', { name: /Hand on to/ }), 'k');
    await user.click(screen.getByRole('button', { name: /Hand on/ }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/work-sets/s1/split', {
        method: 'POST',
        body: { taskIds: ['t2'], toEmployeeId: 'k', note: null },
      }),
    );
    expect(toast).toHaveBeenCalledWith('Handed 1 task to Khushi Sharma.', 'success');
  });

  it('shows no ticks to someone who may not split the set', async () => {
    apiFetch.mockImplementation((path: string) =>
      path === '/work-sets/s1'
        ? Promise.resolve(detail(false))
        : Promise.reject(new Error(`unexpected ${path}`)),
    );
    render(wrap(<WorkSetDetailScreen id="s1" />));

    await screen.findByText('Bharat Steel');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hand on/ })).not.toBeInTheDocument();
  });
});
