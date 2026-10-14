import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InstanceWorkspace as Workspace, LastPeriodView } from '@hsdg/contracts';
import { answerText, LastPeriod } from '../last-period';
import { InstanceWorkspace } from '../instance-workspace';

const apiFetch = jest.fn();
const downloadFile = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  downloadFile: (...args: unknown[]) => downloadFile(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ principal: { employeeId: 'me', roles: [], permissions: [] } }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/x',
  useSearchParams: () => new URLSearchParams(),
}));

const previous: NonNullable<LastPeriodView['previous']> = {
  instanceId: 'aug',
  engagementId: 'e1',
  formLabel: 'GSTR-1',
  ruleName: 'GSTR-1',
  financialYear: '2026-27',
  periodKey: '2026-08',
  periodLabel: 'Aug 2026',
  statutoryDueDate: '2026-09-11',
  workflowStatus: 'filed',
  filing: {
    referenceKind: 'arn',
    referenceNo: 'AA190826000001X',
    filedOn: '2026-09-10',
    filedByName: 'Senior Y',
    isNil: false,
    ackDocumentId: 'ack1',
  },
  checklist: [
    {
      itemCode: 'ADVANCES',
      label: 'Advances',
      status: 'done',
      doneNote: 'None',
      naReason: null,
      doneByName: 'Senior Y',
      doneAt: '2026-09-05T05:00:00Z',
    },
    {
      itemCode: 'EWB_REPORT',
      label: 'E-way bill report',
      status: 'not_applicable',
      doneNote: null,
      naReason: 'Below limit',
      doneByName: null,
      doneAt: null,
    },
  ],
  slots: [
    {
      slotCode: 'SALES_REGISTER',
      label: 'Sales register received',
      documents: [
        {
          id: 'd1',
          title: 'Sales',
          filename: 'sales-aug.pdf',
          uploadedAt: '2026-09-02T05:00:00Z',
          uploadedByName: null,
          fromClient: true,
        },
      ],
    },
  ],
  reviewPoints: [
    { at: '2026-09-08T05:00:00Z', byName: 'Manager X', note: 'Credit notes missing from Table 9B' },
  ],
};

function wrap(ui: JSX.Element): ReturnType<typeof render> {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiFetch.mockReset();
  downloadFile.mockReset();
});

describe('Last period (WF-303)', () => {
  it('asks for nothing until shown, then lays out last month read-only', async () => {
    apiFetch.mockResolvedValue({ previous });
    wrap(<LastPeriod instanceId="sep" />);
    expect(apiFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Last period' }));
    expect(apiFetch).toHaveBeenCalledWith('/compliance-instances/sep/last-period');
    const panel = await screen.findByRole('region', { name: 'Last period' });
    expect(await within(panel).findByText('GSTR-1 · Aug 2026')).toBeTruthy();
    expect(within(panel).getByText('AA190826000001X')).toBeTruthy();
    expect(within(panel).getByText('Done · None')).toBeTruthy();
    expect(within(panel).getByText('N/A — Below limit')).toBeTruthy();
    expect(within(panel).getByText('Credit notes missing from Table 9B')).toBeTruthy();
    expect(within(panel).queryByRole('checkbox')).toBeNull();
  });

  it("opens last month's documents in place", async () => {
    apiFetch.mockResolvedValue({ previous });
    wrap(<LastPeriod instanceId="sep" />);
    fireEvent.click(screen.getByRole('button', { name: 'Last period' }));
    fireEvent.click(await screen.findByRole('button', { name: 'sales-aug.pdf' }));
    expect(downloadFile).toHaveBeenCalledWith(
      '/engagements/e1/documents/d1/download',
      'sales-aug.pdf',
    );
    fireEvent.click(screen.getByRole('button', { name: 'acknowledgement' }));
    expect(downloadFile).toHaveBeenLastCalledWith(
      '/engagements/e1/documents/ack1/download',
      'acknowledgement',
    );
  });

  it('says so on the first period', async () => {
    apiFetch.mockResolvedValue({ previous: null });
    wrap(<LastPeriod instanceId="aug" />);
    fireEvent.click(screen.getByRole('button', { name: 'Last period' }));
    expect(await screen.findByText('No earlier period for this filing.')).toBeTruthy();
  });

  it('answerText reads an answer back', () => {
    expect(answerText(previous.checklist[0]!)).toBe('Done · None');
    expect(answerText(previous.checklist[1]!)).toBe('N/A — Below limit');
    expect(answerText({ ...previous.checklist[0]!, status: 'open' })).toBe('Open');
  });
});

describe('Carried answers in the checklist (WF-303)', () => {
  const ws = {
    instance: {
      id: 'sep',
      engagementId: 'e1',
      ruleCode: 'GST_GSTR1',
      ruleName: 'GSTR-1',
      formLabel: 'GSTR-1',
      stream: 'gst',
      section: 'outward',
      financialYear: '2026-27',
      periodKey: '2026-09',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      statutoryDueDate: '2026-10-11',
      internalDate: '2026-10-09',
      daysLeft: 5,
      workflowStatus: 'in_preparation',
      isProvisional: false,
      verify: false,
      registrationId: 'r1',
      registrationNumber: '19AAACB1234C1Z5',
      isLocked: false,
      lockedReason: null,
      lateFeeNote: null,
      lateCharges: null,
      notApplicableReason: null,
    },
    task: null,
    checklist: [
      {
        id: 'it1',
        itemCode: 'ADVANCES',
        label: 'Advances received / adjusted',
        slotCode: null,
        required: false,
        sequence: 1,
        autoTick: null,
        tickedBy: null,
        note: null,
        status: 'open',
        doneByName: null,
        doneAt: null,
        doneNote: null,
        naReason: null,
        documentId: null,
        clientDependencyId: null,
        version: 3,
        carriesOver: true,
        carried: {
          status: 'done',
          note: 'No advances this month',
          naReason: null,
          instanceId: 'aug',
          periodKey: '2026-08',
          periodLabel: 'Aug 2026',
        },
      },
    ],
    slots: [],
    figureSchema: [],
    figures: {},
    figuresVersion: 1,
    figuresRequiredToLodge: false,
    filing: null,
    filingHistory: [],
    corrections: [],
    warnings: [],
    clientRequests: [],
    can: { lodge: false, undo: false, waive: false, edit: true, certify: false },
  } as unknown as Workspace;

  it("shows last period's answer and confirms it with one click", async () => {
    apiFetch.mockImplementation((url: string, init?: { method?: string }) =>
      Promise.resolve(
        init?.method === 'PATCH' ? ws : url.endsWith('/last-period') ? { previous: null } : ws,
      ),
    );
    wrap(<InstanceWorkspace instanceId="sep" ctx={{ me: 'me', isLead: false } as never} />);
    expect(
      await screen.findByText('Last period (Aug 2026): Done · No advances this month'),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm Advances received / adjusted as last period' }),
    );
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/compliance-instances/sep/items/it1', {
        method: 'PATCH',
        body: { status: 'done', version: 3, note: 'No advances this month' },
      }),
    );
  });
});
