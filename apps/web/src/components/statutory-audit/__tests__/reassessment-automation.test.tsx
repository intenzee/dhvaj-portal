import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { StatutoryAuditReassessment } from '@hsdg/contracts';
import { ReassessmentPanel } from '../reassessment-panel';

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

const file: StatutoryAuditReassessment = {
  workflowInstanceId: 'wf1',
  engagementServiceId: 's1',
  engagementId: 'e1',
  locked: false,
  openCount: 1,
  detections: [
    {
      key: 'materiality:60000',
      changeType: 'materiality_revised',
      reason: 'Performance materiality is now ₹60,000; 1 audit area(s) were planned at ₹75,000.',
      facts: ['03.3 performance materiality: ₹60,000.', 'Revenue: planned at ₹75,000.'],
      scopeAreaIds: ['rev'],
      scopeLabel: '1 area(s): Revenue',
      followThrough: "Updates those areas' materiality to ₹60,000.",
    },
  ],
  events: [
    {
      id: 'ev1',
      changeType: 'risk_changed',
      impact: { framework: false, planning: false, risk: true, work: true, reporting: false },
      reason: 'Significant risk R9 has no procedure responding to it.',
      status: 'open',
      affectedSummary: 'Flagged 2 work area(s).',
      raisedByName: 'Partner P',
      createdAt: '2025-09-01T00:00:00Z',
      resolvedByName: null,
      resolvedAt: null,
      version: 1,
      detectionKey: 'risk:r9',
      progress: { done: 2, total: 2 },
      readyToResolve: true,
    },
  ],
};

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
  apiFetch.mockResolvedValue([file]);
});

describe('Reassessment detects changes in the file', () => {
  it('shows a detected change with its scope and follow-through, raised in one click', async () => {
    const user = userEvent.setup();
    render(wrap(<ReassessmentPanel engagementId="e1" />));
    expect(await screen.findByText('Changes detected in the file')).toBeInTheDocument();
    expect(
      screen.getByText(/Flags 1 area\(s\): Revenue\. Updates those areas' materiality to ₹60,000\./),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Raise$/ }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/reassessments', {
      method: 'POST',
      body: { detectionKey: 'materiality:60000' },
    });
  });

  it('dismisses a detection for good', async () => {
    const user = userEvent.setup();
    render(wrap(<ReassessmentPanel engagementId="e1" />));
    await user.click(await screen.findByRole('button', { name: 'Dismiss: Materiality revised' }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/reassessments/detections/dismiss',
      { method: 'POST', body: { detectionKey: 'materiality:60000' } },
    );
  });

  it('shows progress and when an open reassessment is ready to resolve', async () => {
    render(wrap(<ReassessmentPanel engagementId="e1" />));
    expect(await screen.findByText('Ready to resolve')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 flagged area(s) re-concluded')).toBeInTheDocument();
    expect(screen.getByText('Detected')).toBeInTheDocument();
  });
});
