import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AcceptancePanel } from '../acceptance-panel';
import { openAuditPhase } from '../audit-file-nav';

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

const segment = (id: string, segmentKey: string, title: string, state = 'complete') => ({
  id,
  segmentKey,
  title,
  state,
  sortOrder: 1,
  readOnly: false,
  decidedByName: null,
  decidedAt: null,
  version: 1,
  answers: [],
  required: 0,
  answered: 0,
  pending: 0,
  attention: 0,
  attentionItems: [],
  notApplicableReason: null,
});

const acceptance = {
  workflowInstanceId: 'wf1',
  engagementServiceId: 'es1',
  engagementId: 'e1',
  phaseState: 'in_progress',
  engagementProfile: [],
  segments: [
    segment('s2', 'appointment_eligibility', 'Appointment & Eligibility', 'in_progress'),
    segment('s5', 'independence_ethics', 'Independence & Ethics'),
    segment('s8', 'final_acceptance', 'Final Acceptance', 'not_started'),
  ],
  approval: null,
  unresolvedSegmentCount: 1,
  openBlockingMatterCount: 1,
  readyForApproval: false,
  pack: {
    checks: [
      {
        key: 'segments_resolved',
        label: 'Acceptance segments resolved (01.1–01.7)',
        ok: false,
        blocking: true,
        facts: [
          '1 of 2 segments resolved; still open:',
          '• Appointment & Eligibility — 2 of 3 answered',
        ],
        goTo: {
          phaseKey: 'acceptance',
          label: 'Open Appointment & Eligibility',
          anchor: 'segment-appointment_eligibility',
        },
      },
      {
        key: 'adverse_answers',
        label: 'Answers that raise a concern',
        ok: false,
        blocking: false,
        facts: ['1 answer(s) raise a concern:'],
        goTo: null,
      },
    ],
    ready: false,
    attention: 1,
    draftMemo:
      'Engagement acceptance — financial year 2024-25.\nConclusion: accept with conditions.',
    suggestedConclusion: 'accept_with_conditions',
  },
  context: {
    firstYear: true,
    firstYearSource: 'profile',
    otherServices: [],
    independence: { required: 0, completed: 0, pending: 0, threatsDisclosed: 0, rows: [], mine: null },
    fileStatuses: {},
    priorYear: null,
    partner: null,
    manager: null,
  },
};

const matter = {
  id: 'm1',
  workflowInstanceId: 'wf1',
  engagementId: 'e1',
  matterCode: 'M-001',
  section: 'acceptance',
  source: 'acceptance:independence_ethics:independence_threats',
  sourceRef: null,
  title: 'Threats to independence — adverse response requires action/safeguard.',
  category: 'independence',
  severity: 'high',
  isBlocking: true,
  isAuto: true,
  ownerName: null,
  dueDate: null,
  status: 'open',
  resolution: null,
  suggestedResolution: 'Rotated the article assistant off the engagement.',
  approverName: null,
  approvedAt: null,
  documentId: null,
  note: null,
  version: 2,
  createdAt: '',
  updatedAt: '',
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((url: string) =>
    Promise.resolve(url.includes('/matters') ? [matter] : [acceptance]),
  );
});

describe('Section 01 approval pack', () => {
  it('shows what approval needs, suggests the conclusion and drafts the memo', async () => {
    render(wrap(<AcceptancePanel engagementId="e1" />));
    await userEvent.click(await screen.findByRole('button', { name: /Final Acceptance/ }));
    expect(screen.getByText('What approval needs')).toBeInTheDocument();
    expect(screen.getByText('• Appointment & Eligibility — 2 of 3 answered')).toBeInTheDocument();
    expect(screen.getByText(/Worth knowing \(1 — never blocks\)/)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('accept_with_conditions');
    expect(
      screen.getByDisplayValue(/Engagement acceptance — financial year 2024-25/),
    ).toBeInTheDocument();
  });

  it('"Go to" selects the segment it names', async () => {
    render(wrap(<AcceptancePanel engagementId="e1" />));
    await userEvent.click(await screen.findByRole('button', { name: /Final Acceptance/ }));
    await userEvent.click(screen.getByRole('button', { name: /Open Appointment & Eligibility/ }));
    expect(
      await screen.findByRole('heading', { name: 'Appointment & Eligibility' }),
    ).toBeInTheDocument();
    openAuditPhase('acceptance', 'segment-independence_ethics');
    expect(
      await screen.findByRole('heading', { name: 'Independence & Ethics' }),
    ).toBeInTheDocument();
  });

  it('accepts a matter in one step with the basis drafted from the answer', async () => {
    render(wrap(<AcceptancePanel engagementId="e1" />));
    const card = (await screen.findByText(/Matters — 1 open/)).closest('div')!;
    expect(
      within(card).getByDisplayValue('Rotated the article assistant off the engagement.'),
    ).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Accept with approval' }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/matters/m1',
      expect.objectContaining({
        method: 'POST',
        body: {
          status: 'accepted_with_approval',
          resolution: 'Rotated the article assistant off the engagement.',
          version: 2,
        },
      }),
    );
  });
});
