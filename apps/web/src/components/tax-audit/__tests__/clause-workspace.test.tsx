import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { TaxAuditWorkingPaper, TaxAuditWorkspace } from '@hsdg/contracts';
import { ClauseWorkspace, packageProgress } from '../clause-workspace';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
jest.mock('@/lib/file-kind', () => ({ blobToBase64: async () => 'QUJD' }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const BASE = '/engagements/g1/tax-audits/a1';
const counts = { not_started: 0, in_progress: 0, in_review: 0, done: 0, not_applicable: 0 };

const paper = (over: Partial<TaxAuditWorkingPaper> = {}): TaxAuditWorkingPaper => ({
  id: 'w34',
  packageId: 'k1',
  clauseNo: '34',
  part: 'B',
  title: 'TDS and TCS',
  subItems: [
    { key: 'a', label: 'Required to deduct', kind: 'yes_no' },
    { key: 'b', label: 'Details', kind: 'table' },
  ],
  appliesWhen: null,
  evidenceRequired: ['TDS returns'],
  partnerReview: false,
  status: 'not_started',
  notApplicableSource: null,
  notApplicableReason: null,
  answer: {},
  preparerId: null,
  preparerName: null,
  reviewerName: null,
  draftSource: null,
  draftAnswer: null,
  draftNote: null,
  draftConfirmedAt: null,
  draftConfirmedByName: null,
  sentForReviewAt: null,
  doneAt: null,
  doneByName: null,
  documents: [],
  comments: [],
  blockers: ['Answer Required to deduct; Details.', 'Attach the evidence: TDS returns.'],
  canPrepare: true,
  canReview: false,
  version: 1,
  ...over,
});

const ws = (over: Partial<TaxAuditWorkspace> = {}): TaxAuditWorkspace => ({
  auditId: 'a1',
  engagementId: 'g1',
  financialYear: '2025-26',
  stage: 'clause_work',
  library: { versionNo: 1, label: 'Form 3CD (2025)', act: '1961' },
  facts: { holdsStock: true },
  openedAt: '2026-11-01T05:00:00.000Z',
  packages: [
    {
      id: 'k1',
      package: 'tds_tcs',
      grade: 'article',
      taskId: 't1',
      taskStatus: 'todo',
      assigneeId: 'e7',
      assigneeName: 'Riya',
      clauseNos: ['34'],
      counts: { ...counts, not_started: 1 },
    },
  ],
  papers: [paper()],
  requests: [],
  canLead: true,
  editable: true,
  version: 3,
  ...over,
});

const callTo = (url: string): [string, { method?: string; body?: unknown }] | undefined =>
  apiFetch.mock.calls.find((c) => c[0] === url) as
    [string, { method?: string; body?: unknown }] | undefined;

describe('ClauseWorkspace', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    toast.mockReset();
  });

  it('opens the 3CD work once the audit is accepted', async () => {
    let opened = false;
    apiFetch.mockImplementation((url: string) => {
      if (url.endsWith('/open')) opened = true;
      return Promise.resolve(opened ? ws() : ws({ library: null, stage: 'information' }));
    });
    render(wrap(<ClauseWorkspace engagementId="g1" auditId="a1" />));
    fireEvent.click(await screen.findByRole('button', { name: 'Open the 3CD work' }));
    await waitFor(() => expect(callTo(`${BASE}/clauses/open`)).toBeTruthy());
    expect(callTo(`${BASE}/clauses/open`)![1]).toEqual({ method: 'POST', body: { version: 3 } });
    expect(await screen.findByRole('button', { name: /TDS and TCS/ })).toBeInTheDocument();
  });

  it('says the work waits for acceptance and offers no button before it', async () => {
    apiFetch.mockResolvedValue(ws({ library: null, stage: 'acceptance' }));
    render(wrap(<ClauseWorkspace engagementId="g1" auditId="a1" />));
    expect(await screen.findByText(/opens once the audit is accepted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open the 3CD work' })).toBeNull();
  });

  it('sets a fact, asks the client for the list and shows the package', async () => {
    apiFetch.mockResolvedValue(ws());
    render(wrap(<ClauseWorkspace engagementId="g1" auditId="a1" />));
    expect(await screen.findByText('Riya')).toBeInTheDocument();
    expect(screen.getByText('0 settled · 1 to do of 1')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Registered under GST'), { target: { value: 'false' } });
    await waitFor(() => expect(callTo(`${BASE}/facts`)).toBeTruthy());
    expect(callTo(`${BASE}/facts`)![1]).toEqual({
      method: 'PUT',
      body: { facts: { holdsStock: true, gstRegistered: false }, version: 3 },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ask for the standard list' }));
    await waitFor(() => expect(callTo(`${BASE}/information-requests`)).toBeTruthy());
  });

  it('lets the preparer answer, attach evidence and send for review once nothing blocks', async () => {
    apiFetch.mockResolvedValue(ws());
    render(wrap(<ClauseWorkspace engagementId="g1" auditId="a1" />));
    fireEvent.click(await screen.findByRole('button', { name: /TDS and TCS/ }));

    expect(screen.getByText('Attach the evidence: TDS returns.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send for review' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Required to deduct'), { target: { value: 'true' } });
    fireEvent.change(screen.getByLabelText(/Details/), { target: { value: 'Contractors\t194C' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the answer' }));
    await waitFor(() => expect(callTo(`${BASE}/clauses/w34`)).toBeTruthy());
    expect(callTo(`${BASE}/clauses/w34`)![1]).toEqual({
      method: 'PUT',
      body: { answer: { a: true, b: 'Contractors\t194C' }, version: 1 },
    });

    const file = new File(['abc'], 'tds-q4.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Evidence for clause 34'), {
      target: { files: [file] },
    });
    await waitFor(() => expect(callTo(`${BASE}/clauses/w34/evidence`)).toBeTruthy());
    expect(callTo(`${BASE}/clauses/w34/evidence`)![1].body).toEqual({
      filename: 'tds-q4.pdf',
      contentType: 'application/pdf',
      contentBase64: 'QUJD',
    });
  });

  it('sends for review when the paper is ready', async () => {
    apiFetch.mockResolvedValue(
      ws({
        papers: [paper({ status: 'in_progress', answer: { a: false, b: 'Nil' }, blockers: [] })],
      }),
    );
    render(wrap(<ClauseWorkspace engagementId="g1" auditId="a1" />));
    fireEvent.click(await screen.findByRole('button', { name: /TDS and TCS/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send for review' }));
    await waitFor(() =>
      expect(callTo(`${BASE}/clauses/w34/send-for-review`)![1]).toEqual({
        method: 'POST',
        body: { version: 1 },
      }),
    );
  });

  it('shows the portal’s draft field by field, confirms it, and lets the lead refresh drafts', async () => {
    apiFetch.mockResolvedValue(
      ws({
        papers: [
          paper({
            draftSource: 'tds_filings',
            draftAnswer: { a: true, b: '26Q\tQ1\t2025-07-31\t2025-07-25\tYes' },
            draftNote: 'From the 1 TDS/TCS return the firm filed for FY 2025-26.',
          }),
        ],
      }),
    );
    render(wrap(<ClauseWorkspace engagementId="g1" auditId="a1" />));
    fireEvent.click(await screen.findByRole('button', { name: /TDS and TCS/ }));
    const values = document.querySelector('dl[aria-label="Draft values"]')!;
    expect(values).not.toBeNull();
    expect(values).toHaveTextContent('Required to deduct');
    expect(values).toHaveTextContent('Yes');
    expect(values).toHaveTextContent('26Q');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm the draft' }));
    await waitFor(() => expect(callTo(`${BASE}/clauses/w34/confirm-draft`)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Refresh drafts' }));
    await waitFor(() =>
      expect(callTo(`${BASE}/clauses/refresh-drafts`)![1]).toEqual({
        method: 'POST',
        body: { version: 3 },
      }),
    );
  });

  it('offers no draft refresh to someone who is not the partner or manager', async () => {
    apiFetch.mockResolvedValue(ws({ canLead: false }));
    render(wrap(<ClauseWorkspace engagementId="g1" auditId="a1" />));
    expect(await screen.findByRole('button', { name: /TDS and TCS/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh drafts' })).toBeNull();
  });

  it('lets a reviewer send a clause back only with a comment', async () => {
    apiFetch.mockResolvedValue(
      ws({
        canLead: false,
        papers: [
          paper({
            status: 'in_review',
            answer: { a: true, b: 'x' },
            blockers: [],
            canPrepare: false,
            canReview: true,
            preparerName: 'Riya',
            sentForReviewAt: '2026-11-03T05:00:00.000Z',
          }),
        ],
      }),
    );
    render(wrap(<ClauseWorkspace engagementId="g1" auditId="a1" />));
    fireEvent.click(await screen.findByRole('button', { name: /TDS and TCS/ }));
    expect(screen.getByLabelText('Required to deduct')).toBeDisabled();
    expect(screen.getByLabelText('Registered under GST')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();

    const back = screen.getByRole('button', { name: 'Send back' });
    expect(back).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/needed to send it back/), {
      target: { value: 'Tie to the 26AS.' },
    });
    fireEvent.click(back);
    await waitFor(() =>
      expect(callTo(`${BASE}/clauses/w34/review`)![1]).toEqual({
        method: 'POST',
        body: { outcome: 'send_back', comment: 'Tie to the 26AS.', version: 1 },
      }),
    );
  });

  it('shows a ruled-out clause with its reason and lets the preparer reopen it', async () => {
    apiFetch.mockResolvedValue(
      ws({
        papers: [
          paper({
            status: 'not_applicable',
            notApplicableSource: 'person',
            notApplicableReason: 'No payments liable to TDS.',
          }),
        ],
      }),
    );
    render(wrap(<ClauseWorkspace engagementId="g1" auditId="a1" />));
    fireEvent.click(await screen.findByRole('button', { name: /TDS and TCS/ }));
    expect(screen.getByText(/No payments liable to TDS\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(callTo(`${BASE}/clauses/w34/reopen`)).toBeTruthy());
  });
});

describe('packageProgress', () => {
  it('counts Not applicable as settled', () => {
    expect(
      packageProgress({ ...counts, done: 2, not_applicable: 1, in_review: 1, in_progress: 2 }),
    ).toBe('3 settled · 1 in review · 2 to do of 6');
  });
});
