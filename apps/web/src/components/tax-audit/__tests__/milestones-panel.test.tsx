import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { TaxAuditBoard, TaxAuditMilestone, TaxAuditMilestones } from '@hsdg/contracts';
import { MilestonesPanel } from '../milestones-panel';
import { TaxAuditBoardPanel, boardYear } from '../tax-audit-board';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const URL = '/engagements/g1/tax-audits/a1/milestones';

const ms = (over: Partial<TaxAuditMilestone> & Pick<TaxAuditMilestone, 'key' | 'label'>) =>
  ({
    role: 'senior',
    roleLabel: 'Senior',
    dueOn: '2026-09-01',
    done: false,
    missed: false,
    doneAt: null,
    doneByName: null,
    ownerId: 's1',
    ownerName: 'Senior Y',
    ownerNamed: false,
    canTick: false,
    ...over,
  }) as TaxAuditMilestone;

const view = (over: Partial<TaxAuditMilestones> = {}): TaxAuditMilestones => ({
  auditId: 'a1',
  engagementId: 'g1',
  financialYear: '2025-26',
  stage: 'information',
  dueDate: '2026-10-31',
  canNameOwners: true,
  milestones: [
    ms({
      key: 'accepted',
      label: 'Accepted, appointment letter signed',
      done: true,
      doneAt: '2026-08-10T05:00:00Z',
      role: 'signing_partner',
      roleLabel: 'Signing Partner',
      ownerName: 'Partner A',
    }),
    ms({ key: 'info_requests', label: 'Information requests sent', missed: true, canTick: true }),
    ms({ key: 'review', label: 'Review done', role: 'manager', roleLabel: 'Manager' }),
  ],
  ...over,
});

describe('MilestonesPanel', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    toast.mockReset();
  });

  it('lists each milestone with its date, owner and state, missed ones flagged', async () => {
    apiFetch.mockResolvedValue(view());
    render(wrap(<MilestonesPanel engagementId="g1" auditId="a1" />));
    const list = await screen.findByRole('list', { name: 'Milestones' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Accepted, appointment letter signed');
    expect(rows[0]).toHaveTextContent('Done');
    expect(rows[1]).toHaveTextContent('Missed');
    expect(rows[1]).toHaveTextContent('Senior Y');
    expect(screen.getByText('1 milestone missed.')).toBeInTheDocument();
    // Only the tickable one offers Mark done.
    expect(screen.getAllByRole('button', { name: 'Mark done' })).toHaveLength(1);
  });

  it('ticks a milestone done', async () => {
    apiFetch.mockResolvedValueOnce(view()).mockResolvedValueOnce(view());
    render(wrap(<MilestonesPanel engagementId="g1" auditId="a1" />));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark done' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(`${URL}/info_requests`, {
        method: 'PUT',
        body: { done: true },
      }),
    );
  });

  it('names an owner inline, under the milestone', async () => {
    apiFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith('/employees')
          ? { items: [{ id: 'm9', fullName: 'Manager Z', gradeName: 'Manager' }], total: 1 }
          : view(),
      ),
    );
    render(wrap(<MilestonesPanel engagementId="g1" auditId="a1" />));
    const [, second] = await screen.findAllByRole('button', { name: '+ Owner' });
    fireEvent.click(second!);
    const picker = await screen.findByLabelText('Who answers for Review done');
    await screen.findByRole('option', { name: 'Manager Z · Manager' });
    fireEvent.change(picker, { target: { value: 'm9' } });
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(`${URL}/review`, {
        method: 'PUT',
        body: { ownerId: 'm9' },
      }),
    );
  });

  it('hides the controls from someone who may not use them', async () => {
    apiFetch.mockResolvedValue(
      view({
        canNameOwners: false,
        milestones: view().milestones.map((m) => ({ ...m, canTick: false })),
      }),
    );
    render(wrap(<MilestonesPanel engagementId="g1" auditId="a1" />));
    await screen.findByRole('list', { name: 'Milestones' });
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Owner' })).toBeNull();
  });
});

describe('TaxAuditBoardPanel', () => {
  beforeEach(() => apiFetch.mockReset());

  it('opens on the year that ended last March', () => {
    expect(boardYear('2026-11-04')).toBe('2025-26');
    expect(boardYear('2027-02-10')).toBe('2025-26');
    expect(boardYear('2027-04-01')).toBe('2026-27');
  });

  it('shows the stage counts, the audits at risk with s.271B, and partner load', async () => {
    const board: TaxAuditBoard = {
      financialYear: '2025-26',
      today: '2026-11-04',
      counts: { not_started: 4, in_progress: 7, completed: 12 },
      byStage: {},
      atRisk: [
        {
          auditId: 'a1',
          engagementId: 'g1',
          engagementCode: 'CMP/0001',
          entityName: 'Bharat Textiles',
          stage: 'review',
          dueDate: '2026-10-31',
          signingPartnerName: 'Partner A',
          missed: [
            { key: 'review', label: 'Review done', dueOn: '2026-10-16', ownerName: 'Manager X' },
          ],
          daysLate: 4,
          turnover: 25000000,
          exposure: 125000,
        },
      ],
      totalExposure: 125000,
      limit: 60,
      partners: [
        {
          employeeId: 'p1',
          name: 'Partner A',
          reports: 60,
          summary: 'Partner A: 60 of 60 for FY 2025-26',
        },
      ],
    };
    apiFetch.mockResolvedValue(board);
    render(wrap(<TaxAuditBoardPanel today="2026-11-04" />));
    const counts = await screen.findByLabelText('Audits by stage');
    expect(counts).toHaveTextContent('Not started4');
    expect(counts).toHaveTextContent('In progress7');
    expect(counts).toHaveTextContent('Completed12');
    const risk = screen.getByRole('region', { name: 'At risk' });
    expect(risk).toHaveTextContent('Bharat Textiles');
    expect(risk).toHaveTextContent('4 days late');
    expect(risk).toHaveTextContent('Review done');
    expect(risk).toHaveTextContent('1,25,000');
    expect(screen.getByRole('region', { name: 'Partner load' })).toHaveTextContent(
      'Partner A: 60 of 60 for FY 2025-26',
    );
    expect(apiFetch).toHaveBeenCalledWith('/tax-audits/board?financialYear=2025-26');
  });
});
