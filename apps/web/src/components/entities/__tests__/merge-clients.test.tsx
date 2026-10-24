import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { DuplicatePair, MergeClientsResult, MergePreview } from '@hsdg/contracts';
import EntitiesPage from '@/app/(portal)/entities/page';
import { MergeClientsModal, duplicateConflictOf } from '../merge-clients-modal';
import { AddRegistrationModal } from '../entity-actions';
import { MergedIntoBanner, PossibleDuplicateBanner } from '../duplicate-clients';
import { ClientMaster } from '../client-master';
import { ApiError } from '@/lib/api';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly body?: Record<string, unknown>,
    ) {
      super(message);
    }
  }
  return { apiFetch: (...args: unknown[]) => apiFetch(...args), ApiError };
});
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
jest.mock('@/lib/principal', () => ({ can: () => true }));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/entities',
}));

jest.setTimeout(20_000);

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const firm = {
  id: 'firm',
  entityCode: 'ENT00011',
  legalName: '3Aces Technologies - Firm',
  pan: 'AAKFT1234Q',
  typeName: 'Partnership firm',
  officeCode: 'NORTH',
  status: 'active',
  gstins: ['06AAKFT1234Q1Z5'],
  counts: { engagements: 1, registrations: 2 },
};
const pvt = {
  id: 'pvt',
  entityCode: 'ENT00042',
  legalName: '3Aces Technologies Private Limited',
  pan: 'AAKFT1234Q',
  typeName: 'Private limited company',
  officeCode: 'NORTH',
  status: 'active',
  gstins: [],
  counts: { engagements: 3 },
};

/** The preview for keep → drop, recommending the private limited company. */
function previewOf(keepId: string): MergePreview {
  const [keep, drop] = keepId === 'pvt' ? [pvt, firm] : [firm, pvt];
  return {
    keep,
    drop,
    verdict: 'same',
    reasons: ['Same PAN AAKFT1234Q'],
    recommendedKeepId: 'pvt',
    fields: [{ field: 'trade_name', label: 'Trade name', keep: null, drop: '3Aces' }],
    engagements: [
      {
        id: 'g1',
        code: 'ENG-0007',
        kind: 'compliance',
        label: 'Compliance 2025-26',
        status: 'active',
        action: 'fold',
        reason: 'Its filings join ENG-0002',
      },
    ],
    warnings: ['2 invoices move to the kept client'],
    blockers: [],
  };
}

const result: MergeClientsResult = {
  keptId: 'pvt',
  keptCode: 'ENT00042',
  archivedId: 'firm',
  archivedCode: 'ENT00011',
  movedEngagements: 0,
  folded: { from: 'ENG-0007', into: 'ENG-0002', filings: 4, tasks: 2, filingsLeft: 1 },
  counts: { registrations: 2, invoicesLeft: 1 },
  stayed: [{ kind: 'engagement', code: 'ENG-0009', reason: 'Signed off' }],
};

function routePreview(path: string): Promise<unknown> | undefined {
  const m = /^\/entities\/(\w+)\/merge-preview\?with=(\w+)$/.exec(path);
  return m ? Promise.resolve(previewOf(m[1]!)) : undefined;
}

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
  push.mockReset();
});

