import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AuditPbcItem, StatutoryAuditPbc } from '@hsdg/contracts';
import { PbcPanel } from '../pbc-panel';

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

const item = (o: Partial<AuditPbcItem> & { id: string; pbcRef: string }): AuditPbcItem => ({
  requirement: 'Bank statements and reconciliations',
  clientOwner: 'Asha Rao (CFO)',
  workAreaId: 'a1',
  workAreaTitle: 'Cash & Bank',
  status: 'requested',
  rejectionReason: null,
  requestedDate: '2025-09-01',
  dueDate: '2025-09-30',
  receivedDate: null,
  documentId: null,
  documentTitle: null,
  note: null,
  requestedByName: null,
  isOverdue: false,
  sourceKey: 'std:bank',
  sourceNote: 'Standard request list (client master)',
  lastChasedOn: null,
  version: 1,
  createdAt: '',
  updatedAt: '',
  ...o,
});

const tracker: StatutoryAuditPbc = {
  workflowInstanceId: 'wf1',
  engagementServiceId: 's1',
  engagementId: 'e1',
  planningApproved: true,
  items: [
    item({ id: 'p1', pbcRef: 'PBC-001' }),
    item({
      id: 'p2',
      pbcRef: 'PBC-002',
      requirement: 'Sales register and credit notes around the year end (cut-off)',
      workAreaTitle: 'Revenue',
      dueDate: '2025-09-05',
      isOverdue: true,
      lastChasedOn: '2025-09-08',
      sourceKey: 'area:fs_rev:cutoff',
      sourceNote: '03.5 audit area — Revenue',
    }),
    item({ id: 'p3', pbcRef: 'PBC-003', requirement: 'Payroll registers', status: 'received' }),
  ],
  overdueCount: 1,
  summary: { outstanding: 2, overdue: 1, dueSoon: 0, toReview: 1, accepted: 0 },
  chase: [
    {
      owner: 'Asha Rao (CFO)',
      email: 'asha@client.in',
      pbcIds: ['p2'],
      lines: ['PBC-002 — Sales register (due 2025-09-05, 7 day(s) overdue)'],
      overdue: 1,
      lastChasedOn: '2025-09-08',
      subject: 'Acme — statutory audit for FY 2024-25: 1 item(s) pending',
      body: 'Dear Asha,\n\nWe are still awaiting…',
    },
  ],
};

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
  apiFetch.mockImplementation((url: string) => {
    if (url.endsWith('/work-areas')) return Promise.resolve([]);
    if (url.endsWith('/pbc/suggest'))
      return Promise.resolve({ tracker, added: 3, filled: 2 });
    return Promise.resolve([tracker]);
  });
});

describe('PBC tracker builds itself and chases the client', () => {
  it('filters the requests and refreshes the suggestions', async () => {
    const user = userEvent.setup();
    render(wrap(<PbcPanel engagementId="e1" />));
    expect(await screen.findByText('Bank statements and reconciliations')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Overdue · 1' }));
    expect(screen.queryByText('Bank statements and reconciliations')).not.toBeInTheDocument();
    expect(screen.getByText(/Sales register and credit notes/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'To review · 1' }));
    expect(screen.getByText('Payroll registers')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Refresh suggested requests/ }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/pbc/suggest', {
      method: 'POST',
      body: {},
    });
    expect(toast).toHaveBeenCalledWith('Added 3 request(s) and filled 2 blank field(s).');
  });

  it('drafts the reminder per contact and records the chase', async () => {
    const user = userEvent.setup();
    render(wrap(<PbcPanel engagementId="e1" />));
    expect(await screen.findByText('Chase the client')).toBeInTheDocument();
    const mail = screen.getByRole('link', { name: /Email draft/ });
    expect(mail.getAttribute('href')).toMatch(/^mailto:asha@client\.in\?subject=Acme/);
    expect(mail.getAttribute('href')).toContain(encodeURIComponent('Dear Asha,'));

    await user.click(screen.getByRole('button', { name: /Mark chased/ }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/pbc/chased', {
      method: 'POST',
      body: { pbcIds: ['p2'] },
    });
  });

  it('shows where a request came from and offers the next step in one click', async () => {
    const user = userEvent.setup();
    render(wrap(<PbcPanel engagementId="e1" />));
    await user.click(await screen.findByRole('button', { name: /PBC-002/ }));
    expect(screen.getByText('Suggested from: 03.5 audit area — Revenue')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Mark received/ }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/pbc/p2/status', {
      method: 'POST',
      body: { status: 'received', version: 1 },
    });
  });
});
