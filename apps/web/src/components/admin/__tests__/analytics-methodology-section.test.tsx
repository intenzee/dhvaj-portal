import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AnalyticsLibrary } from '@hsdg/contracts';
import { AnalyticsMethodologySection } from '../analytics-methodology-section';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const v = {
  version: 1,
  effectiveFrom: '2000-01-01',
  effectiveTo: null,
  active: true,
  methodologyVersion: 'dhvaj-analytics-2026.1',
  changeNote: 'v1 — moved from the hard-coded analytics engine.',
  createdByName: null,
  createdAt: '2026-10-12T00:00:00.000Z',
};

const LIBRARY: AnalyticsLibrary = {
  metrics: [
    {
      ...v,
      id: 'm1',
      metricKey: 'revenue',
      label: 'Revenue from operations',
      valueType: 'amount',
      core: true,
      note: 'Core',
      appliesTo: [],
      sortOrder: 10,
    },
    {
      ...v,
      id: 'm2',
      metricKey: 'capital_adequacy',
      label: 'Capital adequacy ratio (CRAR %)',
      valueType: 'percent',
      core: false,
      note: 'Regulatory metric',
      appliesTo: ['nbfc'],
      sortOrder: 20,
    },
  ],
  profiles: [
    {
      ...v,
      id: 'p1',
      profileKey: 'nbfc',
      label: 'NBFC / financial services',
      description: '',
      subIndustries: ['Housing finance'],
      considerations: ['RBI prudential norms'],
      averageBalances: true,
      debtMetrics: ['total_borrowings'],
      financeCostBasis: 'average',
      inventoryCostBases: ['cost_of_sales'],
      payableCostBases: ['purchases'],
      inventoryTrendFallback: null,
    },
  ],
  rules: [
    {
      ...v,
      id: 'r1',
      ruleCode: 'PAR-001',
      ruleKey: 'movement_revenue',
      name: 'Revenue movement',
      kind: 'movement',
      appliesTo: [],
      excludedFor: [],
      requiredMetrics: ['revenue'],
      formula: '(CY − PY) / PY × 100',
      definition: { kind: 'movement', metric: 'revenue' },
      parameterType: 'percent',
      parameterValue: 25,
      enhancedAt: 50,
      immediateAt: null,
      minDataStatus: [],
      minSourceTypes: [],
      signalWording: '{{label}} moved {{change}}.',
      whyMayMatter: 'A large movement may reflect changes in the business to understand.',
      affectedAreas: ['Revenue'],
      suggestedAttention: 'standard',
    },
    {
      ...v,
      id: 'r2',
      ruleCode: 'PAR-002',
      ruleKey: 'nbfc_crar_below_level',
      name: 'Capital adequacy below level',
      kind: 'threshold',
      appliesTo: ['nbfc'],
      excludedFor: [],
      requiredMetrics: ['capital_adequacy'],
      formula: 'CRAR < 15%',
      definition: { kind: 'threshold', metric: 'capital_adequacy', op: 'lt' },
      parameterType: 'absolute',
      parameterValue: 15,
      enhancedAt: null,
      immediateAt: null,
      minDataStatus: [],
      minSourceTypes: [],
      signalWording: '{{label}} is {{value}}.',
      whyMayMatter: 'Regulatory capital below the level may affect going concern.',
      affectedAreas: ['Borrowings'],
      suggestedAttention: 'immediate_partner',
    },
  ],
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(
    (_url: string, init?: { method?: string; body?: { ruleCode: string } }) =>
      init?.method === 'POST'
        ? Promise.resolve({ ...LIBRARY.rules[0], version: 2 })
        : Promise.resolve(LIBRARY),
  );
});

describe('Analytics Methodology Library administration', () => {
  it('lists rules with their parameters, profile scope and IPA capability', async () => {
    const user = userEvent.setup();
    render(wrap(<AnalyticsMethodologySection />));
    expect(await screen.findByText('Revenue movement')).toBeInTheDocument();
    expect(screen.getByText('Can suggest IPA')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /PAR-001/ }));
    expect(screen.getByText(/% movement 25 · Enhanced ≥ 50/)).toBeInTheDocument();
    expect(screen.getByText('Every profile')).toBeInTheDocument();
  });

  it('appends a rule version with a new attention parameter', async () => {
    const user = userEvent.setup();
    render(wrap(<AnalyticsMethodologySection />));
    await user.click(await screen.findByRole('button', { name: /PAR-001/ }));
    const add = screen.getByRole('button', { name: 'Add version' });
    expect(add).toBeDisabled(); // a reason is required
    const param = screen.getByRole('spinbutton', { name: /^Attention parameter/ });
    await user.clear(param);
    await user.type(param, '20');
    await user.type(
      screen.getByLabelText(/Reason for this version/),
      'Lower the movement parameter',
    );
    await user.click(add);
    expect(apiFetch).toHaveBeenCalledWith(
      '/planning-analytics-library/rules',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          ruleCode: 'PAR-001',
          kind: 'movement',
          parameterValue: 20,
          enhancedAt: 50,
        }),
      }),
    );
  });

  it('blocks non-neutral wording before it reaches the API', async () => {
    const user = userEvent.setup();
    render(wrap(<AnalyticsMethodologySection />));
    await user.click(await screen.findByRole('button', { name: /PAR-001/ }));
    const why = screen.getByLabelText(/Why it may matter/);
    await user.clear(why);
    await user.type(why, 'This indicates a material misstatement.');
    await user.type(screen.getByLabelText(/Reason for this version/), 'Reword');
    const add = screen.getByRole('button', { name: 'Add version' });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute('title', expect.stringMatching(/neutral/));
  });

  it('shows profiles with their sector rules, debt definition and finance-cost basis', async () => {
    const user = userEvent.setup();
    render(wrap(<AnalyticsMethodologySection />));
    await user.click(await screen.findByRole('button', { name: /Industry profiles/ }));
    expect(screen.getByText('+1 sector rules')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /NBFC \/ financial services/ }));
    expect(screen.getByText('average debt')).toBeInTheDocument();
    expect(screen.getByText(/fallback: none \(not evaluated\)/)).toBeInTheDocument();
  });
});