describe('MergeClientsModal', () => {
  it('keeps the recommended client, walks the three steps and merges with the chosen values', async () => {
    apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST') return Promise.resolve(result);
      return routePreview(path) ?? Promise.reject(new Error(`unexpected ${path}`));
    });
    const onMerged = jest.fn();
    render(
      wrap(
        <MergeClientsModal clientIds={['firm', 'pvt']} onClose={jest.fn()} onMerged={onMerged} />,
      ),
    );

    // Asked firm → pvt; the API recommends pvt, so the popup flips to keep it.
    const keep = await screen.findByRole('region', { name: 'Client to keep' });
    expect(within(keep).getByText(pvt.legalName)).toBeInTheDocument();
    expect(within(keep).getByText('Recommended')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/entities/pvt/merge-preview?with=firm');
    expect(screen.getByText('Same client')).toBeInTheDocument();
    expect(screen.getByText('Same PAN AAKFT1234Q')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    // Step 2: take the archived client's trade name.
    await userEvent.click(screen.getByRole('radio', { name: /3Aces from ENT00011/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Step 3: the plan.
    expect(screen.getByText('Folds in')).toBeInTheDocument();
    expect(screen.getByText('Its filings join ENG-0002')).toBeInTheDocument();
    expect(screen.getByText('2 invoices move to the kept client')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Merge into ENT00042' }));

    expect(apiFetch).toHaveBeenCalledWith('/entities/pvt/merge', {
      method: 'POST',
      body: { dropId: 'firm', take: ['trade_name'] },
    });
    expect(await screen.findByText(/ENT00011 is merged into ENT00042/)).toBeInTheDocument();
    expect(screen.getByText(/ENG-0009/)).toHaveTextContent('ENG-0009: Signed off');
    expect(screen.getByText('2 registrations moved.')).toBeInTheDocument();
    expect(screen.getByText('1 invoice')).toBeInTheDocument();
    expect(screen.queryByText(/left moved/)).not.toBeInTheDocument();
    // The pages behind the popup refresh only once the summary is closed.
    expect(onMerged).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Close', { selector: 'button' }));
    expect(onMerged).toHaveBeenCalledWith(result);
  });

  it('swaps which client is kept by asking for the preview the other way round', async () => {
    apiFetch.mockImplementation((path: string) => routePreview(path));
    render(wrap(<MergeClientsModal clientIds={['pvt', 'firm']} onClose={jest.fn()} />));
    await screen.findByRole('region', { name: 'Client to keep' });

    await userEvent.click(screen.getByRole('button', { name: 'Swap which client to keep' }));
    const keep = await screen.findByRole('region', { name: 'Client to keep' });
    await waitFor(() => expect(within(keep).getByText(firm.legalName)).toBeInTheDocument());
    expect(apiFetch).toHaveBeenLastCalledWith('/entities/firm/merge-preview?with=pvt');
  });

  it('shows why two clients cannot be merged and offers no merge', async () => {
    apiFetch.mockResolvedValue({
      ...previewOf('pvt'),
      verdict: 'different',
      blockers: ['Different PANs: AAKFT1234Q and AABCT9876K'],
    });
    render(wrap(<MergeClientsModal clientIds={['pvt', 'firm']} onClose={jest.fn()} />));
    expect(await screen.findByText('These two cannot be merged')).toBeInTheDocument();
    expect(screen.getByText('Different PANs: AAKFT1234Q and AABCT9876K')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Merge into/ })).not.toBeInTheDocument();
  });
});

const conflict = {
  code: 'duplicate_client',
  message: 'GSTIN 06AAKFT1234Q1Z5 is already on ENT00011',
  entityId: 'pvt',
  holder: { id: 'firm', entityCode: 'ENT00011', legalName: firm.legalName, visible: true },
  identifier: { type: 'gstin', value: '06AAKFT1234Q1Z5' },
};

describe('a GSTIN already on another client', () => {
  it('reads the 409 body, and nothing else, as a duplicate client', () => {
    expect(duplicateConflictOf(new ApiError(409, 'x', conflict))).toEqual(conflict);
    expect(duplicateConflictOf(new ApiError(409, 'x', { rule: 'OTHER' }))).toBeNull();
    expect(duplicateConflictOf(new ApiError(400, 'x', conflict))).toBeNull();
    expect(duplicateConflictOf(new Error('x'))).toBeNull();
  });

  it('names the holder on the add-registration form, merges the two, then closes the form', async () => {
    apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === '/entities/pvt/merge') return Promise.resolve(result);
      if (opts?.method === 'POST')
        return Promise.reject(new ApiError(409, conflict.message, conflict));
      return routePreview(path);
    });
    const onClose = jest.fn();
    render(wrap(<AddRegistrationModal entityId="pvt" onClose={onClose} />));
    await userEvent.type(screen.getByPlaceholderText('27AAACA1234A1Z5'), '06AAKFT1234Q1Z5');
    await userEvent.click(screen.getByRole('button', { name: 'Add registration' }));

    expect(await screen.findByText(/is already on another client/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `${firm.legalName} (ENT00011)` })).toHaveAttribute(
      'href',
      '/entities/firm',
    );
    expect(toast).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Merge these clients/ }));
    expect(await screen.findByRole('region', { name: 'Client to keep' })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/entities/pvt/merge-preview?with=firm');

    // The identifier is now on this client: nothing is left to add.
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Merge into ENT00042' }));
    await screen.findByText(/ENT00011 is merged into ENT00042/);
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Close', { selector: 'button' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('offers no merge when the holder is in an office the person cannot open', async () => {
    const hidden = { ...conflict, holder: { ...conflict.holder, visible: false } };
    apiFetch.mockRejectedValue(new ApiError(409, conflict.message, hidden));
    render(wrap(<AddRegistrationModal entityId="pvt" onClose={jest.fn()} />));
    await userEvent.type(screen.getByPlaceholderText('27AAACA1234A1Z5'), '06AAKFT1234Q1Z5');
    await userEvent.click(screen.getByRole('button', { name: 'Add registration' }));

    expect(await screen.findByText(/in an office you cannot open/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /ENT00011/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Merge these clients/ })).not.toBeInTheDocument();
  });
});

