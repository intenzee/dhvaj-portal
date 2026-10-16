import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  ClientChase as Chase,
  ClientReminderResult,
  WorkspaceInstance,
} from '@hsdg/contracts';
import {
  ClientChase,
  fallbackNote,
  offersWhatsapp,
  reminderButtonLabel,
  reminderLine,
  remindersToSend,
  waitingLine,
} from '../client-chase';

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
  clientPhone: null,
  canWhatsapp: false,
  channel: 'copy',
  fallback: 'no_email',
  reminderText: 'Dear client …',
  reminders: [],
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

  it('names the button by the channel the firm picks for this client', () => {
    expect(reminderButtonLabel(chase())).toBe('Send reminder');
    expect(reminderButtonLabel(chase({ channel: 'email', clientEmail: 'a@b.in' }))).toBe(
      'E-mail reminder to a@b.in',
    );
    expect(reminderButtonLabel(chase({ channel: 'whatsapp' }))).toBe('WhatsApp reminder');
  });

  it('says why a reminder fell back to copying', () => {
    expect(fallbackNote('no_phone')).toMatch(/no phone number/);
    expect(fallbackNote('no_email')).toMatch(/cannot be e-mailed/);
    expect(fallbackNote(null)).toBeNull();
  });

  it('keeps only the reminders a person still has to send', () => {
    const base = { text: 't', waitingOn: [], raised: 0 };
    const all: ClientReminderResult[] = [
      { ...base, instanceId: 'a', client: 'A', channel: 'email', to: 'a@a.in' },
      { ...base, instanceId: 'b', client: 'B', channel: 'whatsapp', waUrl: 'https://wa.me/91' },
      { ...base, instanceId: 'c', client: 'C', channel: 'copy', fallback: 'no_phone' },
    ];
    expect(remindersToSend(all).map((r) => r.instanceId)).toEqual(['b', 'c']);
  });

  it('offers Open WhatsApp under the WhatsApp channel', async () => {
    apiFetch.mockImplementation((_path: string, opts?: { method?: string }) =>
      opts?.method === 'POST'
        ? Promise.resolve({
            instanceId: 'i1',
            client: 'Bharat Traders',
            channel: 'whatsapp',
            waUrl: 'https://wa.me/919876543210?text=Please',
            text: 'Please',
            waitingOn: ['Bank statement'],
            raised: 0,
          })
        : Promise.resolve(
            chase({
              channel: 'whatsapp',
              fallback: null,
              clientPhone: '9876543210',
              canWhatsapp: true,
            }),
          ),
    );
    renderIt(inst());
    fireEvent.click(await screen.findByRole('button', { name: /WhatsApp reminder/ }));
    // WhatsApp is already the firm's channel: no second button for it.
    expect(screen.queryByRole('button', { name: 'Remind on WhatsApp' })).toBeNull();
    const link = await screen.findByRole('link', { name: /Open WhatsApp/ });
    expect(link).toHaveAttribute('href', 'https://wa.me/919876543210?text=Please');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('button', { name: /Copy text/ })).toBeInTheDocument();
  });

  it('offers WhatsApp beside another channel only when the phone works on WhatsApp (PS-001)', () => {
    expect(offersWhatsapp({ canWhatsapp: true, channel: 'email' })).toBe(true);
    expect(offersWhatsapp({ canWhatsapp: true, channel: 'copy' })).toBe(true);
    expect(offersWhatsapp({ canWhatsapp: true, channel: 'whatsapp' })).toBe(false);
    expect(offersWhatsapp({ canWhatsapp: false, channel: 'email' })).toBe(false);
  });

  it('sends by WhatsApp from the phone when the firm e-mails (PS-001)', async () => {
    apiFetch.mockImplementation((_path: string, opts?: { method?: string }) =>
      opts?.method === 'POST'
        ? Promise.resolve({
            instanceId: 'i1',
            client: 'Bharat Traders',
            channel: 'whatsapp',
            waUrl: 'https://wa.me/919876543210?text=Please',
            text: 'Please',
            waitingOn: ['Bank statement'],
            raised: 0,
          })
        : Promise.resolve(
            chase({
              channel: 'email',
              fallback: null,
              canEmail: true,
              clientEmail: 'a@b.in',
              clientPhone: '9876543210',
              canWhatsapp: true,
            }),
          ),
    );
    renderIt(inst());
    expect(
      await screen.findByRole('button', { name: /E-mail reminder to a@b.in/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remind on WhatsApp' }));
    const link = await screen.findByRole('link', { name: /Open WhatsApp/ });
    expect(link).toHaveAttribute('href', 'https://wa.me/919876543210?text=Please');
    expect(link).toHaveAttribute('target', '_blank');
    expect(apiFetch).toHaveBeenCalledWith('/compliance-instances/i1/client-chase/remind', {
      method: 'POST',
      body: { channel: 'whatsapp' },
    });
  });

  it('shows the copy text when there is no e-mail channel', async () => {
    apiFetch.mockImplementation((_path: string, opts?: { method?: string }) =>
      opts?.method === 'POST'
        ? Promise.resolve({
            instanceId: 'i1',
            client: 'Bharat Traders',
            channel: 'copy',
            fallback: 'no_email',
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
    expect(screen.getByText(/cannot be e-mailed/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open WhatsApp/ })).toBeNull();
    // No phone: nothing offers WhatsApp.
    expect(screen.queryByRole('button', { name: 'Remind on WhatsApp' })).toBeNull();
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

  it('lists the reminders already sent, so nobody chases twice (PS-001)', async () => {
    const sent = {
      sentAt: '2026-10-16T05:30:00.000Z',
      channel: 'whatsapp',
      sentByName: 'Manager X',
    } as const;
    expect(reminderLine(sent)).toMatch(/^Reminded 16 Oct 2026 · WhatsApp · Manager X$/);
    expect(reminderLine({ ...sent, channel: 'email', sentByName: null })).toMatch(/· e-mailed$/);
    apiFetch.mockResolvedValue(chase({ reminders: [sent] }));
    renderIt(inst());
    const list = await screen.findByRole('list', { name: 'Reminders sent' });
    expect(list).toHaveTextContent('WhatsApp · Manager X');
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
