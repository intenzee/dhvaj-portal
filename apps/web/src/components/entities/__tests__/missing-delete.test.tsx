import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { EntityDetail, EntityRow } from '@/lib/types';
import EntitiesPage from '@/app/(portal)/entities/page';
import { EntityDetailActions } from '../entity-actions';
import { MissingDataMarker } from '../missing-data';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
let principal: Record<string, unknown> = {};
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal }) }));
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

const pan = { code: 'pan', label: 'PAN not recorded', severity: 'recommended' as const };
const regs = {
  code: 'registrations',
  label: 'No registrations recorded',
  severity: 'recommended' as const,
};
const fin = {
  code: 'financials',
  label: 'No financial year recorded',
  severity: 'recommended' as const,
};

const row = (over: Partial<EntityRow>): EntityRow => ({
  id: 'e1',
  entityCode: 'CL-0001',
  legalName: 'Sharma Traders',
  typeName: 'Proprietorship',
  status: 'active',
  pan: null,
  primaryContactName: null,
  registrationCount: 0,
  missingInfo: [],
  ...over,
});

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
  push.mockReset();
  principal = {};
});

describe('MissingDataMarker', () => {
  it('names the first two gaps, counts the rest, and lists all on hover', () => {
    render(<MissingDataMarker items={[pan, regs, fin]} />);
    const marker = screen.getByText('PAN, Registrations +1');
    expect(marker.closest('[title]')).toHaveAttribute(
      'title',
      'PAN not recorded; No registrations recorded; No financial year recorded',
    );
  });

  it('shows nothing for a complete client', () => {
    const { container } = render(<MissingDataMarker items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Clients list', () => {
  it('marks incomplete clients and filters by a missing item', async () => {
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/teams')
          ? []
          : path.includes('missing=pan')
            ? { items: [row({ missingInfo: [pan] })], total: 1, limit: 25, offset: 0 }
            : {
                items: [
                  row({ missingInfo: [pan, regs] }),
                  row({
                    id: 'e2',
                    entityCode: 'CL-0002',
                    legalName: 'Complete Co',
                    pan: 'AAAPS1234C',
                  }),
                ],
                total: 2,
                limit: 25,
                offset: 0,
              },
      ),
    );
    render(wrap(<EntitiesPage />));
    expect(await screen.findByText('PAN, Registrations')).toBeInTheDocument();
    // Complete Co has no marker.
    expect(screen.getAllByLabelText(/^Missing: /)).toHaveLength(1);

    await userEvent.selectOptions(screen.getByLabelText('Missing data'), 'Missing PAN');
    await waitFor(() =>
      expect(apiFetch).toHaveBeenLastCalledWith('/entities?limit=25&offset=0&missing=pan'),
    );
    expect(await screen.findByLabelText('Missing: PAN not recorded')).toHaveTextContent('PAN');
  });
});

const entity = {
  id: 'e1',
  entityCode: 'CL-0001',
  legalName: 'Sharma Traders',
} as EntityDetail;

describe('Delete client', () => {
  it('is offered to the Managing Partner only', () => {
    principal = { effectiveRole: 'partner', roles: ['partner'] };
    const { unmount } = render(wrap(<EntityDetailActions entity={entity} />));
    expect(screen.queryByRole('button', { name: /Delete client/ })).toBeNull();
    unmount();
    principal = { effectiveRole: 'managing_partner', roles: ['managing_partner'] };
    render(wrap(<EntityDetailActions entity={entity} />));
    expect(screen.getByRole('button', { name: /Delete client/ })).toBeInTheDocument();
  });

  it('needs the client code typed, then deletes and goes back to the list', async () => {
    principal = { effectiveRole: 'managing_partner', roles: ['managing_partner'] };
    apiFetch.mockResolvedValue(undefined);
    render(wrap(<EntityDetailActions entity={entity} />));
    await userEvent.click(screen.getByRole('button', { name: /Delete client/ }));
    const go = screen.getByRole('button', { name: 'Delete for good' });
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Type CL-0001 to confirm'), 'cl-0001');
    expect(go).toBeEnabled();
    await userEvent.click(go);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/entities'));
    expect(apiFetch).toHaveBeenCalledWith('/entities/e1', { method: 'DELETE' });
  });

  it('shows why the API refused', async () => {
    principal = { effectiveRole: 'managing_partner', roles: ['managing_partner'] };
    const { ApiError } = jest.requireMock('@/lib/api') as {
      ApiError: new (s: number, m: string) => Error;
    };
    apiFetch.mockRejectedValue(
      new ApiError(409, 'Sharma Traders can’t be deleted: it has 1 engagement.'),
    );
    render(wrap(<EntityDetailActions entity={entity} />));
    await userEvent.click(screen.getByRole('button', { name: /Delete client/ }));
    await userEvent.type(screen.getByLabelText('Type CL-0001 to confirm'), 'CL-0001');
    await userEvent.click(screen.getByRole('button', { name: 'Delete for good' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('it has 1 engagement');
    expect(push).not.toHaveBeenCalled();
  });
});
