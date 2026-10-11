import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  EngagementIntelligenceView,
  PlanningCapabilities,
  PlanningConsiderationRuleRecord,
  PlanningGovernanceView,
  PlanningIntelligenceSummary,
  PlanningSignalRecord,
  PlanningSignalRuleRecord,
} from '@hsdg/contracts';
import { PlanningIntelligencePanel } from '../planning-intelligence-panel';
import { goToSourceLink, parseSourceLink, sourceLinkLabel } from '../planning-source-link';
import { PlanningSignalLibrarySection } from '../../admin/planning-signal-library-section';
import { PlanningConsiderationLibrarySection } from '../../admin/planning-consideration-library-section';
import { openAuditPhase } from '../audit-file-nav';
import { ApiError } from '@/lib/api';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
jest.mock('@/lib/principal', () => ({ can: () => true }));
jest.mock('../audit-file-nav', () => ({ openAuditPhase: jest.fn() }));
// The references panel fetches its own data and has its own tests.
jest.mock('../framework-references', () => ({
  FrameworkReferences: ({ anchors }: { anchors?: string[] }) => (
    <div data-testid="refs">{(anchors ?? []).join(',')}</div>
  ),
}));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('03.1 source links', () => {
  beforeEach(() => jest.mocked(openAuditPhase).mockReset());

  it('parses and labels framework, acceptance and planning links', () => {
    expect(parseSourceLink('framework:02.6')).toEqual({ phase: 'framework', place: '02.6' });
    expect(parseSourceLink('section-02/entity-profile')).toBeNull();
    expect(sourceLinkLabel('framework:02.6')).toBe('02.6 CFS / Group Audit');
    expect(sourceLinkLabel('framework:02.8')).toBe('02.8 Audit Framework Summary');
    expect(sourceLinkLabel('acceptance:question-acc_03')).toBe('Section 01 — ACC-03');
    expect(sourceLinkLabel(null)).toBeNull();
  });

  it('opens the owning phase, at the question for Section 01', () => {
    goToSourceLink('acceptance:question-acc_03');
    expect(openAuditPhase).toHaveBeenCalledWith('acceptance', 'question-acc_03');
    goToSourceLink('framework:02.1');
    expect(openAuditPhase).toHaveBeenLastCalledWith('framework');
  });

  it('falls back to the 02.8 summary when the source card rendered empty', () => {
    jest.useFakeTimers();
    try {
      document.body.innerHTML = '<div id="framework-02-4"></div><div id="framework-02-8"></div>';
      const card = document.getElementById('framework-02-4')!;
      const summary = document.getElementById('framework-02-8')!;
      card.scrollIntoView = jest.fn();
      summary.scrollIntoView = jest.fn();
      summary.getBoundingClientRect = () => ({ height: 120 }) as DOMRect;
      goToSourceLink('framework:02.4');
      jest.advanceTimersByTime(2500);
      expect(card.scrollIntoView).not.toHaveBeenCalled();
      expect(summary.scrollIntoView).toHaveBeenCalled();
      expect(summary).toHaveClass('ring-2');
    } finally {
      document.body.innerHTML = '';
      jest.useRealTimers();
    }
  });
});

