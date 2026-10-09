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

const signoff = {
  workflowInstanceId: 'wf1',
  header: {
    status: 'attention_required',
    completedSegments: 1,
    applicableSegments: 2,
    preparedByName: 'Asha Manager',
    engagementPartnerName: 'Ravi Partner',
    openMatterCount: 1,
    openBlockingMatterCount: 1,
  },
  finalSegmentState: 'locked',
  readiness: [
    {
      key: 'appointment_eligibility',
      label: 'Appointment & Eligibility',
      statusLabel: 'In Progress',
      ok: false,
      anchor: 'segment-appointment_eligibility',
    },
    {
      key: 'independence_ethics',
      label: 'Independence & Ethics',
      statusLabel: 'Complete',
      ok: true,
      anchor: 'segment-independence_ethics',
    },
  ],
  openMatters: [
    {
      id: 'm1',
      code: 'M-001',
      title: 'Threats to independence — adverse response requires action/safeguard.',
      severity: 'high',
      isBlocking: true,
      anchor: 'segment-independence_ethics',
    },
  ],
  blockers: [
    'Appointment & Eligibility is in progress.',
    '1 blocking acceptance matter must be resolved or accepted with approval.',
  ],
  recommendation: null as Record<string, unknown> | null,
  decisions: [],
  callerIsEngagementPartner: true,
  canSubmit: true,
  canDecide: false,
  canReopen: false,
  draftMemo: 'Engagement acceptance — financial year 2024-25.',
};

let signoffView: typeof signoff = signoff;

beforeEach(() => {
  apiFetch.mockReset();
  signoffView = signoff;
  apiFetch.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('/matters')
        ? [matter]
        : url.endsWith('/acceptance/files')
          ? {
              workflowInstanceId: 'wf1',
              sectionLocked: false,
              callerIsEngagementPartner: true,
              m365Enabled: false,
              files: [],
              templates: [],
            }
        : /\/acceptance\/(signoff|recommend|approve)$/.test(url)
          ? signoffView
          : [acceptance],
    ),
  );
});

describe('Section 01 final acceptance', () => {
  it('shows the header, readiness and blockers, and gates a clear recommendation', async () => {
    render(wrap(<AcceptancePanel engagementId="e1" />));
    expect(await screen.findByText('Attention Required')).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 segments complete · Prepared by Asha Manager/)).toBeInTheDocument();
    // The 01.8 row shows its derived state.
    expect(screen.getByRole('button', { name: /Final Acceptance\s*Locked/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Final Acceptance/ }));
    expect(
      await screen.findByText(/Engagement cannot yet be accepted\. 2 matters require attention\./),
    ).toBeInTheDocument();
    expect(screen.getAllByText('M-001').length).toBeGreaterThan(0);

    const submit = screen.getByRole('button', { name: /Submit to Engagement Partner/ });
    const rec = screen.getByRole('combobox', { name: /Recommendation/ });
    await userEvent.selectOptions(rec, 'accept');
    expect(submit).toBeDisabled();
    await userEvent.selectOptions(rec, 'accept_with_safeguards');
    expect(submit).toBeDisabled(); // comments are mandatory
    await userEvent.type(screen.getByRole('textbox', { name: /Comments/ }), 'Rotate the assistant.');
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/acceptance/recommend',
      expect.objectContaining({
        method: 'POST',
        body: { recommendation: 'accept_with_safeguards', comments: 'Rotate the assistant.' },
      }),
    );
  });

  it('lets only the Engagement Partner conclude, with safeguards for a conditional acceptance', async () => {
    signoffView = {
      ...signoff,
      blockers: [],
      finalSegmentState: 'ready_for_approval',
      canSubmit: false,
      canDecide: true,
      recommendation: {
        id: 'r1',
        cycle: 1,
        recommendation: 'accept_with_safeguards',
        comments: 'Rotate the assistant.',
        status: 'submitted',
        submittedByName: 'Asha Manager',
        submittedAt: '2024-04-10T00:00:00Z',
      },
    };
    render(wrap(<AcceptancePanel engagementId="e1" />));
    await userEvent.click(await screen.findByRole('button', { name: /Final Acceptance/ }));
    const record = await screen.findByRole('button', { name: /Record conclusion/ });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Conclusion/ }), 'accept_with_conditions');
    expect(record).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: /Safeguards/ }), 'Assistant rotated off.');
    expect(record).toBeEnabled();
    await userEvent.click(record);
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/acceptance/approve',
      expect.objectContaining({
        body: expect.objectContaining({ conclusion: 'accept_with_conditions', safeguards: 'Assistant rotated off.' }),
      }),
    );
  });

  it('"Go to" selects the segment it names', async () => {
    render(wrap(<AcceptancePanel engagementId="e1" />));
    await userEvent.click(await screen.findByRole('button', { name: /Final Acceptance/ }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Go to' }))[0]!);
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
