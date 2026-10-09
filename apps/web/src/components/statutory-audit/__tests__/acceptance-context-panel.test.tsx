import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AcceptanceSegment, StatutoryAuditAcceptance } from '@hsdg/contracts';
import { AcceptanceContextPanel } from '../acceptance-context-panel';

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

const segment = {
  id: 's2',
  segmentKey: 'appointment_eligibility',
  title: 'Appointment & Eligibility',
  state: 'in_progress',
  answers: [{ questionKey: 'el_tenure', answer: 'clear', details: {}, documentId: null }],
} as unknown as AcceptanceSegment;

const acc = {
  engagementId: 'e1',
  workflowInstanceId: 'wf1',
  context: {
    firstYear: false,
    fileStatuses: { consent_certificate: 'final' },
    priorYear: {
      financialYear: '2023-24',
      conclusion: 'accept',
      approvedByName: 'Partner A',
      answers: {
        el_firm: { answer: 'clear', details: {} },
        el_tenure: { answer: 'na', details: {} },
        app_02: { answer: '2023-09-30', details: {} },
      },
    },
  },
} as unknown as StatutoryAuditAcceptance;

describe('Section 01 context panel (§13)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation((url: string) => {
      if (url.includes('/matters')) {
        return Promise.resolve([
          {
            id: 'm1',
            matterCode: 'ACC-M-001',
            source: 'acceptance:appointment_eligibility:el_ceiling',
            title: 'Audit ceiling issue',
            description: null,
            status: 'open',
            isBlocking: true,
            ownerName: 'Manager X',
          },
          {
            id: 'm2',
            matterCode: 'ACC-M-002',
            source: 'acceptance:independence_ethics:ind_02',
            title: 'Not this segment',
            description: null,
            status: 'open',
            isBlocking: false,
            ownerName: null,
          },
        ]);
      }
      if (url.endsWith('/review')) {
        return Promise.resolve([
          {
            workflowInstanceId: 'wf1',
            notes: [
              {
                id: 'n1',
                targetType: 'acceptance_segment',
                targetId: 's2',
                targetLabel: 'Section 01 · Appointment & Eligibility',
                body: 'Attach the consent certificate.',
                status: 'open',
                reviewLevel: 'partner',
                isBlocking: false,
                createdAt: '2026-10-01T00:00:00Z',
              },
            ],
          },
        ]);
      }
      return Promise.resolve({});
    });
  });

  it("shows the segment's documents, prior year, matters and review notes", async () => {
    render(wrap(<AcceptanceContextPanel acc={acc} segment={segment} editable canReview />));
    expect(screen.getByText('Final')).toBeInTheDocument();
    expect(screen.getByText('Prior year · FY 2023-24')).toBeInTheDocument();
    // el_firm and el_tenure roll forward (app_02 is a date); el_tenure is answered.
    expect(screen.getByText(/2 answers from last year · 1 already answered/)).toBeInTheDocument();
    expect(await screen.findByText('ACC-M-001')).toBeInTheDocument();
    expect(screen.queryByText('ACC-M-002')).not.toBeInTheDocument();
    expect(await screen.findByText('Attach the consent certificate.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: "Use last year's answers (1)" }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/acceptance/segments/s2/roll-forward',
      { method: 'POST' },
    );
  });
});
