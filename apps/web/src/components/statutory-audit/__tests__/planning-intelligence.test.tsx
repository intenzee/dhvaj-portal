import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  EngagementIntelligenceView,
  PlanningIntelligenceSummary,
  PlanningSignalRecord,
  PlanningSignalRuleRecord,
} from '@hsdg/contracts';
import { PlanningIntelligencePanel } from '../planning-intelligence-panel';
import { goToSourceLink, parseSourceLink, sourceLinkLabel } from '../planning-source-link';
import { PlanningSignalLibrarySection } from '../../admin/planning-signal-library-section';
import { openAuditPhase } from '../audit-file-nav';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
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
    apiFetch.mockImplementation((url: string, init?: { method?: string; body?: unknown }) => {
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

describe('03.1 Planning Intelligence panel', () => {
  const mount = (v: EngagementIntelligenceView) => {
    apiFetch.mockReset();
    apiFetch.mockImplementation((url: string, init?: { method?: string }) => {
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
          onChanged={jest.fn()}
        />,
      ),
    );
  };

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
});
