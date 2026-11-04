import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { TaxAuditApplicability, TaxAuditRadarRow } from '@hsdg/contracts';
import { ApplicabilityForm, rupeesIn } from '../applicability-form';
import { TaxAuditRadar, daysText, radarYear } from '../tax-audit-radar';

const apiFetch = jest.fn();
const toast = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const radarRow = (over: Partial<TaxAuditRadarRow>): TaxAuditRadarRow => ({
  engagementId: 'g1',
  engagementCode: 'CMP-001',
  entityId: 'e1',
  entityName: 'Acme Traders',
  financialYear: '2026-27',
  yearVersion: 3,
  likely: true,
  basis: 'turnover',
  reason: 'Turnover of ₹2.5 crore on the client record is over ₹1 crore.',
  inScope: false,
  booksKept: false,
  stage: null,
  dueDate: '2027-10-31',
  daysToDue: 40,
  alert: true,
  ...over,
});

const decision = (over: Partial<TaxAuditApplicability>): TaxAuditApplicability => ({
  id: 'd1',
  engagementId: 'g1',
  financialYear: '2026-27',
  inputs: {
    businessTurnover: 5_000_000,
    professionReceipts: null,
    cashWithinFivePercent: false,
    presumptiveScheme: null,
    profitBelowPresumptive: false,
    incomeAboveExemption: true,
    optedOutOf44AD: false,
  },
  computed: { applicable: false, clause: null, reason: 'Within ₹1 crore.' },
  override: null,
  applicable: false,
  reason: 'Within ₹1 crore.',
  decidedById: 'p1',
  decidedByName: 'Meera Rao',
  decidedAt: '2026-10-01T10:00:00.000Z',
  version: 2,
  ...over,
});

describe('radar helpers', () => {
  it('picks the year whose reports fall due next', () => {
    expect(radarYear('2026-09-30')).toBe('2025-26');
    expect(radarYear('2026-10-01')).toBe('2026-27');
    expect(radarYear('2027-03-31')).toBe('2026-27');
  });

  it('says how far off the report is', () => {
    expect(daysText(12)).toBe('12 days left');
    expect(daysText(-1)).toBe('1 day overdue');
    expect(daysText(0)).toBe('due today');
  });

  it('reads rupees typed the Indian way', () => {
    expect(rupeesIn('2,50,00,000')).toBe(25_000_000);
    expect(rupeesIn(' ₹ 45000 ')).toBe(45_000);
    expect(rupeesIn('')).toBeNull();
    expect(rupeesIn('abc')).toBeNull();
  });
});

describe('ApplicabilityForm', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    toast.mockReset();
  });

  it('answers as the questions are filled in, and saves the inputs', async () => {
    apiFetch.mockResolvedValue(decision({ applicable: true, version: 1 }));
    render(wrap(<ApplicabilityForm engagementId="g1" financialYear="2026-27" decision={null} />));
    expect(screen.getByRole('status', { name: 'Calculator answer' })).toHaveTextContent(
      'No business or professional income for the year.',
    );

    fireEvent.change(screen.getByLabelText('Business turnover (₹)'), {
      target: { value: '2,50,00,000' },
    });
    expect(screen.getByRole('status', { name: 'Calculator answer' })).toHaveTextContent(
      'Tax audit applies · s.44AB(a)',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [url, opts] = apiFetch.mock.calls[0] as [string, { method: string; body: unknown }];
    expect(url).toBe('/engagements/g1/tax-audit-applicability/2026-27');
    expect(opts).toMatchObject({
      method: 'PUT',
      body: { inputs: { businessTurnover: 25_000_000 }, override: null },
    });
    expect(opts.body).not.toHaveProperty('version');
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('FY 2026-27: tax audit applies.', 'success'),
    );
  });

  it('holds an override until it has a reason, and sends the version', async () => {
    apiFetch.mockResolvedValue(decision({}));
    render(
      wrap(<ApplicabilityForm engagementId="g1" financialYear="2026-27" decision={decision({})} />),
    );
    expect(screen.getByText('Last decided by Meera Rao.')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Override the calculator'));
    const save = screen.getByRole('button', { name: 'Save decision' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'yes' } });
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: ' Speculative turnover counted ' },
    });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(apiFetch.mock.calls[0]![1]).toMatchObject({
      body: { override: { applicable: true, reason: 'Speculative turnover counted' }, version: 2 },
    });
  });
});

describe('TaxAuditRadar', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    toast.mockReset();
  });

  it('lists likely clients with the reason, and adds Tax Audit to the year', async () => {
    apiFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith('/tax-audits/radar')
          ? [
              radarRow({}),
              radarRow({
                engagementId: 'g2',
                entityName: 'Bharat Mills',
                inScope: true,
                stage: 'clause_work',
                basis: 'decided',
                alert: false,
              }),
              radarRow({
                engagementId: 'g3',
                entityName: 'Kiran Stores',
                booksKept: true,
                alert: false,
              }),
            ]
          : {},
      ),
    );
    render(wrap(<TaxAuditRadar today="2026-11-04" />));

    expect(await screen.findByText('Acme Traders')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/tax-audits/radar?financialYear=2026-27');
    expect(screen.getByText('2 likely, not in scope')).toBeInTheDocument();
    expect(screen.getByText('Likely · Worked out')).toBeInTheDocument();
    expect(screen.getByText('Clause work')).toBeInTheDocument();
    expect(
      screen.getByText('The firm keeps the books: another auditor signs.'),
    ).toBeInTheDocument();
    // Only Acme can take Tax Audit: Bharat has it, the firm keeps Kiran's books.
    const add = screen.getAllByRole('button', { name: 'Add Tax Audit' });
    expect(add).toHaveLength(1);

    fireEvent.click(add[0]!);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/engagements/g1/years/2026-27/streams', {
        method: 'PATCH',
        body: { add: ['tax_audit'], version: 3 },
      }),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Tax Audit added to Acme Traders for FY 2026-27.',
        'success',
      ),
    );
  });

  it('asks for every client to work one out', async () => {
    apiFetch.mockResolvedValue([]);
    render(wrap(<TaxAuditRadar today="2026-11-04" />));
    expect(
      await screen.findByText(
        'No client on your engagements looks likely to need a tax audit for FY 2026-27.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Every client, to work one out'));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/tax-audits/radar?financialYear=2026-27&all=true'),
    );
  });
});
