import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { RulesLibrarySection } from '../rules-library-section';

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

const RULE = {
  id: 'r1',
  code: 'FRF_INDAS_CORP_UNLISTED_P2',
  areaKey: 'financial_reporting',
  entityClass: 'corporate_unlisted_p2',
  criterion: 'net_worth',
  operator: '>=',
  unit: 'inr',
  measurementBasis: null,
  isActive: true,
  version: 4,
  createdAt: '2026-10-09',
  updatedAt: '2026-10-09',
  versions: [
    {
      id: 'v1',
      auditRuleId: 'r1',
      version: 1,
      effectiveFrom: '2017-04-01',
      effectiveTo: null,
      threshold: 2_500_000_000,
      thresholdHigh: null,
      condition: { measurementBaseDate: '2016-03-31', firstMeetsAppliesFrom: 'next_year' },
      outcome: 'ind_as',
      authorityProvisionId: 'p1',
      authorityProvisionCode: 'INDAS_RULE_4',
      guidanceReference: null,
      notes: 'Rule 4(1)(iii)',
      createdAt: '2026-10-09',
      bands: [],
      supersededFrom: null,
    },
  ],
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return Promise.resolve(RULE);
    if (url === '/audit-rules/provisions')
      return Promise.resolve([
        {
          id: 'p1',
          code: 'INDAS_RULE_4',
          title: 'Rule 4',
          provisionNumber: 'Rule 4',
          effectiveFrom: '2015-02-16',
          effectiveTo: null,
        },
      ]);
    return Promise.resolve([RULE]);
  });
});

describe('Rules Library administration', () => {
  it('lists rules by area with the limit in force and their history', async () => {
    const user = userEvent.setup();
    render(wrap(<RulesLibrarySection />));
    expect(await screen.findByText('FRF_INDAS_CORP_UNLISTED_P2')).toBeInTheDocument();
    expect(screen.getByText('financial_reporting')).toBeInTheDocument();
    expect(screen.getByText('>= ₹250 crore')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /FRF_INDAS_CORP_UNLISTED_P2/ }));
    expect(screen.getByText('INDAS_RULE_4')).toBeInTheDocument();
    expect(screen.getByText('Rule 4(1)(iii)')).toBeInTheDocument();
  });

  it('appends a version in crore, carrying the condition and provision forward', async () => {
    const user = userEvent.setup();
    render(wrap(<RulesLibrarySection />));
    await user.click(await screen.findByRole('button', { name: /FRF_INDAS_CORP_UNLISTED_P2/ }));
    const add = screen.getByRole('button', { name: 'Add version' });
    expect(add).toBeDisabled();

    // A date not after the latest version is refused — history is never rewritten.
    const date = screen.getByLabelText(/Applies to periods starting/);
    await user.type(date, '2017-04-01');
    expect(screen.getByText(/Must be after/)).toBeInTheDocument();
    await user.clear(date);
    await user.type(date, '2090-04-01');

    const limit = screen.getByLabelText(/Limit \(>=\) \(₹ crore\)/);
    await user.clear(limit);
    await user.type(limit, '400');
    await user.type(screen.getByLabelText(/Reason for the change/), 'MCA notification G.S.R. 1(E)');
    expect(add).toBeEnabled();
    await user.click(add);
    expect(apiFetch).toHaveBeenCalledWith('/audit-rules/r1/versions', {
      method: 'POST',
      body: {
        effectiveFrom: '2090-04-01',
        threshold: 4_000_000_000,
        thresholdHigh: null,
        condition: { measurementBaseDate: '2016-03-31', firstMeetsAppliesFrom: 'next_year' },
        outcome: 'ind_as',
        authorityProvisionId: 'p1',
        notes: 'MCA notification G.S.R. 1(E)',
        version: 4,
      },
    });
  });

  it('rejects an invalid condition', async () => {
    const user = userEvent.setup();
    render(wrap(<RulesLibrarySection />));
    await user.click(await screen.findByRole('button', { name: /FRF_INDAS_CORP_UNLISTED_P2/ }));
    const cond = screen.getByLabelText(/Condition \(JSON\)/);
    await user.clear(cond);
    await user.type(cond, '[[1');
    expect(screen.getByText('The condition is not valid JSON.')).toBeInTheDocument();
  });
});
