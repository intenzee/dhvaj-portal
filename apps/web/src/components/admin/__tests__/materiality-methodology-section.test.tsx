import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { MaterialityMethodologyLibrary } from '@hsdg/contracts';
import { MaterialityMethodologySection } from '../materiality-methodology-section';

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
  methodologyVersion: 'dhvaj-materiality-2026.1',
  changeNote: 'v1 — moved from the Audit Rules Library.',
  createdByName: null,
  createdAt: '2026-10-12T00:00:00.000Z',
};
const blank = {
  benchmarkKey: null,
  benchmarkLabel: null,
  attentionCriterion: null,
  lowPct: null,
  highPct: null,
  parameterValue: null,
  industryProfiles: [],
  circumstances: [],
  considerations: [],
  sourceBasis:
    'ICAI Implementation Guide to Materiality — DHVAJ methodology pending formal approval',
  provisional: true,
  overrideAttention: 'partner_attention' as const,
};

const LIBRARY: MaterialityMethodologyLibrary = {
  rules: [
    {
      ...v,
      ...blank,
      id: 'r1',
      ruleCode: 'MMR-001',
      kind: 'om_benchmark',
      name: 'Profit before tax',
      benchmarkKey: 'pbt',
      lowPct: 5,
      highPct: 10,
      considerations: ['Stable, recurring profits'],
    },
    {
      ...v,
      ...blank,
      id: 'r13',
      ruleCode: 'MMR-013',
      kind: 'om_benchmark',
      name: 'Loan book (NBFC)',
      benchmarkKey: 'metric:loan_book',
      benchmarkLabel: 'Loans & advances (loan book)',
      industryProfiles: ['nbfc'],
    },
    {
      ...v,
      ...blank,
      id: 'r15',
      ruleCode: 'MMR-015',
      kind: 'pm',
      name: 'Performance materiality — initial audit',
      lowPct: 50,
      highPct: 75,
      circumstances: ['initial_audit'],
      overrideAttention: 'immediate_partner',
    },
  ],
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((_path: string, init?: { method?: string; body?: unknown }) =>
    Promise.resolve(
      init?.method === 'POST'
        ? { ...LIBRARY.rules[0], ...(init.body as object), version: 2 }
        : LIBRARY,
    ),
  );
});

describe('Materiality Methodology Library administration', () => {
  it('lists rules as guidance with applicability, provisional flag and the IPA override', async () => {
    const user = userEvent.setup();
    render(wrap(<MaterialityMethodologySection />));
    expect(await screen.findByText('Profit before tax')).toBeInTheDocument();
    expect(screen.getByText(/SA 320/)).toBeInTheDocument();
    expect(screen.getByText('Profile: nbfc')).toBeInTheDocument();
    expect(screen.getByText('IPA override')).toBeInTheDocument();
    expect(screen.getAllByText('Provisional')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: /MMR-013/ }));
    expect(screen.getByText(/No percentage guidance of Loans & advances/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /MMR-015/ }));
    expect(
      screen.getByText(/Permitted with rationale — Immediate Partner Attention/),
    ).toBeInTheDocument();
  });

  it('appends a version with new percentage guidance and a reason', async () => {
    const user = userEvent.setup();
    render(wrap(<MaterialityMethodologySection />));
    await user.click(await screen.findByRole('button', { name: /MMR-001/ }));
    const add = screen.getByRole('button', { name: 'Add version' });
    expect(add).toBeDisabled(); // a reason is required
    const high = screen.getByRole('spinbutton', { name: /High %/ });
    await user.clear(high);
    await user.type(high, '8');
    await user.type(screen.getByLabelText(/Reason for this version/), 'DHVAJ approved range');
    await user.click(screen.getByLabelText(/Provisional/));
    await user.click(add);
    expect(apiFetch).toHaveBeenCalledWith(
      '/materiality-methodology-library/rules',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          ruleCode: 'MMR-001',
          kind: 'om_benchmark',
          benchmarkKey: 'pbt',
          lowPct: 5,
          highPct: 8,
          provisional: false,
          overrideAttention: 'partner_attention',
          changeNote: 'DHVAJ approved range',
        }),
      }),
    );
  });

  it('requires a label for a metric benchmark before a new rule reaches the API', async () => {
    const user = userEvent.setup();
    render(wrap(<MaterialityMethodologySection />));
    await user.click(await screen.findByRole('button', { name: 'New rule' }));
    expect(screen.getByDisplayValue('MMR-002')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Name/), 'Gross written premium');
    const bench = screen.getByLabelText(/Possible benchmark/);
    await user.clear(bench);
    await user.type(bench, 'metric:gross_premium');
    await user.type(screen.getByLabelText(/Source \/ technical basis/), 'DHVAJ insurance note');
    await user.type(screen.getByLabelText(/Reason for this version/), 'Insurance files');
    const add = screen.getByRole('button', { name: 'Add rule' });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute('title', expect.stringMatching(/needs a label/));
    await user.type(screen.getByLabelText(/Benchmark label/), 'Gross written premium');
    expect(add).toBeEnabled();
  });
});