const rule = (over: Partial<PlanningSignalRuleRecord> = {}): PlanningSignalRuleRecord => ({
  id: 'r1',
  ruleCode: 'PSR-005',
  version: 1,
  ruleKey: 'caro_applicable',
  name: 'CARO 2020 applies',
  triggerSource: 'section_02',
  triggerSection: '02.4',
  triggerCondition: { fact: 'caro', op: 'eq', value: 'applicable' },
  conditionVersion: 1,
  observationTemplate: 'CARO 2020 applies to the entity.',
  whyMayMatter: 'Clause-wise reporting.',
  potentialImplications: 'Plan clause procedures.',
  guidanceAnchors: ['caro_2020'],
  destinations: ['03.5'],
  suggestedAttention: 'standard',
  sourceLink: 'framework:02.4',
  effectiveFrom: '2000-01-01',
  effectiveTo: null,
  active: true,
  methodologyVersion: 'DHVAJ-M1',
  changeNote: 'Seed',
  createdByName: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('Planning Signal Library (admin, §21)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation((_url: string, init?: { method?: string; body?: unknown }) => {
      if (init?.method === 'POST') return Promise.resolve(rule({ version: 3 }));
      return Promise.resolve([
        rule({ id: 'r2', version: 2, changeNote: 'Reworded' }),
        rule(),
        rule({ id: 'r9', ruleCode: 'PSR-101', ruleKey: 'change_fraud', name: 'Fraud change' }),
      ]);
    });
  });

  it('groups versions by rule and appends a version with its reason', async () => {
    const user = userEvent.setup();
    render(wrap(<PlanningSignalLibrarySection />));
    const row = await screen.findByRole('button', { name: /PSR-005 CARO 2020 applies/ });
    expect(within(row).getByText(/v2 · 2 versions/)).toBeInTheDocument();
    expect(screen.getByText('Fraud change')).toBeInTheDocument();

    await user.click(row);
    const add = screen.getByRole('button', { name: 'Add version' });
    expect(add).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason for this version/), 'ICAI revised guidance');
    expect(add).toBeEnabled();
    await user.click(add);

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/planning-signal-rules',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            ruleCode: 'PSR-005',
            changeNote: 'ICAI revised guidance',
            triggerCondition: { fact: 'caro', op: 'eq', value: 'applicable' },
          }),
        }),
      ),
    );
    const body = apiFetch.mock.calls.find(([, i]) => i?.method === 'POST')![1].body;
    expect(body).not.toHaveProperty('ruleKey');
  });
});

const considerationRule = (
  over: Partial<PlanningConsiderationRuleRecord> = {},
): PlanningConsiderationRuleRecord => ({
  id: 'c1',
  ruleCode: 'PCR-015',
  version: 1,
  considerationKey: 'tax_expertise',
  kind: 'resource',
  label: 'Tax expertise',
  basis: 'A restructuring was reported for the current year.',
  matchRuleKeys: [],
  matchChangeCategories: ['restructuring'],
  matchAttention: [],
  effectiveFrom: '2000-01-01',
  effectiveTo: null,
  active: true,
  methodologyVersion: 'DHVAJ-M1',
  changeNote: 'Seed',
  createdByName: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('Strategic Consideration Library (admin, §13.2–13.3, §21)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return Promise.resolve(considerationRule({ version: 2 }));
      if (url === '/planning-signal-rules') return Promise.resolve([rule()]);
      return Promise.resolve([considerationRule()]);
    });
  });

  it('shows what a rule fires on and appends a version with a known signal rule key', async () => {
    const user = userEvent.setup();
    render(wrap(<PlanningConsiderationLibrarySection />));
    const row = await screen.findByRole('button', { name: /PCR-015 Tax expertise/ });
    await user.click(row);
    expect(screen.getByText(/change: Restructuring/i)).toBeInTheDocument();

    const keys = screen.getByLabelText(/Fires on signal rule keys/);
    await user.type(keys, 'no_such_key');
    await user.type(screen.getByLabelText(/Reason for this version/), 'Widened to CARO');
    const add = screen.getByRole('button', { name: 'Add version' });
    expect(add).toBeDisabled();
    expect(await screen.findByText(/Unknown: no_such_key/)).toBeInTheDocument();

    await user.clear(keys);
    await user.type(keys, 'caro_applicable');
    expect(await screen.findByText(/PSR-005 CARO 2020 applies/)).toBeInTheDocument();
    expect(add).toBeEnabled();
    await user.click(add);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/planning-consideration-rules',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            ruleCode: 'PCR-015',
            kind: 'resource',
            matchRuleKeys: ['caro_applicable'],
            matchChangeCategories: ['restructuring'],
            changeNote: 'Widened to CARO',
          }),
        }),
      ),
    );
    const body = apiFetch.mock.calls.find(([, i]) => i?.method === 'POST')![1].body;
    expect(body).not.toHaveProperty('considerationKey');
  });
});

