import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AuditTeamMember, StatutoryAuditTeam } from '@hsdg/contracts';
import { TeamPanel } from '../team-panel';

const apiFetch = jest.fn();
const toast = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
jest.mock('@/lib/principal', () => ({ can: () => true }));
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const person = (o: Partial<AuditTeamMember> & { employeeId: string; name: string }): AuditTeamMember => ({
  role: 'Member',
  workItems: 0,
  plannedHours: 0,
  actualHours: 0,
  isReviewer: false,
  grade: null,
  estimatedHours: 0,
  plannedSuggested: false,
  planBasis: null,
  progress: { done: 0, total: 0 },
  flags: [],
  ...o,
});

const team: StatutoryAuditTeam = {
  workflowInstanceId: 'wf1',
  engagementServiceId: 's1',
  engagementId: 'e1',
  engagementPartnerId: 'ep',
  engagementPartnerName: 'Partner P',
  engagementManagerId: 'mgr',
  engagementManagerName: 'Manager M',
  members: [
    person({
      employeeId: 'mgr',
      name: 'Manager M',
      role: 'Manager',
      workItems: 12,
      plannedHours: 34,
      estimatedHours: 34,
      plannedSuggested: true,
      planBasis: 'Estimated from 10 procedure(s) (28h), planning & completion (6h)',
      progress: { done: 2, total: 10 },
      flags: [{ key: 'overdue', label: '1 overdue', tone: 'danger' }],
    }),
    person({
      employeeId: 'sr',
      name: 'Senior S',
      grade: 'Senior',
      plannedHours: 20,
      estimatedHours: 12,
      flags: [{ key: 'no_work', label: 'No work assigned', tone: 'info' }],
    }),
  ],
  totals: { plannedHours: 54, actualHours: 0, workItems: 12 },
  unassigned: 1,
  balance: [
    {
      procedureId: 'p1',
      ref: 'P-001',
      title: 'Revenue cut-off',
      field: 'owner',
      fromEmployeeId: 'mgr',
      fromName: 'Manager M',
      toEmployeeId: 'sr',
      toName: 'Senior S',
      reason: 'Significant-risk work — to a senior with the lightest load',
    },
  ],
};

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
  apiFetch.mockImplementation((url: string) =>
    url.endsWith('/team/balance')
      ? Promise.resolve({ team, moved: 1 })
      : Promise.resolve([team]),
  );
});

describe('Team plans itself from the file', () => {
  it('shows estimated hours, flags and progress', async () => {
    render(wrap(<TeamPanel engagementId="e1" />));
    expect(await screen.findByText('1 overdue')).toBeInTheDocument();
    expect(screen.getByText('No work assigned')).toBeInTheDocument();
    expect(screen.getByText('2/10 done')).toBeInTheDocument();
    expect(screen.getByText('Estimated')).toHaveAttribute(
      'title',
      'Estimated from 10 procedure(s) (28h), planning & completion (6h)',
    );
    expect(screen.getByText('1 procedure(s) have no owner.')).toBeInTheDocument();
  });

  it('offers the estimate when someone set their own hours', async () => {
    const user = userEvent.setup();
    render(wrap(<TeamPanel engagementId="e1" />));
    expect(await screen.findByText(/File suggests 12h/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use' }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/team/allocations', {
      method: 'POST',
      body: { employeeId: 'sr', plannedHours: 12 },
    });
  });

  it('previews and applies "Balance the work" in one click', async () => {
    const user = userEvent.setup();
    render(wrap(<TeamPanel engagementId="e1" />));
    expect(await screen.findByText('1 procedure(s) can move to the team')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'See changes' }));
    expect(screen.getByText(/to a senior with the lightest load/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply all' }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/team/balance', {
      method: 'POST',
      body: {},
    });
    expect(toast).toHaveBeenCalledWith('Work balanced — 1 change(s) made.');
  });
});
