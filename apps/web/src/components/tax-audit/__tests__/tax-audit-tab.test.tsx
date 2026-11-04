import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { TaxAuditRow } from '@hsdg/contracts';
import { TaxAuditTab, dueText, yearOf } from '../tax-audit-tab';

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

const row = (over: Partial<TaxAuditRow>): TaxAuditRow => ({
  id: 'a1',
  engagementId: 'g1',
  financialYear: '2026-27',
  revision: 0,
  stage: 'not_started',
  formType: null,
  signingPartnerId: null,
  signingPartnerName: null,
  applicabilityReason: null,
  udin: null,
  signedAt: null,
  uploadedOn: null,
  clientAcceptedOn: null,
  clientRejectedOn: null,
  filedOn: null,
  acknowledgementNo: null,
  instanceId: 'i1',
  filingStatus: 'not_started',
  dueDate: '2027-10-31',
  daysLeft: 12,
  ...over,
});

describe('tax audit helpers', () => {
  it('says how far off the report is', () => {
    expect(dueText({ dueDate: '2027-10-31', daysLeft: 12 })).toBe('31 Oct 2027 · 12 days left');
    expect(dueText({ dueDate: '2027-10-31', daysLeft: -1 })).toBe('31 Oct 2027 · 1 day overdue');
    expect(dueText({ dueDate: '2027-10-31', daysLeft: 0 })).toBe('31 Oct 2027 · due today');
    expect(dueText({ dueDate: '2027-10-31', daysLeft: null })).toBe('31 Oct 2027');
    expect(dueText({ dueDate: null, daysLeft: null })).toBe('—');
  });

  it('names a revised report', () => {
    expect(yearOf({ financialYear: '2025-26', revision: 0 })).toBe('FY 2025-26');
    expect(yearOf({ financialYear: '2025-26', revision: 1 })).toBe('FY 2025-26 · revised 1');
  });
});

describe('TaxAuditTab', () => {
  beforeEach(() => apiFetch.mockReset());

  it('lists every year, the filed one with its UDIN and acknowledgement', async () => {
    apiFetch.mockResolvedValue([
      row({ signingPartnerName: 'Meera Rao', formType: '3CB' }),
      row({
        id: 'a0',
        financialYear: '2025-26',
        stage: 'filed',
        filingStatus: 'filed',
        dueDate: '2026-10-21',
        daysLeft: null,
        udin: '26123456ABCDEF1234',
        clientAcceptedOn: '2026-10-15',
        filedOn: '2026-10-16',
        acknowledgementNo: '987654321',
      }),
    ]);
    render(wrap(<TaxAuditTab engagementId="g1" />));

    expect(await screen.findByText('FY 2026-27')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/engagements/g1/tax-audits');
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.getByText('Form 3CB')).toBeInTheDocument();
    expect(screen.getByText('Meera Rao')).toBeInTheDocument();
    expect(screen.getByText('Filed')).toBeInTheDocument();
    expect(screen.getByText('26123456ABCDEF1234')).toBeInTheDocument();
    expect(screen.getByText('Accepted 15 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText('Ack 987654321')).toBeInTheDocument();
  });

  it('says when there is no audit yet', async () => {
    apiFetch.mockResolvedValue([]);
    render(wrap(<TaxAuditTab engagementId="g1" />));
    expect(await screen.findByText(/No tax audit on this engagement yet/)).toBeInTheDocument();
  });

  it('opens the year’s applicability, with the decision already made', async () => {
    apiFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith('/tax-audits')
          ? [row({ applicabilityReason: 'Decided: speculative turnover counted' })]
          : [
              {
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
                override: { applicable: true, reason: 'speculative turnover counted' },
                decidedByName: 'Meera Rao',
                version: 2,
              },
            ],
      ),
    );
    render(wrap(<TaxAuditTab engagementId="g1" />));
    expect(await screen.findByText('Decided: speculative turnover counted')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Applicability' }));
    expect(await screen.findByText('Last decided by Meera Rao.')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/engagements/g1/tax-audit-applicability');
    expect(screen.getByLabelText('Business turnover (₹)')).toHaveValue('5000000');
    expect(screen.getByLabelText('Reason')).toHaveValue('speculative turnover counted');
  });
});
