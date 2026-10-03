import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { EntityProfileCard } from '../entity-profile-card';

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

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((url: string) =>
    url.endsWith('/fill-from-master')
      ? Promise.resolve({ filled: [] })
      : Promise.resolve([
          {
            workflowInstanceId: 'wf1',
            state: 'draft',
            initialAudit: false,
            specialEntityTypes: ['nbfc', 'section_8'],
            saTriggers: [],
            smallCompany: { outcome: 'not_applicable', basis: 'Basis.' },
            missingFacts: [],
            masterFacts: [
              {
                label: 'Special entity type(s)',
                value: 'NBFC (Industry: NBFC)',
                source: 'Client master — industries & regulatory facts',
              },
            ],
          },
        ]),
  );
});

describe('02.1 profile card', () => {
  it('shows the special entity types the client master gave, with the evidence', async () => {
    render(wrap(<EntityProfileCard engagementId="e1" />));
    expect(await screen.findByText('NBFC (Industry: NBFC)')).toBeInTheDocument();
    expect(screen.getByText('Section 8 company')).toBeInTheDocument();
  });

  it('refills the special entity types from the client master', async () => {
    const user = userEvent.setup();
    render(wrap(<EntityProfileCard engagementId="e1" />));
    await user.click(await screen.findByRole('button', { name: /Fill from client master/ }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/profile/fill-from-master',
      { method: 'POST', body: {} },
    );
  });
});
