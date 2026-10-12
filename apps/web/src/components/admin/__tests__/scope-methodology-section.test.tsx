import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ScopeMethodologyItemRecord, ScopeMethodologyLibrary } from '@hsdg/contracts';
import { ScopeMethodologySection } from '../scope-methodology-section';

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
  effectiveFrom: '2000-01-01',
  effectiveTo: null,
  methodologyVersion: 'dhvaj-scope-2026.1',
  createdByName: null,
  createdAt: '2026-10-12T00:00:00.000Z',
  hint: null,
  sortOrder: 10,
};
const item = (x: Partial<ScopeMethodologyItemRecord>): ScopeMethodologyItemRecord => ({
  ...v,
  id: 'i1',
  itemCode: 'SMI-001',
  version: 1,
  kind: 'controls_cycle',
  itemKey: 'revenue',
  label: 'Revenue',
  options: ['reliance_contemplated', 'no_reliance', 'further_assessment'],
  guidance: null,
  active: true,
  changeNote: 'Seeded from the built-in 03.4 lists.',
  ...x,
});

const LIBRARY: ScopeMethodologyLibrary = {
  items: [
    item({ id: 'i1b', version: 2, label: 'Revenue & receivables', guidance: 'Order to cash.' }),
    item({}),
    item({
      id: 'i9',
      itemCode: 'SMI-009',
      kind: 'timing',
      itemKey: 'inventory',
      label: 'Inventory',
      options: ['interim', 'year_end'],
      active: false,
      changeNote: 'Retired',
    }),
  ],
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((_path: string, init?: { method?: string; body?: unknown }) =>
    Promise.resolve(
      init?.method === 'POST'
        ? { ...LIBRARY.items[0], ...(init.body as object), version: 3 }
        : LIBRARY,
    ),
  );
});

describe('03.4 Scope & Approach Methodology Library administration', () => {
  it('lists each item once (latest version), its kind, history and retired items', async () => {
    const user = userEvent.setup();
    render(wrap(<ScopeMethodologySection />));
    expect(await screen.findByText('Revenue & receivables')).toBeInTheDocument();
    expect(screen.queryByText('Revenue')).not.toBeInTheDocument();
    expect(screen.getByText('Retired')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /SMI-001/ }));
    expect(screen.getAllByText('Order to cash.').length).toBeGreaterThan(0);
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
  });

  it('filters by kind', async () => {
    const user = userEvent.setup();
    render(wrap(<ScopeMethodologySection />));
    await screen.findByText('Revenue & receivables');
    await user.selectOptions(screen.getByLabelText('Filter by kind'), 'timing');
    expect(screen.queryByText('Revenue & receivables')).not.toBeInTheDocument();
    expect(screen.getByText('Inventory')).toBeInTheDocument();
  });

  it('appends a version with a new label and a reason', async () => {
    const user = userEvent.setup();
    render(wrap(<ScopeMethodologySection />));
    await user.click(await screen.findByRole('button', { name: /SMI-001/ }));
    const add = screen.getByRole('button', { name: 'Add version' });
    expect(add).toBeDisabled(); // a reason is required
    const label = screen.getByDisplayValue('Revenue & receivables');
    await user.clear(label);
    await user.type(label, 'Revenue cycle');
    await user.type(screen.getByLabelText(/Reason for this version/), 'Renamed by the MP');
    await user.click(add);
    expect(apiFetch).toHaveBeenCalledWith(
      '/scope-methodology-library/items',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          itemCode: 'SMI-001',
          kind: 'controls_cycle',
          itemKey: 'revenue',
          label: 'Revenue cycle',
          options: ['reliance_contemplated', 'no_reliance', 'further_assessment'],
          changeNote: 'Renamed by the MP',
        }),
      }),
    );
  });

  it('a new item needs a key and at least two answers before it reaches the API', async () => {
    const user = userEvent.setup();
    render(wrap(<ScopeMethodologySection />));
    await user.click(await screen.findByRole('button', { name: 'New item' }));
    expect(screen.getByDisplayValue('SMI-002')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Label/), 'Treasury');
    await user.type(screen.getByLabelText(/Reason for this version/), 'New cycle');
    const add = screen.getByRole('button', { name: 'Add item' });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute('title', expect.stringMatching(/lower_snake_case/));
    await user.type(screen.getByLabelText(/Item key/), 'treasury');
    expect(add).toHaveAttribute('title', expect.stringMatching(/between 2 and 8/));
  });
});
