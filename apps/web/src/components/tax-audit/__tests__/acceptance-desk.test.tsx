import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { TaxAuditAcceptance } from '@hsdg/contracts';
import { AcceptanceDesk } from '../acceptance-desk';

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

const URL = '/engagements/g1/tax-audits/a1/acceptance';

const desk = (over: Partial<TaxAuditAcceptance> = {}): TaxAuditAcceptance => ({
  auditId: 'a1',
  engagementId: 'g1',
  financialYear: '2025-26',
  stage: 'acceptance',
  formType: null,
  signingPartnerId: null,
  signingPartnerName: null,
  independence: { ok: true, findings: [], confirmedAt: null, confirmedByName: null },
  previousAuditor: { changed: true, name: 'Old & Co', letterDocumentId: null, letterTitle: null },
  appointmentLetter: null,
  acceptedAt: null,
  acceptedByName: null,
  proposal: null,
  limit: 60,
  partners: [
    {
      employeeId: 'p1',
      name: 'Deepak',
      copNo: 'C1',
      copValidUntil: '2027-03-31',
      reports: 41,
      summary: 'Deepak: 41 of 60 for FY 2025-26',
      offered: true,
      reason: null,
    },
    {
      employeeId: 'p2',
      name: 'Tanmoy',
      copNo: 'C2',
      copValidUntil: '2027-03-31',
      reports: 60,
      summary: 'Tanmoy: 60 of 60 for FY 2025-26',
      offered: false,
      reason: '60 of 60 tax audit reports for FY 2025-26: no room for another.',
    },
    {
      employeeId: 'p3',
      name: 'Asha',
      copNo: null,
      copValidUntil: null,
      reports: 0,
      summary: 'Asha: 0 of 60 for FY 2025-26',
      offered: false,
      reason: 'No certificate of practice on the partner profile.',
    },
  ],
  missing: [
    'Upload the written communication to the previous auditor.',
    'Choose the form: 3CA or 3CB.',
  ],
  canEdit: true,
  version: 4,
  ...over,
});

describe('AcceptanceDesk', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    toast.mockReset();
  });

  it('offers only partners with a valid COP and room, each with their count', async () => {
    apiFetch.mockResolvedValue(desk());
    render(wrap(<AcceptanceDesk engagementId="g1" auditId="a1" />));
    const picker = (await screen.findByLabelText(/^Signing partner/)) as HTMLSelectElement;
    const options = [...picker.options].map((o) => o.textContent);
    expect(options).toEqual(['Choose…', 'Deepak: 41 of 60 for FY 2025-26']);
    // The others are listed with the reason, not offered.
    const notOffered = screen.getByRole('list', { name: 'Partners not offered' });
    expect(notOffered).toHaveTextContent('Tanmoy: 60 of 60 for FY 2025-26');
    expect(notOffered).toHaveTextContent('No certificate of practice');
  });

  it('saves the chosen partner with the version read', async () => {
    apiFetch.mockResolvedValueOnce(desk()).mockResolvedValueOnce(desk({ version: 5 }));
    render(wrap(<AcceptanceDesk engagementId="g1" auditId="a1" />));
    fireEvent.change(await screen.findByLabelText(/^Signing partner/), {
      target: { value: 'p1' },
    });
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(URL, {
        method: 'PUT',
        body: { version: 4, signingPartnerId: 'p1' },
      }),
    );
  });

  it('holds Accept until every step is done, and says what is left', async () => {
    apiFetch.mockResolvedValue(desk());
    render(wrap(<AcceptanceDesk engagementId="g1" auditId="a1" />));
    expect(await screen.findByRole('button', { name: 'Accept the tax audit' })).toBeDisabled();
    expect(screen.getByRole('list', { name: 'Still to do' })).toHaveTextContent(
      'Upload the written communication to the previous auditor.',
    );
    expect(screen.getByRole('button', { name: 'Upload letter' })).toBeInTheDocument();
  });

  it('accepts when nothing is missing', async () => {
    apiFetch
      .mockResolvedValueOnce(desk({ missing: [], formType: '3CB', signingPartnerId: 'p1' }))
      .mockResolvedValueOnce(desk({ stage: 'information', canEdit: false, missing: [] }));
    render(wrap(<AcceptanceDesk engagementId="g1" auditId="a1" />));
    fireEvent.click(await screen.findByRole('button', { name: 'Accept the tax audit' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(`${URL}/accept`, {
        method: 'POST',
        body: { version: 4 },
      }),
    );
    expect(toast).toHaveBeenCalledWith('Tax audit accepted.');
  });

  it('proposes last year’s form, partner and team, and takes them in one go', async () => {
    const proposal = {
      fromAuditId: 'a0',
      fromFinancialYear: '2024-25',
      formType: '3CB' as const,
      signingPartnerId: 'p1',
      signingPartnerName: 'Deepak',
      team: ['Deepak (engagement partner)', 'Riya (in charge)'],
    };
    apiFetch.mockResolvedValue(
      desk({
        proposal,
        previousAuditor: { changed: null, name: null, letterDocumentId: null, letterTitle: null },
      }),
    );
    render(wrap(<AcceptanceDesk engagementId="g1" auditId="a1" />));
    const last = await screen.findByRole('region', { name: 'Last year' });
    expect(last).toHaveTextContent('Rolled over from FY 2024-25');
    expect(last).toHaveTextContent('Form 3CB, signed by Deepak');
    expect(last).toHaveTextContent('Riya (in charge)');
    fireEvent.click(screen.getByRole('button', { name: 'Take last year’s choices' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(URL, {
        method: 'PUT',
        body: {
          version: 4,
          formType: '3CB',
          signingPartnerId: 'p1',
          previousAuditorChanged: false,
        },
      }),
    );
  });

  it('says why last year’s partner is not offered, and takes the rest', async () => {
    apiFetch.mockResolvedValue(
      desk({
        proposal: {
          fromAuditId: 'a0',
          fromFinancialYear: '2024-25',
          formType: '3CA',
          signingPartnerId: 'p2',
          signingPartnerName: 'Tanmoy',
          team: [],
        },
      }),
    );
    render(wrap(<AcceptanceDesk engagementId="g1" auditId="a1" />));
    const last = await screen.findByRole('region', { name: 'Last year' });
    expect(last).toHaveTextContent('Tanmoy: 60 of 60 for FY 2025-26 — 60 of 60');
    fireEvent.click(screen.getByRole('button', { name: 'Take last year’s choices' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(URL, {
        method: 'PUT',
        body: { version: 4, formType: '3CA' },
      }),
    );
  });

  it('hides the controls from someone who cannot accept', async () => {
    apiFetch.mockResolvedValue(desk({ canEdit: false }));
    render(wrap(<AcceptanceDesk engagementId="g1" auditId="a1" />));
    expect(
      await screen.findByText('The engagement’s partner or manager accepts the tax audit.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Signing partner/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept the tax audit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload letter' })).toBeNull();
  });

  it('shows the s.44AB block', async () => {
    apiFetch.mockResolvedValue(
      desk({
        independence: {
          ok: false,
          findings: [
            {
              rule: 'TAX_AUDIT_BY_BOOKKEEPER',
              outcome: 'block',
              message: 'Section 44AB: the firm keeps this client’s books for FY 2025-26.',
            },
          ],
          confirmedAt: null,
          confirmedByName: null,
        },
      }),
    );
    render(wrap(<AcceptanceDesk engagementId="g1" auditId="a1" />));
    expect(await screen.findByText(/Section 44AB: the firm keeps/)).toBeInTheDocument();
  });
});
