import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ClientChase as Chase, WorkspaceInstance } from '@hsdg/contracts';
import { ClientChase, reminderButtonLabel, waitingLine } from '../client-chase';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
let flagOn = true;
jest.mock('@/lib/feature-flags', () => ({
  useFeatureFlags: () => ({ isOn: () => flagOn, isLoading: false, flags: {} }),
}));

const chase = (over: Partial<Chase> = {}): Chase => ({
  instanceId: 'i1',
  waitingOn: [
    {
      dependencyId: 'd1',
      slotCode: 'bank_statement',
      label: 'Bank statement',
      requestDate: '2026-10-01',
      reminderDate: '2026-10-04',
      escalationDate: '2026-10-08',
      overdue: false,
    },
  ],
  notRequested: [{ slotCode: 'purchase_register', label: 'Purchase register' }],
  clientEmail: null,
  canEmail: false,
  reminderText: 'Dear client …',
  ...over,
});

const inst = (over: Partial<WorkspaceInstance> = {}): WorkspaceInstance =>
  ({ id: 'i1', engagementId: 'e1', workflowStatus: 'awaiting_data', ...over }) as WorkspaceInstance;

const renderIt = (i: WorkspaceInstance) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ClientChase instance={i} />
    </QueryClientProvider>,
  );

describe('client chase', () => {
  beforeEach(() => {
    flagOn = true;
    apiFetch.mockReset();
    toast.mockReset();
  });

  it('names what the client still owes', () => {
    expect(waitingLine(chase())).toBe('Waiting on client: Bank statement, Purchase register');
    expect(waitingLine(chase({ waitingOn: [], notRequested: [] }))).toBeNull();
  });

  it('says e-mail only when the firm can e-mail the client', () => {
    expect(reminderButtonLabel(chase())).toBe('Send reminder');
    expect(reminderButtonLabel(chase({ canEmail: true, clientEmail: 'a@b.in' }))).toBe(
      'E-mail reminder to a@b.in',
    );
  });

  it('shows the copy text when there is no e-mail channel', async () => {
    apiFetch.mockImplementation((_path: string, opts?: { method?: string }) =>
      opts?.method === 'POST'
        ? Promise.resolve({
            instanceId: 'i1',
            channel: 'copy',
            text: 'Please send the bank statement.',
            waitingOn: ['Bank statement'],
            raised: 1,
          })
        : Promise.resolve(chase()),
    );
    renderIt(inst());
    expect(
      await screen.findByText('Waiting on client: Bank statement, Purchase register'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Send reminder/ }));
    await waitFor(() =>
      expect(screen.getByLabelText('Reminder text')).toHaveValue('Please send the bank statement.'),
    );
    expect(apiFetch).toHaveBeenCalledWith('/compliance-instances/i1/client-chase/remind', {
      method: 'POST',
    });
  });

  it('marks an escalated request', async () => {
    apiFetch.mockResolvedValue(
      chase({ waitingOn: [{ ...chase().waitingOn[0]!, overdue: true }], notRequested: [] }),
    );
    renderIt(inst());
    expect(await screen.findByText('Escalated')).toBeInTheDocument();
  });

  it('stays out of the way when filed, empty, or the flag is off', async () => {
    apiFetch.mockResolvedValue(chase({ waitingOn: [], notRequested: [] }));
    const { container } = renderIt(inst());
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();

    apiFetch.mockClear();
    renderIt(inst({ workflowStatus: 'filed' }));
    flagOn = false;
    renderIt(inst());
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
