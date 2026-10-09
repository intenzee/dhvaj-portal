import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ReportingFrameworkCard } from '../reporting-framework-card';

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
    url.endsWith('/schedule-iii')
      ? Promise.resolve([
          {
            workflowInstanceId: 'wf1',
            upstreamReady: false,
            assessment: { systemOutcome: 'division_ii' },
            detail: { cashFlowRequired: true, cashFlowExemptionReason: null },
          },
        ])
      : url.endsWith('/financial-reporting')
        ? Promise.resolve([
            {
              workflowInstanceId: 'wf1',
              assessment: {
                state: 'system_suggested_applicable',
                systemOutcome: 'ind_as',
                systemBasis: null,
                version: 2,
              },
              baseFacts: {
                auditPeriodStart: '2024-04-01',
                listingStatus: 'unlisted',
                isCompany: true,
                isPrivateCompany: true,
                specialEntityTypes: [],
                priorFramework: 'ind_as',
              },
              capturedFacts: {
                isListedOnSmeExchange: false,
                priorIndAs: true,
                voluntaryIndAs: false,
                groupTriggersIndAs: false,
              },
              masterFacts: [
                {
                  label: 'Ind AS in a prior year',
                  value: 'Yes — FY 2023-24 file concluded Ind AS',
                  source: 'Last year’s audit file',
                },
              ],
            },
          ])
        : Promise.resolve({ filled: [] }),
  );
});

describe('02.2 reporting framework card', () => {
  it('shows last year’s Ind AS with its source and the suggestion', async () => {
    render(wrap(<ReportingFrameworkCard engagementId="e1" />));
    expect(await screen.findByText('Yes — FY 2023-24 file concluded Ind AS')).toBeInTheDocument();
    expect(screen.getByText(/Suggested: Ind as/i)).toBeInTheDocument();
    expect(
      await screen.findByText(/02.3 Schedule III: Division ii \(provisional\)/i),
    ).toBeInTheDocument();
  });

  it('fills from the portal and opens the 02.2 workspace in place', async () => {
    const user = userEvent.setup();
    render(wrap(<ReportingFrameworkCard engagementId="e1" />));
    await user.click(await screen.findByRole('button', { name: /Fill from client master/ }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/financial-reporting/fill-from-master',
      { method: 'POST', body: {} },
    );
    expect(screen.queryByTestId('frf-workspace')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Open the 02.2 workspace/ }));
    expect(screen.getByTestId('frf-workspace')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /02.2B Voluntary adoption/ }));
    await user.selectOptions(screen.getByLabelText(/FRF-03/), 'yes');
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/financial-reporting/facts',
      { method: 'POST', body: { voluntaryAnswer: 'yes', version: 2 } },
    );
  });
});
