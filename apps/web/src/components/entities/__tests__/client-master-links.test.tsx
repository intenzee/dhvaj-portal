import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import EntityDetailPage from '@/app/(portal)/entities/[id]/page';
import { MasterFactList, fixHref } from '@/components/statutory-audit/master-fact-list';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
jest.mock('@/lib/principal', () => ({ can: () => true }));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));

let search = '';
const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'ent1' }),
  useRouter: () => ({ push: jest.fn(), replace }),
  useSearchParams: () => new URLSearchParams(search),
}));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const entity = {
  id: 'ent1',
  entityCode: 'ENT00001',
  legalName: 'Acme Pvt Ltd',
  typeName: 'Private Limited Company',
  typeSlug: 'private_limited',
  typeCategory: 'company',
  officeCode: 'NORTH',
  status: 'active',
  legalStatus: null,
  listingStatus: 'unlisted',
  regulatoryProfileStatus: 'incomplete',
  pan: null,
  displayName: null,
  tradeName: null,
  countryOfIncorporation: 'India',
  currentAccountingFramework: 'as',
  incorporationDate: null,
  roc: null,
  authorisedCapital: null,
  paidUpCapital: null,
  businessDescription: null,
  version: 3,
  activities: {
    manufacturing: false,
    trading: false,
    services: true,
    import: false,
    export: false,
    ecommerce: false,
    regulated: false,
  },
  registrations: [],
  contacts: [],
  financialProfiles: [
    {
      id: 'fp1',
      financialYear: '2024-25',
      turnover: 5000000,
      revenue: 4800000,
      netWorth: 900000,
      netProfit: null,
      totalBorrowings: null,
      paidUpCapital: 100000,
      source: 'provisional_financials',
      verified: false,
      isCurrent: true,
      supersedesId: null,
      createdAt: '2026-01-01',
    },
  ],
  addresses: [],
  relationships: [],
  businessActivities: [],
  listings: [],
  regulatoryAttributes: [],
  missingInfo: [
    {
      code: 'legal_status',
      label: 'Legal/operational status not assessed',
      severity: 'recommended',
    },
    { code: 'cin', label: 'CIN not recorded for a company', severity: 'recommended' },
  ],
};

beforeAll(() => {
  // jsdom has no layout; the page scrolls the opened section into view.
  Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  apiFetch.mockReset();
  replace.mockReset();
  apiFetch.mockImplementation((url: string) => {
    if (url === '/entities/ent1') return Promise.resolve(entity);
    if (url.startsWith('/engagements')) return Promise.resolve({ items: [], total: 0 });
    if (url.startsWith('/credentials'))
      return Promise.resolve({ vaultReady: true, items: [], recentAccess: [] });
    if (url.startsWith('/client-returns'))
      return Promise.resolve({ periods: [], forms: [], lines: [] });
    return Promise.resolve([]);
  });
});

describe('Client 360 — add what is missing from where it is shown', () => {
  it('opens the figures form straight away from an audit-file link, on the audit year', async () => {
    search = 'edit=financials&fy=2024-25';
    render(wrap(<EntityDetailPage />));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Financial figures')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('2024-25')).toBeInTheDocument();
    // Starts from every figure already on record, so a save never blanks one.
    expect(within(dialog).getByDisplayValue('4800000')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('900000')).toBeInTheDocument();
  });

  it('turns each missing item into a button that opens its form', async () => {
    search = '';
    const user = userEvent.setup();
    render(wrap(<EntityDetailPage />));
    await user.click(await screen.findByRole('button', { name: /status not assessed/ }));
    const details = await screen.findByRole('dialog');
    expect(within(details).getByText('Legal / operational status')).toBeInTheDocument();
    await user.click(within(details).getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: /CIN not recorded/ }));
    expect(
      within(await screen.findByRole('dialog')).getByRole('heading', { name: 'Add registration' }),
    ).toBeInTheDocument();
  });

  it('saves the year’s figures with the values already on record', async () => {
    search = 'edit=financials&fy=2024-25';
    const user = userEvent.setup();
    render(wrap(<EntityDetailPage />));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save figures' }));
    expect(apiFetch).toHaveBeenCalledWith('/entities/ent1/financial-profiles', {
      method: 'POST',
      body: {
        financialYear: '2024-25',
        source: 'provisional_financials',
        revenue: 4800000,
        turnover: 5000000,
        paidUpCapital: 100000,
        netWorth: 900000,
      },
    });
  });
});

describe('audit-file facts link to the field that fixes them', () => {
  it('links a missing fact to its client-master form, on the audit year', () => {
    const fix = { entityId: 'ent1', section: 'financials' as const, financialYear: '2024-25' };
    expect(fixHref(fix)).toBe('/entities/ent1?edit=financials&fy=2024-25');
    render(
      <MasterFactList
        facts={[
          { label: 'Net worth', value: null, source: 'Entity master', fix },
          {
            label: 'Listing',
            value: 'unlisted',
            source: 'Entity master',
            fix: { entityId: 'ent1', section: 'listings' },
          },
          { label: 'Financial year', value: '2024-25', source: 'Engagement' },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: /Add on client master/ })).toHaveAttribute(
      'href',
      '/entities/ent1?edit=financials&fy=2024-25',
    );
    expect(screen.getByRole('link', { name: /Edit/ })).toHaveAttribute(
      'href',
      '/entities/ent1?edit=listings',
    );
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});

describe('Client 360 — a client merged into another', () => {
  it('points to the kept client and offers nothing to edit', async () => {
    search = '';
    apiFetch.mockImplementation((url: string) => {
      if (url === '/entities/ent1')
        return Promise.resolve({
          ...entity,
          status: 'archived',
          mergedInto: {
            id: 'ent2',
            entityCode: 'ENT00002',
            legalName: 'Acme Private Limited',
            mergedAt: '2026-10-24T09:00:00Z',
          },
        });
      if (url.startsWith('/engagements')) return Promise.resolve({ items: [], total: 0 });
      if (url.startsWith('/credentials'))
        return Promise.resolve({ vaultReady: true, items: [], recentAccess: [] });
      if (url.startsWith('/client-returns'))
        return Promise.resolve({ periods: [], forms: [], lines: [] });
      return Promise.resolve([]);
    });
    render(wrap(<EntityDetailPage />));
    expect(
      await screen.findByRole('link', { name: 'Acme Private Limited (ENT00002)' }),
    ).toHaveAttribute('href', '/entities/ent2');
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Merge with another client/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /CIN not recorded/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Add$/ })).not.toBeInTheDocument();
    // Its logins moved to the kept client; none are added here.
    expect(screen.queryByText(/Add .* login/)).not.toBeInTheDocument();
  });

  it('offers the merge on a live client', async () => {
    search = '';
    render(wrap(<EntityDetailPage />));
    expect(
      await screen.findByRole('button', { name: /Merge with another client/ }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Add Income-tax \(PAN\) login/)).toBeInTheDocument();
  });
});
