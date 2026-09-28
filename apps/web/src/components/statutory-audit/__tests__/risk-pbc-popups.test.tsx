import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { RiskPanel } from '../risk-panel';
import { PbcPanel } from '../pbc-panel';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
jest.mock('@/lib/principal', () => ({ can: () => true }));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));

const risk = {
  id: 'r1',
  riskRef: 'R-001',
  description: 'Revenue recognised before delivery',
  source: 'fraud',
  fsArea: 'Revenue',
  assertion: 'cut_off',
  rating: 'significant',
  isSignificant: true,
  isFraudRisk: true,
  response: 'Cut-off testing around year end',
  conclusion: null,
  ownerEmployeeId: null,
  ownerName: 'Manager X',
  reviewerEmployeeId: null,
  reviewerName: null,
  status: 'identified',
  version: 1,
};

const pbcItem = {
  id: 'p1',
  pbcRef: 'PBC-001',
  requirement: 'Trial Balance as at 31 March',
  clientOwner: 'Finance',
  workAreaId: null,
  workAreaTitle: null,
  status: 'requested',
  rejectionReason: null,
  requestedDate: null,
  dueDate: '2026-10-15',
  receivedDate: null,
  note: 'Signed copy please',
  documentTitle: null,
  isOverdue: false,
  version: 1,
};

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => apiFetch.mockReset());

describe('Risk register pop-ups', () => {
  beforeEach(() => {
    apiFetch.mockResolvedValue([
      {
        workflowInstanceId: 'wf1',
        planningApproved: true,
        significantRisksWithoutResponse: 0,
        risks: [risk],
      },
    ]);
  });

  it('lists risks compactly and opens a risk in a pop-up', async () => {
    const user = userEvent.setup();
    render(wrap(<RiskPanel engagementId="e1" team={[]} />));

    const row = await screen.findByRole('button', { name: /R-001/ });
    // The response is detail — not shown in the compact list.
    expect(screen.queryByText(/Cut-off testing/)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(row);
    const dialog = screen.getByRole('dialog', { name: 'R-001 · Risk' });
    expect(within(dialog).getByText(/Cut-off testing/)).toBeInTheDocument();

    // Edit happens inside the same pop-up.
    await user.click(within(dialog).getByRole('button', { name: 'Edit' }));
    const editing = screen.getByRole('dialog', { name: 'R-001 · Edit risk' });
    expect(within(editing).getByDisplayValue(risk.description)).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the add-risk form in a pop-up', async () => {
    const user = userEvent.setup();
    render(wrap(<RiskPanel engagementId="e1" team={[]} />));
    await user.click(await screen.findByRole('button', { name: /Add risk/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add risk' });
    expect(within(dialog).getByText('Planned response')).toBeInTheDocument();
  });
});

describe('PBC tracker pop-ups', () => {
  beforeEach(() => {
    apiFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith('/work-areas')
          ? []
          : [{ workflowInstanceId: 'wf1', planningApproved: true, overdueCount: 0, items: [pbcItem] }],
      ),
    );
  });

  it('lists requests compactly and opens a request in a pop-up', async () => {
    const user = userEvent.setup();
    render(wrap(<PbcPanel engagementId="e1" />));

    const row = await screen.findByRole('button', { name: /PBC-001/ });
    expect(screen.queryByText('Signed copy please')).not.toBeInTheDocument();

    await user.click(row);
    const dialog = screen.getByRole('dialog', { name: 'PBC-001 · PBC request' });
    expect(within(dialog).getByText('Signed copy please')).toBeInTheDocument();
    expect(within(dialog).getByTitle('Change status')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('dialog', { name: 'PBC-001 · Edit request' })).toBeInTheDocument();
  });

  it('opens the add-request form in a pop-up', async () => {
    const user = userEvent.setup();
    render(wrap(<PbcPanel engagementId="e1" />));
    await user.click(await screen.findByRole('button', { name: /Add request/ }));
    expect(screen.getByRole('dialog', { name: 'Add PBC request' })).toBeInTheDocument();
  });
});
