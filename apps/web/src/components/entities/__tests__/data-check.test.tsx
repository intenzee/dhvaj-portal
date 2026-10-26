import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { DATA_CHECKS } from '@hsdg/contracts';
import { applySummary, DataCheckView } from '../data-check';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  downloadFile: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
jest.mock('@/lib/principal', () => ({ can: () => true }));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const row = {
  id: 'e1',
  entityId: 'e1',
  code: 'CL-0001',
  name: 'Drift Logistics',
  problem: 'A private limited company whose name does not say so.',
  current: 'Drift Logistics',
  proposed: 'Drift Logistics Private Limited',
  href: '/entities/e1',
  canApply: true,
};

describe('CM-9 data check', () => {
  it('opens a check, ticks a client and applies the fix', async () => {
    apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === 'POST')
        return Promise.resolve([{ entityId: 'e1', ok: true, message: 'done' }]);
      if (path === '/entities/data-checks')
        return Promise.resolve(
          DATA_CHECKS.map((check) => ({ check, count: check === 'company_name' ? 1 : 0 })),
        );
      return Promise.resolve({ items: [row], total: 1, limit: 50, offset: 0 });
    });
    render(wrap(<DataCheckView onOpenOffices={jest.fn()} />));

    await userEvent.click(await screen.findByText('Company name without company wording'));
    await userEvent.click(await screen.findByLabelText('Select Drift Logistics'));
    await userEvent.click(screen.getByRole('button', { name: 'Add “Private Limited” (1)' }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/entities/data-checks/company_name/apply', {
        method: 'POST',
        body: { entityIds: ['e1'] },
      }),
    );
    expect(toast).toHaveBeenCalledWith('1 fixed', 'success');
  });

  it('sums up partial failures', () => {
    expect(
      applySummary([
        { entityId: 'a', ok: true, message: '' },
        { entityId: 'b', ok: false, message: 'x' },
      ]),
    ).toBe('1 fixed · 1 not fixed');
  });
});
