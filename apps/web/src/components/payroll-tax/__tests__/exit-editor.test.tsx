import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ExitSettlement } from '@hsdg/contracts';
import { ExitEditor } from '../exit-editor';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  downloadFile: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: null }) }));

jest.setTimeout(20_000);

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const settlement = (over: Partial<ExitSettlement> = {}): ExitSettlement => ({
  id: 's1',
  employeeId: 'e9',
  employeeCode: 'EMP009',
  fullName: 'Asha Rao',
  joinedOn: '2021-04-01',
  exitDate: '2027-02-15',
  dueBy: '2027-02-17',
  payMonth: '2027-02',
  status: 'draft',
  input: {
    leaveDays: 10,
    noticeShortfallDays: 0,
    noticePayDays: 0,
    gratuityOverride: null,
    otherEarnings: [],
    otherDeductions: [],
    note: null,
  },
  working: {
    lastMonth: null,
    gratuity: { eligible: true, countedYears: 6, amount: '207692.00', reason: '' },
    items: [
      {
        kind: 'earning',
        code: 'leave_encashment',
        label: 'Leave encashment (10 days)',
        amount: '20000.00',
      },
      { kind: 'earning', code: 'gratuity_paid', label: 'Gratuity', amount: '207692.00' },
    ],
    tds: '15000.00',
    gross: '227692.00',
    deductions: '0.00',
    net: '227692.00',
    warnings: [],
  },
  preparedBy: 'HR H',
  approvedBy: null,
  approvedAt: null,
  returnedReason: null,
  runId: null,
  runStatus: null,
  version: 3,
  ...over,
});

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
});

describe('ExitEditor', () => {
  it('lets HR change the leave days and send the settlement for approval', async () => {
    apiFetch.mockImplementation((_path: string, init?: { method?: string; body?: unknown }) => {
      if (!init) return Promise.resolve(settlement());
      return Promise.resolve(settlement({ status: init.method === 'PUT' ? 'draft' : 'submitted' }));
    });
    render(wrap(<ExitEditor employeeId="e9" prepares approver={false} />));
    expect(await screen.findByText('Net settlement')).toBeInTheDocument();
    expect(screen.getByText(/Gratuity: 6 years counted/)).toBeInTheDocument();

    const leave = screen.getByLabelText(/Leave to encash/);
    await userEvent.clear(leave);
    await userEvent.type(leave, '12');
    await userEvent.click(screen.getByRole('button', { name: 'Save and work it out' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/payroll/exits/e9',
        expect.objectContaining({
          method: 'PUT',
          body: expect.objectContaining({ leaveDays: 12, version: 3 }),
        }),
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/payroll/exits/e9/submit', {
        method: 'POST',
        body: { version: 3, reason: undefined },
      }),
    );
    // HR cannot approve.
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('needs a reason before an override of the gratuity rule is saved', async () => {
    apiFetch.mockResolvedValue(settlement());
    render(wrap(<ExitEditor employeeId="e9" prepares approver={false} />));
    await screen.findByText('Net settlement');
    await userEvent.click(screen.getByLabelText(/Override the gratuity rule/));
    const save = screen.getByRole('button', { name: 'Save and work it out' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Why the rule is overridden'), 'Died in service');
    expect(save).toBeEnabled();
  });

  it('gives the approver approve and return (with a reason), and no editing', async () => {
    apiFetch.mockImplementation((_path: string, init?: { method?: string }) =>
      Promise.resolve(
        init
          ? settlement({ status: 'draft', returnedReason: 'x' })
          : settlement({ status: 'submitted' }),
      ),
    );
    render(wrap(<ExitEditor employeeId="e9" prepares={false} approver />));
    await screen.findByText('Net settlement');
    expect(screen.getByLabelText(/Leave to encash/)).toBeDisabled();
    const ret = screen.getByRole('button', { name: 'Return' });
    expect(ret).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason to return'), 'Check the leave');
    await userEvent.click(ret);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/payroll/exits/e9/return', {
        method: 'POST',
        body: { version: 3, reason: 'Check the leave' },
      }),
    );
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });
});
