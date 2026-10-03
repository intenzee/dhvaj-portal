import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ReportingFactsCard } from '../reporting-facts-card';

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
  systemBasis: null,
  version: 5,
});

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((url: string) => {
    if (url.endsWith('/icfr'))
      return Promise.resolve([
        {
          workflowInstanceId: 'wf1',
          assessment: assessment('applicable'),
          capturedFacts: { peakCoveredBorrowings: null, filingDefault: true },
          masterFacts: [
            {
              label: 'ROC filing record (§92 / §137)',
              value: 'Default — AOC-4 due 2024-10-30 not filed',
              source: 'Compliance calendar — AOC-4 / MGT-7',
            },
          ],
        },
      ]);
    if (url.endsWith('/other-reporting'))
      return Promise.resolve([
        {
          workflowInstanceId: 'wf1',
          assessment: assessment('applicable'),
          capturedFacts: {
            softwareSystems: [
              { name: 'Tally Prime', hasAuditTrailFeature: true, auditTrailOperatedAllYear: false },
            ],
          },
          masterFacts: [
            {
              label: 'Managing / whole-time director',
              value: 'Vikram Shah (Managing Director)',
              source: 'Client master — contacts',
            },
          ],
        },
      ]);
    if (url.endsWith('/fill-from-master')) return Promise.resolve({ filled: [] });
    return Promise.resolve({});
  });
});

describe('ICFR & other reporting card', () => {
  it('shows the filing record and directors with their source', async () => {
    render(wrap(<ReportingFactsCard engagementId="e1" />));
    expect(await screen.findByText(/AOC-4 due 2024-10-30 not filed/)).toBeInTheDocument();
    expect(screen.getByText('Vikram Shah (Managing Director)')).toBeInTheDocument();
  });

  it('fills both sections from the portal in one click', async () => {
    const user = userEvent.setup();
    render(wrap(<ReportingFactsCard engagementId="e1" />));
    await user.click(await screen.findByRole('button', { name: /Fill from client master/ }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/icfr/fill-from-master',
      { method: 'POST', body: {} },
    );
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/other-reporting/fill-from-master',
      { method: 'POST', body: {} },
    );
  });

  it('confirms a carried-forward audit trail for this year with one tick', async () => {
    const user = userEvent.setup();
    render(wrap(<ReportingFactsCard engagementId="e1" />));
    await user.click(
      await screen.findByRole('checkbox', { name: /Audit trail ran all this year/ }),
    );
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/other-reporting/facts',
      {
        method: 'POST',
        body: {
          softwareSystems: [
            { name: 'Tally Prime', hasAuditTrailFeature: true, auditTrailOperatedAllYear: true },
          ],
          version: 5,
        },
      },
    );
  });
});
