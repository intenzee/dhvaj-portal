import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { TaxAuditObservation, TaxAuditReview, TaxAuditReviewPoint } from '@hsdg/contracts';
import { ReviewDesk } from '../review-desk';

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

const BASE = '/engagements/g1/tax-audits/a1';

const point = (over: Partial<TaxAuditReviewPoint> = {}): TaxAuditReviewPoint => ({
  id: 'p1',
  workingPaperId: 'w34',
  clauseNo: '34',
  level: 'senior',
  body: 'Tie 194C to the returns.',
  status: 'open',
  raisedByName: 'Senior Y',
  raisedAt: '2026-11-03T05:00:00.000Z',
  response: null,
  respondedByName: null,
  respondedAt: null,
  clearedByName: null,
  clearedAt: null,
  canRespond: false,
  canClear: false,
  version: 1,
  ...over,
});

const flag = (over: Partial<TaxAuditObservation> = {}): TaxAuditObservation => ({
  id: 'o1',
  workingPaperId: 'w34',
  clauseNo: '34',
  wording: 'TDS on rent paid late.',
  status: 'proposed',
  kind: null,
  decisionNote: null,
  decidedByName: null,
  decidedAt: null,
  raisedByName: 'Article North',
  createdAt: '2026-11-03T05:00:00.000Z',
  canEdit: false,
  version: 1,
  ...over,
});

const review = (over: Partial<TaxAuditReview> = {}): TaxAuditReview => ({
  auditId: 'a1',
  engagementId: 'g1',
  financialYear: '2025-26',
  stage: 'review',
  signingPartnerId: 'pb',
  signingPartnerName: 'Partner B',
  chain: [
    {
      level: 'senior',
      signoff: {
        level: 'senior',
        employeeId: 's',
        employeeName: 'Senior Y',
        signedOffAt: '2026-11-03T05:00:00.000Z',
      },
    },
    { level: 'manager', signoff: null },
    { level: 'partner', signoff: null },
  ],
  points: [],
  observations: [],
  report: [],
  unsettledClauses: [],
  unconfirmedDrafts: [],
  startBlockers: [],
  signingBlockers: ['The signing Partner has not signed off the review.'],
  myLevel: 'manager',
  canStart: false,
  canSignOff: 'manager',
  canDecide: false,
  editable: true,
  version: 7,
  ...over,
});

const serve = (r: TaxAuditReview) =>
  apiFetch.mockImplementation((url: string) =>
    Promise.resolve(url.endsWith('/clauses') ? { papers: [{ id: 'w34', clauseNo: '34' }] } : r),
  );
const callTo = (url: string) =>
  apiFetch.mock.calls.find((c) => c[0] === url) as
    [string, { method?: string; body?: unknown }] | undefined;

describe('ReviewDesk', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    toast.mockReset();
  });

  it('sends the 3CD for review only once every clause is settled', async () => {
    serve(
      review({ stage: 'clause_work', canStart: true, startBlockers: ['Finish clause 34 first.'] }),
    );
    render(wrap(<ReviewDesk engagementId="g1" auditId="a1" />));
    expect(await screen.findByText('Finish clause 34 first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send the 3CD for review' })).toBeDisabled();
  });

  it('shows the chain and signs off the viewer’s level', async () => {
    serve(review());
    render(wrap(<ReviewDesk engagementId="g1" auditId="a1" />));
    expect(await screen.findByText(/Signed off by Senior Y/)).toBeInTheDocument();
    expect(screen.getByText('Waiting for Partner B')).toBeInTheDocument();
    expect(
      screen.getByText('The signing Partner has not signed off the review.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign off' }));
    await waitFor(() =>
      expect(callTo(`${BASE}/review/sign-off`)![1]).toEqual({
        method: 'POST',
        body: { level: 'manager', version: 7 },
      }),
    );
  });

  it('raises a point on a clause, responds and clears', async () => {
    serve(
      review({
        points: [
          point({ canRespond: true }),
          point({ id: 'p2', status: 'responded', response: 'Tied.', canClear: true, version: 2 }),
        ],
      }),
    );
    render(wrap(<ReviewDesk engagementId="g1" auditId="a1" />));
    fireEvent.change(await screen.findByLabelText('Raise a point (Manager review)'), {
      target: { value: 'Recheck MSME.' },
    });
    const on = screen.getAllByLabelText('On')[0]!;
    await waitFor(() => expect(within(on).getByText('Clause 34')).toBeInTheDocument());
    fireEvent.change(on, { target: { value: 'w34' } });
    fireEvent.click(screen.getByRole('button', { name: 'Raise' }));
    await waitFor(() =>
      expect(callTo(`${BASE}/review/points`)![1].body).toEqual({
        body: 'Recheck MSME.',
        workingPaperId: 'w34',
      }),
    );

    fireEvent.change(screen.getByLabelText('Response'), { target: { value: 'Done.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Respond' }));
    await waitFor(() =>
      expect(callTo(`${BASE}/review/points/p1/respond`)![1].body).toEqual({
        response: 'Done.',
        version: 1,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() =>
      expect(callTo(`${BASE}/review/points/p2/clear`)![1].body).toEqual({ version: 2 }),
    );
  });

  it('lets the signing Partner decide a flag, leaving it out only with a note', async () => {
    serve(review({ canDecide: true, observations: [flag()] }));
    render(wrap(<ReviewDesk engagementId="g1" auditId="a1" />));
    expect(await screen.findByText('TDS on rent paid late.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave out' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Observation' }));
    await waitFor(() =>
      expect(callTo(`${BASE}/observations/o1/decide`)![1].body).toEqual({
        outcome: 'observation',
        note: undefined,
        version: 1,
      }),
    );
  });

  it('lists what the report will say, qualifications as the server orders them', async () => {
    const q = flag({
      id: 'o2',
      clauseNo: null,
      status: 'accepted',
      kind: 'qualification',
      wording: 'No stock records.',
    });
    const o = flag({ status: 'accepted', kind: 'observation' });
    serve(review({ observations: [o, q], report: [q, o], myLevel: null, canSignOff: null }));
    render(wrap(<ReviewDesk engagementId="g1" auditId="a1" />));
    const items = within(
      (await screen.findByText('What the report will list')).closest('section')!,
    ).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Qualification: No stock records.',
      'Observation (clause 34): TDS on rent paid late.',
    ]);
    expect(screen.queryByLabelText(/Raise a point/)).toBeNull();
  });
});