const pair: DuplicatePair = {
  a: {
    id: 'firm',
    entityCode: 'ENT00011',
    legalName: firm.legalName,
    pan: firm.pan,
    officeCode: 'NORTH',
  },
  b: {
    id: 'pvt',
    entityCode: 'ENT00042',
    legalName: pvt.legalName,
    pan: pvt.pan,
    officeCode: 'NORTH',
  },
  verdict: 'same',
  reasons: ['Same PAN AAKFT1234Q'],
};

describe('possible duplicates', () => {
  it('lists the pairs on the Clients page; Review opens the merge, Dismiss forgets the pair', async () => {
    apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === '/entities/duplicates') return Promise.resolve([pair]);
      if (opts?.method === 'POST') return Promise.resolve(undefined);
      if (path.startsWith('/entities?'))
        return Promise.resolve({ items: [], total: 0, limit: 25, offset: 0 });
      return routePreview(path);
    });
    render(wrap(<EntitiesPage />));

    await userEvent.click(await screen.findByRole('tab', { name: 'Possible duplicates (1)' }));
    expect(screen.getByText('Same PAN AAKFT1234Q')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('dialog', { name: 'Merge clients' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss ENT00011 and ENT00042' }));
    expect(apiFetch).toHaveBeenCalledWith('/entities/duplicates/dismiss', {
      method: 'POST',
      body: { aId: 'firm', bId: 'pvt' },
    });
  });

  it("shows a banner on a listed client's page naming the other one", async () => {
    apiFetch.mockImplementation((path: string) =>
      path === '/entities/duplicates' ? Promise.resolve([pair]) : Promise.resolve(undefined),
    );
    render(wrap(<PossibleDuplicateBanner entityId="pvt" />));
    expect(await screen.findByText('Possible duplicate')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `${firm.legalName} (ENT00011)` })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Not the same client' }));
    expect(apiFetch).toHaveBeenCalledWith('/entities/duplicates/dismiss', {
      method: 'POST',
      body: { aId: 'firm', bId: 'pvt' },
    });
  });

  it('shows nothing for a client in no pair', async () => {
    apiFetch.mockResolvedValue([pair]);
    const { container } = render(wrap(<PossibleDuplicateBanner entityId="other" />));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('a merged client', () => {
  it('points to the client it was merged into', () => {
    render(
      <MergedIntoBanner
        mergedInto={{
          id: 'pvt',
          entityCode: 'ENT00042',
          legalName: pvt.legalName,
          mergedAt: '2026-10-24T09:00:00Z',
        }}
      />,
    );
    expect(screen.getByRole('link', { name: `${pvt.legalName} (ENT00042)` })).toHaveAttribute(
      'href',
      '/entities/pvt',
    );
  });
});

describe('client master import', () => {
  it('offers the merge on a row that meets two clients, and reads the file again after it', async () => {
    const row = {
      row: 4,
      name: '3Aces Technologies Pvt Ltd',
      action: 'update_client',
      entityId: 'pvt',
      entityCode: 'ENT00042',
      matchedBy: 'code',
      changes: [],
      engagement: null,
      logins: 0,
      warnings: [],
      error: null,
      duplicate: {
        entityIds: ['pvt', 'firm'],
        entityCodes: ['ENT00042', 'ENT00011'],
        verdict: 'same',
        reasons: ['Its GSTIN is on ENT00011'],
      },
    };
    apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === '/offices') return Promise.resolve([{ id: 'o1', code: 'NORTH', name: 'North' }]);
      if (path === '/client-imports/master/preview')
        return Promise.resolve({
          rows: [row],
          counts: { create_client: 0, update_client: 1, unchanged: 0, error: 0 },
          loginProblems: [],
          vaultReady: true,
          logins: 0,
          engagements: 0,
        });
      if (path === '/entities/pvt/merge') return Promise.resolve(result);
      if (opts?.method === 'POST') return Promise.resolve(undefined);
      return routePreview(path) ?? Promise.resolve([]);
    });
    render(wrap(<ClientMaster />));
    await screen.findByRole('option', { name: 'North' });
    await userEvent.upload(
      screen.getByLabelText('Filled client master'),
      new File(['x'], 'master.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );

    expect(await screen.findByText(/Meets two clients: ENT00042 and ENT00011/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Merge these clients/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Merge into ENT00042' }));

    await screen.findByText(/ENT00011 is merged into ENT00042/);
    await userEvent.click(screen.getByText('Close', { selector: 'button' }));
    const previews = apiFetch.mock.calls.filter(([p]) => p === '/client-imports/master/preview');
    expect(previews).toHaveLength(2);
  });
});
