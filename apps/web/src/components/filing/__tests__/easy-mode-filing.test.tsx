import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RELAXED_FIRM_CHECKS,
  STRICT_FIRM_CHECKS,
  type FirmChecks,
  type InstanceWorkspace as Workspace,
} from '@hsdg/contracts';
import { InstanceWorkspace } from '../instance-workspace';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  downloadFile: jest.fn(),
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

const base = {
  instance: {
    id: 'sep',
    engagementId: 'e1',
    ruleCode: 'GST_GSTR3B',
    ruleName: 'GSTR-3B',
    formLabel: 'GSTR-3B',
    stream: 'gst',
    section: 'summary',
    financialYear: '2026-27',
    periodKey: '2026-09',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    statutoryDueDate: '2026-10-20',
    internalDate: '2026-10-18',
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
      itemCode: 'CLIENT_APPROVAL',
      label: 'Client approval',
      slotCode: null,
      required: true,
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
      version: 2,
      carriesOver: false,
      carried: null,
    },
  ],
  slots: [{ slotCode: 'ACK_3B', label: 'Acknowledgement', documents: [] }],
  figureSchema: [],
  figures: {},
  figuresVersion: 1,
  figuresRequiredToLodge: false,
  filing: null,
  filingHistory: [],
  corrections: [],
  warnings: [],
  clientRequests: [],
  can: { lodge: true, undo: false, waive: true, edit: true, certify: false, complete: false },
} as unknown as Workspace;

const filed = {
  ...base,
  instance: { ...base.instance, workflowStatus: 'filed', isLocked: true },
  filing: {
    id: 'f1',
    referenceKind: 'arn',
    referenceNo: null,
    filedOn: '2026-10-11',
    filedByName: 'Senior Y',
    isNil: false,
    isLate: false,
    ackDocumentId: null,
    recordedAt: '2026-10-11T05:00:00Z',
    remarks: null,
    lateFeePaid: null,
    interestPaid: null,
    normalFeePaid: null,
  },
  warnings: [
    { code: 'ack_missing', message: 'Filed — the acknowledgement is still to be added.' },
    { code: 'reference_missing', message: 'Filed — the reference number is still to be added.' },
  ],
  can: { lodge: false, undo: true, waive: false, edit: false, certify: false, complete: true },
} as unknown as Workspace;

function serve(ws: Workspace, checks: FirmChecks): void {
  apiFetch.mockImplementation((url: string) =>
    Promise.resolve(
      url === '/workflow-settings'
        ? { checks, checksEditable: false }
        : url.endsWith('/last-period')
          ? { previous: null }
          : ws,
    ),
  );
}

function wrap(): ReturnType<typeof render> {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InstanceWorkspace instanceId="sep" ctx={{ me: 'me', isLead: false } as never} />
    </QueryClientProvider>,
  );
}

beforeEach(() => apiFetch.mockReset());

describe("Lodging with the firm's checks off", () => {
  it('marks a filing filed in one step, dated today', async () => {
    serve(base, RELAXED_FIRM_CHECKS);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark filed' }));
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/compliance-instances/sep/lodge', {
        method: 'POST',
        body: { filedOn: today },
      }),
    );
  });

  it('lodges from the form without a reference or acknowledgement', async () => {
    serve(base, RELAXED_FIRM_CHECKS);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'With details…' }));
    const form = screen.getByRole('form', { name: 'Lodge filing' });
    const submit = within(form).getByRole('button', { name: 'Lodge' });
    expect(submit).not.toHaveProperty('disabled', true);
    fireEvent.click(submit);
    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([url]) => url === '/compliance-instances/sep/lodge');
      expect(call).toBeTruthy();
      expect(call![1].body).not.toHaveProperty('referenceNo');
      expect(call![1].body).not.toHaveProperty('ackDocumentId');
    });
  });

  it('keeps the full form, reference and acknowledgement while the checks are on', async () => {
    serve(base, STRICT_FIRM_CHECKS);
    wrap();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/workflow-settings'));
    fireEvent.click(await screen.findByRole('button', { name: 'Lodge filing' }));
    expect(screen.queryByRole('button', { name: 'Mark filed' })).toBeNull();
    const form = screen.getByRole('form', { name: 'Lodge filing' });
    expect(within(form).getByRole('button', { name: 'Lodge' })).toHaveProperty('disabled', true);
  });

  it('takes a step as Not applicable without a reason', async () => {
    serve(base, RELAXED_FIRM_CHECKS);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'N/A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not applicable' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/compliance-instances/sep/items/it1', {
        method: 'PATCH',
        body: { status: 'not_applicable', version: 2 },
      }),
    );
  });

  it('asks for what a lodge lacks and fills in the reference', async () => {
    serve(filed, RELAXED_FIRM_CHECKS);
    wrap();
    const panel = await screen.findByRole('generic', { name: 'Complete the lodge' });
    expect(
      within(panel).getByText('Still to add: the acknowledgement and the reference number.'),
    ).toBeTruthy();
    expect(within(panel).getByLabelText('Upload acknowledgement')).toBeTruthy();
    const ref = within(panel).getByRole('form', { name: 'Add reference' });
    fireEvent.change(within(ref).getByRole('textbox'), { target: { value: 'aa1909261234567' } });
    fireEvent.click(within(ref).getByRole('button', { name: 'Save reference' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/compliance-instances/sep/lodge', {
        method: 'PATCH',
        body: { referenceNo: 'AA1909261234567', referenceKind: 'arn' },
      }),
    );
  });
});
