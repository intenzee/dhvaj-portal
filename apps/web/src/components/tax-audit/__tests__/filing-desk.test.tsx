import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { TaxAuditFiling } from '@hsdg/contracts';
import { FilingDesk } from '../filing-desk';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
jest.mock('@/lib/file-kind', () => ({ blobToBase64: async () => 'QUJD' }));
jest.mock('@/lib/people', () => ({ istToday: () => '2026-11-04' }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const BASE = '/engagements/g1/tax-audits/a1/filing';
const NONE = {
  sign: false,
  withdraw: false,
  upload: false,
  clientDecision: false,
  file: false,
  revise: false,
};

const filing = (over: Partial<TaxAuditFiling> = {}): TaxAuditFiling => ({
  auditId: 'a1',
  engagementId: 'g1',
  financialYear: '2025-26',
  revision: 0,
  revisedFromId: null,
  revisionReason: null,
  stage: 'review',
  formType: '3CB',
  signingPartnerId: 'pb',
  signingPartnerName: 'Partner B',
  udin: null,
  signedAt: null,
  signedByName: null,
  signedReport: null,
  uploadedOn: null,
  clientAcceptedOn: null,
  clientRejectedOn: null,
  clientRejectionReason: null,
  filedOn: null,
  acknowledgementNo: null,
  acknowledgement: null,
  complianceInstanceId: 'ci1',
  signingBlockers: [],
  revisions: [{ id: 'a1', revision: 0, stage: 'review', filedOn: null }],
  can: NONE,
  version: 4,
  ...over,
});

const serve = (f: TaxAuditFiling) => apiFetch.mockResolvedValue(f);
const callTo = (url: string) =>
  apiFetch.mock.calls.find((c) => c[0] === url) as
    [string, { method?: string; body?: Record<string, unknown> }] | undefined;

describe('FilingDesk', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    toast.mockReset();
  });

  it('spells out what stops signing', async () => {
    serve(filing({ signingBlockers: ['Clear 2 open review points.'] }));
    render(wrap(<FilingDesk engagementId="g1" auditId="a1" />));
    expect(await screen.findByText('Clear 2 open review points.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull();
  });

  it('lets the signing Partner sign with the UDIN and the signed report', async () => {
    serve(filing({ can: { ...NONE, sign: true } }));
    render(wrap(<FilingDesk engagementId="g1" auditId="a1" />));
    const sign = await screen.findByRole('button', { name: 'Sign' });
    expect(sign).toBeDisabled();
    fireEvent.change(screen.getByLabelText('UDIN'), { target: { value: '26123456ABCDEF1234' } });
    fireEvent.change(screen.getByLabelText('Signed report'), {
      target: { files: [new File(['%PDF'], 'TAR.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(sign);
    await waitFor(() =>
      expect(callTo(`${BASE}/sign`)![1]).toEqual({
        method: 'POST',
        body: {
          udin: '26123456ABCDEF1234',
          version: 4,
          filename: 'TAR.pdf',
          contentType: 'application/pdf',
          contentBase64: 'QUJD',
        },
      }),
    );
  });

  it('records the client’s rejection only with a reason, and shows it afterwards', async () => {
    serve(
      filing({
        stage: 'uploaded',
        udin: '26123456ABCDEF1234',
        signedAt: '2026-11-03T05:00:00.000Z',
        signedByName: 'Partner B',
        uploadedOn: '2026-11-03',
        can: { ...NONE, clientDecision: true },
      }),
    );
    render(wrap(<FilingDesk engagementId="g1" auditId="a1" />));
    const rejected = await screen.findByRole('button', { name: 'Rejected' });
    expect(rejected).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Why the client rejected it'), {
      target: { value: 'Depreciation differs.' },
    });
    fireEvent.click(rejected);
    await waitFor(() =>
      expect(callTo(`${BASE}/client-rejected`)![1].body).toEqual({
        rejectedOn: '2026-11-04',
        reason: 'Depreciation differs.',
        version: 4,
      }),
    );
  });

  it('files with the acknowledgement, lodging the year’s filing', async () => {
    serve(
      filing({
        stage: 'client_accepted',
        clientAcceptedOn: '2026-11-04',
        can: { ...NONE, file: true },
      }),
    );
    render(wrap(<FilingDesk engagementId="g1" auditId="a1" />));
    expect(
      await screen.findByText(/This lodges the year’s tax audit report filing/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Acknowledgement number'), {
      target: { value: '765432109876543' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record the filing' }));
    await waitFor(() =>
      expect(callTo(`${BASE}/filed`)![1].body).toEqual({
        acknowledgementNo: '765432109876543',
        filedOn: '2026-11-04',
        version: 4,
      }),
    );
  });

  it('lists the year’s reports and starts a revision with a reason', async () => {
    serve(
      filing({
        stage: 'filed',
        filedOn: '2026-11-04',
        acknowledgementNo: '765432109876543',
        clientAcceptedOn: '2026-11-04',
        revisions: [
          { id: 'a1', revision: 0, stage: 'filed', filedOn: '2026-11-04' },
          { id: 'a2', revision: 1, stage: 'clause_work', filedOn: null },
        ],
        can: { ...NONE, revise: true },
      }),
    );
    render(wrap(<FilingDesk engagementId="g1" auditId="a1" />));
    expect(await screen.findByText(/^Revision 1 · Clause work/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Why the report is revised'), {
      target: { value: 'TDS corrected.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start a revised report' }));
    await waitFor(() =>
      expect(callTo(`${BASE}/revise`)![1].body).toEqual({ reason: 'TDS corrected.', version: 4 }),
    );
  });
});
