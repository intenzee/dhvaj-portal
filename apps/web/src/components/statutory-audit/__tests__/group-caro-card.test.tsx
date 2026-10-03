import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { GroupCaroCard } from '../group-caro-card';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
jest.mock('@/lib/principal', () => ({ can: () => true }));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const assessment = (outcome: string) => ({
  state: 'system_suggested_applicable',
  systemOutcome: outcome,
  systemBasis: 'Basis from the engine.',
  version: 3,
});

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((url: string) => {
    if (url.endsWith('/caro'))
      return Promise.resolve([
        {
          workflowInstanceId: 'wf1',
          assessment: assessment('applicable'),
          capturedFacts: { peakBankFiBorrowings: null },
          masterFacts: [
            { label: 'Paid-up capital + reserves', value: '₹4,00,00,000', source: 'Client master' },
          ],
        },
      ]);
    if (url.endsWith('/consolidation'))
      return Promise.resolve([
        {
          workflowInstanceId: 'wf1',
          assessment: assessment('cfs_required'),
          capturedFacts: {
            isWhollyOwnedSubsidiary: false,
            isPartiallyOwnedSubsidiary: true,
            parentFilesCompliantCfs: null,
          },
          masterFacts: [
            { label: 'Subsidiaries, associates and JVs', value: 'Sub A', source: 'Client master' },
          ],
        },
      ]);
    if (url.endsWith('/fill-from-master')) return Promise.resolve({ filled: [] });
    return Promise.resolve({});
  });
});

describe('CARO & group facts card', () => {
  it('shows what the client master filled, with its source', async () => {
    render(wrap(<GroupCaroCard engagementId="e1" />));
    expect(await screen.findByText('₹4,00,00,000')).toBeInTheDocument();
    expect(screen.getByText('Sub A')).toBeInTheDocument();
    expect(screen.getByText(/Suggested: Cfs required/i)).toBeInTheDocument();
  });

  it('fills both sections from the client master in one click', async () => {
    const user = userEvent.setup();
    render(wrap(<GroupCaroCard engagementId="e1" />));
    await user.click(await screen.findByRole('button', { name: /Fill from client master/ }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/caro/fill-from-master',
      { method: 'POST', body: {} },
    );
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/consolidation/fill-from-master',
      { method: 'POST', body: {} },
    );
  });

  it('asks only for the peak borrowings, and saves it with the version', async () => {
    const user = userEvent.setup();
    render(wrap(<GroupCaroCard engagementId="e1" />));
    await user.type(await screen.findByLabelText(/Peak bank/), '2500000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/caro/facts', {
      method: 'POST',
      body: { peakBankFiBorrowings: 2500000, version: 3 },
    });
  });
});