const signal = (over: Partial<PlanningSignalRecord> = {}): PlanningSignalRecord =>
  ({
    id: 's1',
    workflowInstanceId: 'w',
    engagementId: 'e',
    signalCode: 'PS-001',
    source: 'section_02',
    ruleKey: 'cfs_required',
    sourceRef: null,
    sourceLink: 'framework:02.6',
    observation: 'Consolidated financial statements are required.',
    whyMayMatter: 'Group audit.',
    potentialImplications: 'Component work.',
    suggestedAttention: 'enhanced',
    attention: 'enhanced',
    attentionRationale: null,
    managerAssessment: null,
    assessmentRationale: null,
    ownerName: null,
    destinations: [],
    status: 'open',
    isAuto: true,
    ruleCode: 'PSR-007',
    ruleVersion: 1,
    guidanceAnchors: ['sa_600'],
    sourceSection: '02.6',
    sourceChangedAt: '2026-10-01T00:00:00.000Z',
    sourceChangeAcknowledgedAt: null,
    documentId: null,
    version: 1,
    createdAt: '',
    updatedAt: '',
    ...over,
  }) as PlanningSignalRecord;

const summary = (): PlanningIntelligenceSummary =>
  ({
    record: {
      id: 'r',
      workflowInstanceId: 'w',
      engagementId: 'e',
      status: 'intelligence_generated',
      orientation: null,
      orientationNote: null,
      additionalScopeRequired: null,
      additionalScope: null,
      priorYearReviewed: false,
      strategySummary: null,
      intelligenceGeneratedAt: '2026-10-02T00:00:00.000Z',
      intelligenceReviewedAt: null,
      intelligenceReviewedByName: null,
      version: 1,
      createdAt: '',
      updatedAt: '',
    },
    totalSignals: 1,
    openSignals: 1,
    managerFocusAreas: 0,
    furtherInformationRequired: 0,
    partnerAttention: 0,
    openPlanningMatters: 0,
    initialAudit: false,
    completion: [],
  }) as unknown as PlanningIntelligenceSummary;

const view = (over: Partial<EngagementIntelligenceView> = {}): EngagementIntelligenceView => ({
  gate: { unlocked: true, route: 'approved', reason: '' },
  groups: [
    {
      key: 'group',
      title: 'Group & components',
      section: '02.6',
      items: [
        {
          key: 'cfs',
          label: 'Consolidated FS',
          value: 'Required',
          sourceLink: 'framework:02.6',
        },
      ],
    },
  ],
  generatedAt: '2026-10-02T00:00:00.000Z',
  reviewedAt: null,
  reviewedByName: null,
  stale: false,
  sourceChangedSignals: 1,
  ...over,
});

// The Engagement Manager on an open, unapproved 03.1 — every Track A gate is `assess`.
const ALL: PlanningCapabilities = {
  proposeSignals: true,
  addFacts: true,
  assess: true,
  focusAreas: true,
  discussion: true,
  partnerSignals: false,
  partnerReview: false,
  respondToChallenge: true,
  reopen: false,
};
const governanceView = (caps: Partial<PlanningCapabilities> = {}): PlanningGovernanceView => ({
  access: {
    role: 'manager',
    roleLabel: 'Engagement Manager',
    actingAsManager: false,
    employeeId: 'emp-1',
    capabilities: { ...ALL, ...caps },
    approved: false,
    locked: false,
    lockReason: null,
    versionNo: 1,
    versionLabel: 'v1.0',
    openRevision: null,
    revisions: [],
  },
  partnerAttention: { engagementPartnerName: 'Partner A', items: [], outstanding: 0 },
  proposals: {},
  evidenceCounts: {},
  downstreamFlags: [],
});

