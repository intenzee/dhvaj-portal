import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ReviewPanel } from '../review-panel';
import { TeamPanel } from '../team-panel';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
jest.mock('@/lib/principal', () => ({ can: () => true }));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => apiFetch.mockReset());

describe('Review inline panels', () => {
  beforeEach(() => {
    apiFetch.mockResolvedValue([
      {
        workflowInstanceId: 'wf1',
        summary: {
          pendingManagerReview: 1,
          pendingPartnerReview: 0,
          openReviewNotes: 1,
          overdueReviews: 0,
          blockingOpenNotes: 1,
        },
        queue: [
          {
            targetType: 'procedure',
            targetId: 't1',
            label: 'Revenue cut-off testing',
            reviewLevel: 'manager',
            isOverdue: false,
            preparerName: 'Senior Y',
            reviewerName: null,
            dueDate: null,
          },
        ],
        notes: [
          {
            id: 'n1',
            status: 'open',
            reviewLevel: 'partner',
            isBlocking: true,
            targetLabel: 'Revenue',
            body: 'Extend cut-off testing to 10 days after year end',
            raisedByName: 'Partner A',
            createdAt: '2026-09-20T10:00:00Z',
            response: 'Extended sample attached',
            respondedByName: 'Senior Y',
            respondedAt: '2026-09-21T10:00:00Z',
            clearedByName: null,
            clearedAt: null,
            version: 1,
          },
        ],
      },
    ]);
  });

  it('opens a review note inline under its row with its response and actions', async () => {
    const user = userEvent.setup();
    render(wrap(<ReviewPanel engagementId="e1" />));

    const row = await screen.findByRole('button', { name: /Extend cut-off testing/ });
    // The response is detail — only shown once the note is opened.
    expect(screen.queryByText('Extended sample attached')).not.toBeInTheDocument();

    await user.click(row);
    const panel = screen.getByRole('region', { name: 'Review note' });
    expect(within(panel).getByText('Extended sample attached')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Clear/ })).toBeInTheDocument();

    await user.click(within(panel).getByTitle('Respond'));
    expect(within(panel).getByText('Submit response')).toBeInTheDocument();

    // The − toggle on the panel collapses it back into the row.
    await user.click(within(panel).getByRole('button', { name: 'Collapse Review note' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('records a note against a queue item inline under its row', async () => {
    const user = userEvent.setup();
    render(wrap(<ReviewPanel engagementId="e1" />));
    await user.click(await screen.findByRole('button', { name: /Record note/ }));
    const panel = screen.getByRole('region', { name: 'Record review note' });
    expect(within(panel).getByText('Revenue cut-off testing')).toBeInTheDocument();
    expect(within(panel).getByText(/Blocking — prevents completion/)).toBeInTheDocument();
  });
});

describe('Team inline panels', () => {
  beforeEach(() => {
    apiFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith('/team/emp1')
          ? {
              responsibility: 'Revenue and receivables',
              plannedHours: 20,
              actualHours: 6,
              openReviewNotes: 0,
              ownedAreas: [{ id: 'a1', ref: 'A-01', title: 'Revenue', state: 'in_progress' }],
              ownedProcedures: [],
              reviewingProcedures: [],
            }
          : [
              {
                workflowInstanceId: 'wf1',
                engagementPartnerName: 'Partner A',
                engagementManagerName: 'Manager X',
                members: [
                  {
                    employeeId: 'emp1',
                    name: 'Senior Y',
                    role: 'Senior',
                    workItems: 3,
                    plannedHours: 20,
                    actualHours: 6,
                    isReviewer: false,
                  },
                ],
                totals: { workItems: 3, plannedHours: 20, actualHours: 6 },
              },
            ],
      ),
    );
  });

  it("opens a person's work inline under its row", async () => {
    const user = userEvent.setup();
    render(wrap(<TeamPanel engagementId="e1" />));

    await user.click(await screen.findByRole('button', { name: /Senior Y/ }));
    const panel = screen.getByRole('region', { name: 'Senior Y' });
    expect(await within(panel).findByText('Revenue and receivables')).toBeInTheDocument();
    expect(within(panel).getByText('A-01')).toBeInTheDocument();
  });
});
