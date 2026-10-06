import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AuditReviewNote, ReviewQueueItem, StatutoryAuditReview } from '@hsdg/contracts';
import { ReviewPanel } from '../review-panel';

const apiFetch = jest.fn();
const toast = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
jest.mock('@/lib/principal', () => ({ can: () => true }));
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const queued = (o: Partial<ReviewQueueItem> & { targetId: string; label: string }): ReviewQueueItem => ({
  targetType: 'procedure',
  workAreaTitle: 'CARO',
  preparerName: 'Staff S',
  reviewerName: 'Partner P',
  reviewLevel: 'partner',
  state: 'ready_for_review',
  dueDate: null,
  isOverdue: false,
  checks: [],
  context: [],
  ready: false,
  suggestedNotes: [],
  openNotes: 0,
  isMine: true,
  ...o,
});

const note = (o: Partial<AuditReviewNote> & { id: string; body: string }): AuditReviewNote => ({
  targetType: 'procedure',
  targetId: 'p9',
  targetLabel: 'P-009 · Payroll',
  reviewLevel: 'manager',
  status: 'open',
  isBlocking: false,
  raisedByName: 'Partner P',
  response: null,
  respondedByName: null,
  respondedAt: null,
  clearedByName: null,
  clearedAt: null,
  version: 1,
  createdAt: '2025-09-01T00:00:00Z',
  updatedAt: '',
  sourceKey: null,
  resolvedInFile: false,
  forMeToAnswer: false,
  forMeToClear: false,
  ...o,
});

const review: StatutoryAuditReview = {
  workflowInstanceId: 'wf1',
  engagementServiceId: 's1',
  engagementId: 'e1',
  summary: {
    pendingManagerReview: 0,
    pendingPartnerReview: 2,
    openReviewNotes: 1,
    overdueReviews: 0,
    blockingOpenNotes: 0,
  },
  queue: [
    queued({
      targetId: 'p1',
      label: 'P-001 · CARO clause working',
      checks: [
        { key: 'conclusion', label: 'Conclusion recorded', ok: false },
        { key: 'evidence', label: 'Evidence attached', ok: true },
      ],
      context: ['Responds to significant risk R2 — check the response is specific to it (SA 330.21).'],
      suggestedNotes: [
        { sourceKey: 'proc:p1:conclusion', body: 'P-001: record the conclusion.', isBlocking: true },
        { sourceKey: 'proc:p1:sample', body: 'P-001: record the sample size.', isBlocking: false },
      ],
    }),
    queued({
      targetId: 'p2',
      label: 'P-002 · Bank confirmations',
      ready: true,
      isMine: false,
      checks: [{ key: 'conclusion', label: 'Conclusion recorded', ok: true }],
    }),
  ],
  notes: [
    note({
      id: 'n1',
      body: 'P-009: no evidence is attached.',
      sourceKey: 'proc:p9:evidence',
      resolvedInFile: true,
      status: 'responded',
      forMeToClear: true,
    }),
  ],
  forMe: { toReview: 1, toAnswer: 0, toClear: 1 },
};

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
  apiFetch.mockResolvedValue([review]);
});

describe('Review reads the file', () => {
  it('shows checks, context and the suggested notes, raised in one click or dismissed', async () => {
    const user = userEvent.setup();
    render(wrap(<ReviewPanel engagementId="e1" />));
    expect(await screen.findByText('P-001: record the conclusion.')).toBeInTheDocument();
    expect(screen.getAllByText('Conclusion recorded')).toHaveLength(2);
    expect(screen.getByText(/Responds to significant risk R2/)).toBeInTheDocument();
    expect(screen.getByText('Ready to approve')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Raise all' }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/review/suggestions/raise', {
      method: 'POST',
      body: { targetId: 'p1' },
    });
    await user.click(screen.getByRole('button', { name: 'Dismiss: P-001: record the sample size.' }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/review/suggestions/dismiss', {
      method: 'POST',
      body: { sourceKey: 'proc:p1:sample' },
    });
  });

  it('approves in one click and returns with the suggested notes', async () => {
    const user = userEvent.setup();
    render(wrap(<ReviewPanel engagementId="e1" />));
    await screen.findByText('P-002 · Bank confirmations');
    const approve = screen.getAllByRole('button', { name: /Approve/ });
    await user.click(approve[1]!);
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/review/decide', {
      method: 'POST',
      body: { targetType: 'procedure', targetId: 'p2', decision: 'approve' },
    });

    await user.click(screen.getAllByRole('button', { name: /^Return$/ })[0]!);
    const box = screen.getByPlaceholderText(/Optional when the suggested notes/);
    await user.type(box, 'Tie out clause 3(ii).');
    const panel = box.closest('.space-y-3') as HTMLElement;
    await user.click(within(panel).getByRole('button', { name: /^Return$/ }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/review/decide', {
      method: 'POST',
      body: {
        targetType: 'procedure',
        targetId: 'p1',
        decision: 'return',
        note: 'Tie out clause 3(ii).',
        raiseSuggested: true,
      },
    });
  });

  it('shows what is waiting on the viewer and flags fixes in the file', async () => {
    const user = userEvent.setup();
    render(wrap(<ReviewPanel engagementId="e1" />));
    expect(await screen.findByText('1 to review')).toBeInTheDocument();
    expect(screen.getByText('Fixed in the file')).toBeInTheDocument();
    expect(screen.getByText('Yours to clear')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Only mine' }));
    expect(screen.queryByText('P-002 · Bank confirmations')).not.toBeInTheDocument();
    expect(screen.getByText('P-001 · CARO clause working')).toBeInTheDocument();
  });
});