describe('03.1 Planning Intelligence panel', () => {
  const onChanged = jest.fn();
  beforeEach(() => onChanged.mockReset());
  const mount = (v: EngagementIntelligenceView, caps: Partial<PlanningCapabilities> = {}) => {
    apiFetch.mockReset();
    apiFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.endsWith('/planning-governance')) return Promise.resolve(governanceView(caps));
      if (url.endsWith('/planning-intelligence/facts')) return Promise.resolve(v);
      if (url.endsWith('/planning-intelligence/review')) return Promise.resolve(summary());
      if (url.endsWith('/planning-intelligence') && !init) return Promise.resolve(summary());
      if (url.endsWith('/planning-signals')) return Promise.resolve([signal()]);
      return Promise.resolve([]);
    });
    render(
      wrap(
        <PlanningIntelligencePanel
          engagementId="e"
          workflowInstanceId="w"
          team={[]}
          editable
          onChanged={onChanged}
        />,
      ),
    );
  };

  it('refreshes the Phase 03 list once opening 03.1 has generated it', async () => {
    mount(view());
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('shows the facts with source links and records the review', async () => {
    const user = userEvent.setup();
    mount(view());
    await user.click(
      await screen.findByRole('button', { name: /Engagement Intelligence \(to review\)/ }),
    );
    expect(await screen.findByText('Consolidated FS')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /02.6 CFS \/ Group Audit/ }).length,
    ).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Mark intelligence reviewed' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/engagements/e/statutory-audit/w/planning-intelligence/review',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('flags source-changed signals with rule, guidance and a link to the source', async () => {
    const user = userEvent.setup();
    mount(view());
    expect(await screen.findByText(/no longer matches its Section/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Signal register/ }));
    const card = await screen.findByRole('button', { name: /PS-001/ });
    expect(within(card).getByText('PSR-007 v1')).toBeInTheDocument();
    expect(within(card).getByText('Source changed — reassess')).toBeInTheDocument();
    await user.click(card);
    const refs = screen.getAllByTestId('refs').map((r) => r.textContent);
    expect(refs).toEqual(['view_sa_300,view_sa_315,view_ig_sa_300,view_ig_rba', 'sa_600']);
  });

  it('locks generation until the framework is approved, and asks for a refresh when stale', async () => {
    mount(
      view({
        gate: { unlocked: false, route: 'pending', reason: 'Partner approval pending.' },
        sourceChangedSignals: 0,
      }),
    );
    expect(await screen.findByText(/Partner approval pending/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh intelligence/ })).toBeDisabled();
  });

  it('offers a refresh when Section 01/02 facts moved', async () => {
    mount(view({ stale: true, sourceChangedSignals: 0 }));
    expect(await screen.findByText(/facts changed since the intelligence/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh now' })).toBeEnabled();
  });

  it('leaves the refresh and the review to a role that may assess (§23)', async () => {
    const user = userEvent.setup();
    mount(view({ stale: true, sourceChangedSignals: 0 }), { assess: false });
    expect(await screen.findByText(/facts changed since the intelligence/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh now' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Engagement Intelligence \(to review\)/ }));
    expect(await screen.findByText('Consolidated FS')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Mark intelligence reviewed' }),
    ).not.toBeInTheDocument();
  });

  // Files approved before 03.1 generated itself at AF-02: a team member's read is refused.
  const mountRefused = (error: Error) => {
    let refused = true;
    apiFetch.mockReset();
    apiFetch.mockImplementation((url: string) => {
      if (url.endsWith('/planning-governance')) return Promise.resolve(governanceView());
      if (url.endsWith('/planning-intelligence'))
        return refused ? Promise.reject(error) : Promise.resolve(summary());
      if (url.endsWith('/planning-intelligence/facts')) return Promise.resolve(view());
      return Promise.resolve([]);
    });
    render(
      wrap(
        <PlanningIntelligencePanel
          engagementId="e"
          workflowInstanceId="w"
          team={[]}
          editable
          onChanged={jest.fn()}
        />,
      ),
    );
    return () => {
      refused = false;
    };
  };

  it('tells a team member 03.1 is waiting for the Manager or Partner, then picks it up', async () => {
    const user = userEvent.setup();
    const open = mountRefused(
      new ApiError(
        409,
        '03.1 has not been opened yet — the Engagement Manager or Partner opens it first.',
      ),
    );
    expect(
      await screen.findByText(/The Engagement Manager or Partner opens 03.1 first/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/has not been opened yet/)).not.toBeInTheDocument();
    // Not retried in the background: one read, then the user asks again.
    expect(apiFetch.mock.calls.filter(([u]) => u.endsWith('/planning-intelligence'))).toHaveLength(
      1,
    );
    open();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('button', { name: /Signal register/ })).toBeInTheDocument();
  });

  it('still reports any other failure as an error', async () => {
    mountRefused(new ApiError(403, 'Not on this engagement.'));
    // After the app's one retry (≈1 s back-off).
    expect(
      await screen.findByText('Not on this engagement.', undefined, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
  });
});
