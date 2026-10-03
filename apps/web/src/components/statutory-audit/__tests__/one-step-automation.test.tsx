import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { FrameworkPanel } from '../framework-panel';
import { PbcPanel } from '../pbc-panel';
import { RiskPanel } from '../risk-panel';

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

const area = (id: string, state: string, systemSuggestion: string | null) => ({
  id,
  areaKey: id,
  title: `Area ${id}`,
  kind: 'applicability',
  state,
  systemSuggestion,
  systemBasis: 'From the client master.',
  conclusion: null,
  isOverridden: false,
  basis: null,
  impact: null,
  decidedByName: null,
  decidedAt: null,
  sortOrder: 1,
  version: 1,
  evidence: [],
});

beforeEach(() => apiFetch.mockReset());

describe('one-step automation for the team', () => {
  it('accepts every waiting framework suggestion in one click', async () => {
    apiFetch.mockImplementation((url: string) => {
      if (
        url.endsWith('/profile') ||
        url.endsWith('/caro') ||
        url.endsWith('/consolidation') ||
        url.endsWith('/icfr') ||
        url.endsWith('/other-reporting') ||
        url.endsWith('/financial-reporting') ||
        url.endsWith('/schedule-iii')
      )
        return Promise.resolve([]);
      if (url.endsWith('/accept-suggestions')) return Promise.resolve({});
      return Promise.resolve([
        {
          workflowInstanceId: 'wf1',
          approval: null,
          undecidedCount: 3,
          assessments: [
            area('caro', 'system_suggested_applicable', 'applicable'),
            area('csr', 'system_suggested_not_applicable', 'not_applicable'),
            area('cost_records', 'professional_judgement_required', null),
          ],
        },
      ]);
    });
    const user = userEvent.setup();
    render(wrap(<FrameworkPanel engagementId="e1" />));
    await user.click(await screen.findByRole('button', { name: 'Accept 2 suggestions' }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/framework/accept-suggestions',
      { method: 'POST', body: {} },
    );
  });

  it('opens the PBC tracker before Planning is approved and adds the standard requests', async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url.endsWith('/work-areas')) return Promise.resolve([]);
      if (url.endsWith('/standard-list')) return Promise.resolve({ added: 12, tracker: {} });
      return Promise.resolve([
        { workflowInstanceId: 'wf1', planningApproved: false, overdueCount: 0, items: [] },
      ]);
    });
    const user = userEvent.setup();
    render(wrap(<PbcPanel engagementId="e1" />));
    await user.click(await screen.findByRole('button', { name: /Add standard requests/ }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/pbc/standard-list', {
      method: 'POST',
      body: {},
    });
    expect(screen.queryByText(/Approve Planning/)).not.toBeInTheDocument();
  });

  it('opens the risk register before Planning is approved', async () => {
    apiFetch.mockResolvedValue([
      {
        workflowInstanceId: 'wf1',
        planningApproved: false,
        significantRisksWithoutResponse: 0,
        risks: [],
      },
    ]);
    render(wrap(<RiskPanel engagementId="e1" team={[]} />));
    expect(await screen.findByRole('button', { name: /Add risk/ })).toBeInTheDocument();
  });
});
