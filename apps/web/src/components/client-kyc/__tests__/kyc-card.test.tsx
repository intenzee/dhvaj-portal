import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { kycEffectiveStatus, kycNextReviewOn, type ClientKyc } from '@hsdg/contracts';
import { KycCard } from '../kyc-card';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const kyc = (over: Partial<ClientKyc> = {}): ClientKyc => ({
  entityId: 'e1',
  entityName: 'Acme',
  status: 'pending',
  onFile: false,
  panVerified: false,
  panVerifiedOn: null,
  addressProofDocumentId: null,
  identityProofDocumentIds: [],
  beneficialOwners: [],
  riskRating: null,
  checklist: [
    { code: 'PAN', label: 'PAN card', mandatory: true, done: false },
    { code: 'GST', label: 'GST certificate', mandatory: false, done: false },
  ],
  notes: null,
  reviewedBy: null,
  reviewedOn: null,
  nextReviewOn: null,
  version: 0,
  settings: { gate: 'warn', reviewYearsHigh: 1, reviewYearsOther: 3 },
  can: { edit: true, complete: true },
  ...over,
});

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
});

describe('KYC rules (PS-404)', () => {
  it('the next review is the rating’s years on, 29 February falling back to the 28th', () => {
    const s = { reviewYearsHigh: 1, reviewYearsOther: 3 };
    expect(kycNextReviewOn('2026-04-15', 'high', s)).toBe('2027-04-15');
    expect(kycNextReviewOn('2026-04-15', 'low', s)).toBe('2029-04-15');
    expect(kycNextReviewOn('2024-02-29', 'high', s)).toBe('2025-02-28');
    expect(kycNextReviewOn('2024-02-29', 'medium', { ...s, reviewYearsOther: 4 })).toBe(
      '2028-02-29',
    );
  });

  it('a complete KYC is due again on its review date', () => {
    expect(kycEffectiveStatus(null, null, '2026-11-05')).toBe('pending');
    expect(kycEffectiveStatus('complete', '2026-11-06', '2026-11-05')).toBe('complete');
    expect(kycEffectiveStatus('complete', '2026-11-05', '2026-11-05')).toBe('expired');
  });
});

describe('KycCard (PS-404)', () => {
  it('holds Mark complete until the PAN, the rating and the mandatory items are in', async () => {
    apiFetch.mockResolvedValue(kyc({ onFile: true, version: 2 }));
    render(wrap(<KycCard entityId="e1" />));
    const complete = await screen.findByRole('button', { name: 'Mark complete' });
    expect(complete).toBeDisabled();
    expect(screen.getByText(/Verify the PAN/)).toBeInTheDocument();
    expect(screen.getByText(/Still to collect: PAN card/)).toBeInTheDocument();
    expect(screen.queryByText(/GST certificate\./)).not.toBeInTheDocument();
  });

  it('saves the ticks, the rating and the owners with the version', async () => {
    const user = userEvent.setup();
    apiFetch.mockImplementation((_p: string, init?: { body: object }) =>
      Promise.resolve(init ? kyc({ onFile: true, version: 1 }) : kyc()),
    );
    render(wrap(<KycCard entityId="e1" />));
    await user.click(await screen.findByRole('checkbox', { name: /PAN card/ }));
    await user.click(screen.getByRole('checkbox', { name: /PAN verified/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: /Risk rating/ }), 'high');
    expect(screen.getByText(/Reviewed again every 1 year/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add owner/ }));
    await user.type(screen.getByLabelText('Owner 1 name'), 'Ravi Kumar');
    await user.type(screen.getByLabelText('Owner 1 PAN'), 'abcpk1234f');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(apiFetch).toHaveBeenLastCalledWith('/entities/e1/kyc', {
      method: 'PUT',
      body: {
        version: 0,
        panVerified: true,
        riskRating: 'high',
        checklist: { PAN: true, GST: false },
        beneficialOwners: [
          { name: 'Ravi Kumar', pan: 'ABCPK1234F', holdingPercent: null, role: null },
        ],
        notes: null,
      },
    });
  });

  it('a senior sees no Mark complete', async () => {
    apiFetch.mockResolvedValue(kyc({ can: { edit: true, complete: false } }));
    render(wrap(<KycCard entityId="e1" />));
    await screen.findByText(/Nothing on file yet/);
    expect(screen.queryByRole('button', { name: 'Mark complete' })).not.toBeInTheDocument();
  });
});
