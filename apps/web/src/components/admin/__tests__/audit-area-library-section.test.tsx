import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  AuditAreaLibraryAdminRow,
  AuditAreaLibraryAdminView,
  AuditAreaLibraryRelease,
} from '@hsdg/contracts';
import { AuditAreaLibrarySection } from '../audit-area-library-section';

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

const release = (x: Partial<AuditAreaLibraryRelease>): AuditAreaLibraryRelease => ({
  libraryVersion: 'dhvaj-gc-2026.2',
  status: 'released',
  basedOn: null,
  note: 'Seeded',
  areaCount: 1,
  activeCount: 1,
  releasedAt: '2026-09-01T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
  current: true,
  engagementsUsing: 4,
  ...x,
});

const row = (x: Partial<AuditAreaLibraryAdminRow>): AuditAreaLibraryAdminRow => ({
  id: 'a1',
  libraryVersion: 'dhvaj-gc-2026.2',
  areaCode: 'TRADE_REC',
  areaName: 'Trade receivables',
  areaType: 'balance_sheet',
  category: 'assets',
  frameworkProfile: 'both',
  industryProfile: 'general_corporate',
  conditionKey: null,
  defaultAssertions: ['TX_OCC'],
  nonAssertionWorkstream: false,
  defaultAttention: 'standard',
  relatedAuthorities: [],
  signalMappingTags: [],
  metricKeys: [],
  indicatorTags: [],
  aliases: ['Debtors'],
  effectiveFrom: '2000-01-01',
  effectiveTo: null,
  active: true,
  sortOrder: 10,
  ...x,
});

const base = {
  assertionMaster: [
    { id: 'TX_OCC', group: 'transactions', label: 'Occurrence' },
    { id: 'TX_COMP', group: 'transactions', label: 'Completeness' },
  ],
  industryProfiles: [{ key: 'general_corporate', label: 'General corporate' }],
} as Pick<AuditAreaLibraryAdminView, 'assertionMaster' | 'industryProfiles'>;

const RELEASED: AuditAreaLibraryAdminView = {
  ...base,
  releases: [release({})],
  selected: release({}),
  rows: [row({})],
};

const draft = release({
  libraryVersion: 'dhvaj-gc-2026.3',
  status: 'draft',
  basedOn: 'dhvaj-gc-2026.2',
  note: 'Add derivatives',
  releasedAt: null,
  current: false,
  engagementsUsing: 0,
});
const DRAFT: AuditAreaLibraryAdminView = {
  ...base,
  releases: [draft, release({})],
  selected: draft,
  rows: [row({ libraryVersion: 'dhvaj-gc-2026.3' })],
};

const serve = (view: AuditAreaLibraryAdminView) =>
  apiFetch.mockImplementation(() => Promise.resolve(view));

beforeEach(() => apiFetch.mockReset());

describe('03.5 Audit Area Library administration', () => {
  it('a released version is read-only and a draft starts only with a note', async () => {
    serve(RELEASED);
    const user = userEvent.setup();
    render(wrap(<AuditAreaLibrarySection />));
    expect(await screen.findByText('Current')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish draft' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /TRADE_REC/ }));
    expect(screen.getByDisplayValue('Trade receivables')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save area' })).not.toBeInTheDocument();

    const start = screen.getByRole('button', { name: 'Start draft' });
    await user.type(screen.getByLabelText(/Next library version/), 'dhvaj-gc-2026.3');
    expect(start).toBeDisabled();
    await user.type(screen.getByLabelText(/What this version changes/), 'Add derivatives');
    serve(DRAFT);
    await user.click(start);
    expect(apiFetch).toHaveBeenCalledWith('/audit-area-library/drafts', {
      method: 'POST',
      body: { libraryVersion: 'dhvaj-gc-2026.3', note: 'Add derivatives' },
    });
    expect(await screen.findByRole('button', { name: 'Publish draft' })).toBeInTheDocument();
  });

  it('publishing asks for an inline confirmation first', async () => {
    serve(DRAFT);
    const user = userEvent.setup();
    render(wrap(<AuditAreaLibrarySection />));
    await user.click(await screen.findByRole('button', { name: 'Publish draft' }));
    expect(apiFetch).toHaveBeenCalledTimes(1); // only the initial load
    expect(screen.getByText(/can no longer be edited/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(apiFetch).toHaveBeenCalledWith('/audit-area-library/dhvaj-gc-2026.3/publish', {
      method: 'POST',
      body: {},
    });
  });

  it('saves a draft area; list fields split on commas, not spaces', async () => {
    serve(DRAFT);
    const user = userEvent.setup();
    render(wrap(<AuditAreaLibrarySection />));
    const item = (await screen.findByRole('button', { name: /TRADE_REC/ })).closest('li')!;
    await user.click(within(item).getByRole('button', { name: /TRADE_REC/ }));
    const aliases = within(item).getByLabelText(/Aliases/);
    await user.clear(aliases);
    await user.type(aliases, 'Sundry debtors, Book debts,Sundry debtors');
    await user.click(within(item).getByLabelText('Completeness'));
    await user.click(within(item).getByRole('button', { name: 'Save area' }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/audit-area-library/dhvaj-gc-2026.3/areas/a1',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          areaCode: 'TRADE_REC',
          aliases: ['Sundry debtors', 'Book debts'],
          defaultAssertions: ['TX_OCC', 'TX_COMP'],
        }),
      }),
    );
    const body = apiFetch.mock.calls.find((c) => String(c[0]).endsWith('/areas/a1'))![1]
      .body as Record<string, unknown>;
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('libraryVersion');
  });

  it('a draft offers a new area; it needs a code and a name', async () => {
    serve(DRAFT);
    const user = userEvent.setup();
    render(wrap(<AuditAreaLibrarySection />));
    await user.click(await screen.findByRole('button', { name: /Add an Audit Area to/ }));
    const add = screen.getByRole('button', { name: 'Add area' });
    expect(add).toBeDisabled();
    await user.type(screen.getAllByLabelText(/Area code/)[0]!, 'deriv');
    await user.type(screen.getAllByLabelText(/Area name/)[0]!, 'Derivatives');
    expect(screen.getByDisplayValue('DERIV')).toBeInTheDocument();
    await user.click(add);
    expect(apiFetch).toHaveBeenCalledWith(
      '/audit-area-library/dhvaj-gc-2026.3/areas',
      expect.objectContaining({
        body: expect.objectContaining({
          areaCode: 'DERIV',
          areaName: 'Derivatives',
          sortOrder: 20,
        }),
      }),
    );
  });
});
