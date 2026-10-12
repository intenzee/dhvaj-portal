import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  MaterialityChallengeRecord,
  MaterialityGovernance,
  MaterialityReassessment,
  MaterialitySummary,
  PlanningCapabilities,
} from '@hsdg/contracts';
import { MaterialityPanel } from '../materiality-panel';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));
jest.mock('@/components/document-preview', () => ({ DocumentPreview: () => null }));

const NONE: PlanningCapabilities = {
  proposeSignals: false,
  addFacts: false,
  assess: false,
  focusAreas: false,
  discussion: false,
  partnerSignals: false,
  partnerReview: false,
  respondToChallenge: false,
  reopen: false,
};
const TEAM: Partial<PlanningCapabilities> = { proposeSignals: true, addFacts: true };
const MANAGER: Partial<PlanningCapabilities> = {
  ...TEAM,
  assess: true,
  focusAreas: true,
  discussion: true,
  respondToChallenge: true,
  reopen: true,
};
const PARTNER: Partial<PlanningCapabilities> = { ...TEAM, partnerReview: true, reopen: true };

const challenge = (over: Partial<MaterialityChallengeRecord> = {}): MaterialityChallengeRecord => ({
  id: 'mc-1',
  code: 'PC-001',
  targetType: 'overall',
  targetRef: null,
  targetLabel: '03.3.5 Overall materiality',
  versionLabel: 'v1.0',
  kind: 'challenge',
  body: 'Why 1% of revenue rather than 5% of normalised PBT?',
  raisedByName: 'Partner A',
  raisedAt: '2026-10-01T00:00:00Z',
  response: null,
  respondedByName: null,
  respondedAt: null,
  status: 'open',
  version: 1,
  ...over,
});

function summary(
  caps: Partial<PlanningCapabilities>,
  opts: {
    status?: 'draft' | 'complete';
    challenges?: MaterialityChallengeRecord[];
    reassessment?: MaterialityReassessment | null;
    planningApproved?: boolean;
  } = {},
): MaterialitySummary {
  const status = opts.status ?? 'draft';
  const governance: MaterialityGovernance = {
    access: {
      role: caps.partnerReview ? 'partner' : caps.assess ? 'manager' : 'team',
      roleLabel: caps.partnerReview ? 'Engagement Partner' : caps.assess ? 'Engagement Manager' : 'Engagement team',
      actingAsManager: false,
      capabilities: { ...NONE, ...caps },
      planningApproved: opts.planningApproved ?? false,
    },
    challenges: opts.challenges ?? [],
    reassessment: opts.reassessment ?? null,
    evidenceCounts: { 'det-1': 2 },
  };
  // Only what the header, Context and Partner review read.
  return {
    determination: {
      id: 'det-1',
      versionNo: 1,
      versionLabel: 'v1.0',
      status,
      version: 5,
      completedByName: status === 'complete' ? 'Manager X' : null,
      principalUsers: ['shareholders_promoters'],
      principalUsersOther: null,
      userFocus: [],
      userFocusOther: null,
      pyOverallMateriality: null,
      pyPerformanceMateriality: null,
      pyClearlyTrivial: null,
      pyBenchmark: null,
      pySource: null,
      pyAuditDifferences: null,
      selectedOm: status === 'complete' ? 1_000_000 : null,
      selectedPm: status === 'complete' ? 750_000 : null,
      selectedCtt: status === 'complete' ? 50_000 : null,
    },
    baseline: null,
    history: [],
    dataset: { ready: true, reason: null },
    context: [],
    methodology: { anyProvisional: false },
    candidates: [],
    adjustments: [],
    specific: [],
    qualitative: [],
    computed: { sourceChanged: false, sourceChangeDetail: null },
    partnerAttention: [],
    revisionItems: [],
    impactPreview: [],
    authorities: [],
    authorityAnchors: [],
    completion: [],
    governance,
  } as unknown as MaterialitySummary;
}

function renderPanel(s: MaterialitySummary, editable = true) {
  apiFetch.mockImplementation((url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return Promise.resolve(s);
    if (url.endsWith('/materiality')) return Promise.resolve(s);
    return Promise.resolve([]);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MaterialityPanel engagementId="e1" workflowInstanceId="wf1" team={[]} editable={editable} onChanged={jest.fn()} />
    </QueryClientProvider>,
  );
}

const openTab = async (name: RegExp) => userEvent.click(await screen.findByRole('button', { name }));
const BASE = '/engagements/e1/statutory-audit/wf1';

beforeEach(() => apiFetch.mockReset());

describe('03.3 §23 role gating', () => {
  it('lets the engagement team prepare the context and attach evidence', async () => {
    renderPanel(summary(TEAM));
    expect(await screen.findByText('Engagement team')).toBeInTheDocument();
    await openTab(/Context$/);
    expect(screen.getByRole('button', { name: 'Save context' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Evidence \(2\)/ })).toBeInTheDocument();
    await openTab(/Partner review/);
    expect(screen.queryByRole('button', { name: /Raise/ })).not.toBeInTheDocument();
  });

  it('keeps everything read-only while Section 03 is not open', async () => {
    renderPanel(summary(MANAGER), false);
    await openTab(/Context$/);
    expect(screen.queryByRole('button', { name: 'Save context' })).not.toBeInTheDocument();
  });

  it('freezes the original draft once Planning is approved', async () => {
    renderPanel(summary(MANAGER, { planningApproved: true }));
    await openTab(/Context$/);
    expect(screen.queryByRole('button', { name: 'Save context' })).not.toBeInTheDocument();
  });

  it('does not offer the team a revision on a completed version', async () => {
    renderPanel(summary(TEAM, { status: 'complete' }));
    expect(await screen.findByText(/is complete and published/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revise materiality/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Require reassessment/ })).not.toBeInTheDocument();
  });
});

describe('03.3 §23 Engagement Partner review', () => {
  it('lets the Partner raise a challenge on an area', async () => {
    renderPanel(summary(PARTNER));
    await openTab(/Partner review/);
    await userEvent.type(screen.getByLabelText(/^Comment/), 'Benchmark looks too high');
    await userEvent.click(screen.getByRole('button', { name: 'Raise challenge' }));
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/materiality/challenges`, {
      method: 'POST',
      body: { targetType: 'overall', targetRef: null, kind: 'challenge', body: 'Benchmark looks too high' },
    });
  });

  it('shows the open count and lets the Manager respond', async () => {
    renderPanel(summary(MANAGER, { challenges: [challenge()] }));
    await openTab(/Partner review \(1\)/);
    expect(screen.getByText(/Why 1% of revenue/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Close challenge/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Response to PC-001'), 'Revenue is the lenders’ covenant measure');
    await userEvent.click(screen.getByRole('button', { name: 'Respond' }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/materiality-challenges/mc-1/respond', {
      method: 'POST',
      body: { response: 'Revenue is the lenders’ covenant measure', version: 1 },
    });
  });

  it('lets the Partner close a challenge only once it is answered', async () => {
    renderPanel(
      summary(PARTNER, {
        challenges: [challenge({ id: 'mc-2', code: 'PC-002', status: 'responded', response: 'Covenant', version: 2 }), challenge()],
      }),
    );
    await openTab(/Partner review \(2\)/);
    const closes = screen.getAllByRole('button', { name: 'Close challenge' });
    expect(closes[0]).toBeEnabled();
    expect(closes[1]).toBeDisabled();
    await userEvent.click(closes[0]!);
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/materiality-challenges/mc-2/close', {
      method: 'POST',
      body: { version: 2 },
    });
  });
});

describe('03.3 §20 / §23 reassessment', () => {
  it('lets the Partner require reassessment of a completed version inline', async () => {
    renderPanel(summary(PARTNER, { status: 'complete' }));
    await userEvent.click(await screen.findByRole('button', { name: /Require reassessment/ }));
    await userEvent.type(screen.getByLabelText(/Why materiality must be reassessed/), 'Going-concern doubt emerged');
    const buttons = screen.getAllByRole('button', { name: /Require reassessment/ });
    await userEvent.click(buttons[buttons.length - 1]!);
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/materiality/require-reassessment`, {
      method: 'POST',
      body: { reason: 'Going-concern doubt emerged', version: 5 },
    });
  });

  it('shows an open flag and lets the Manager record "no change"', async () => {
    renderPanel(
      summary(MANAGER, {
        status: 'complete',
        reassessment: {
          open: true,
          source: 'source_change',
          reason: 'Revenue changed in 03.2 from 10,00,00,000 to 11,00,00,000.',
          flaggedAt: '2026-10-05T00:00:00Z',
          flaggedByName: 'Article B',
          resolution: null,
          resolvedAt: null,
          resolvedByName: null,
        },
      }),
    );
    expect(await screen.findByTestId('materiality-reassessment')).toHaveTextContent(/03\.2 source figures changed/);
    expect(screen.getAllByText('Reassessment required').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Start revision/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Reassessed — no change/ }));
    await userEvent.type(screen.getByLabelText(/still stands/), 'Change is below 2% of the benchmark');
    await userEvent.click(screen.getByRole('button', { name: 'Record reassessment' }));
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/materiality/resolve-reassessment`, {
      method: 'POST',
      body: { resolution: 'Change is below 2% of the benchmark', version: 5 },
    });
  });

  it('shows a resolved reassessment and offers the team no actions', async () => {
    renderPanel(
      summary(TEAM, {
        status: 'complete',
        reassessment: {
          open: false,
          source: 'partner',
          reason: 'Check covenant',
          flaggedAt: '2026-10-05T00:00:00Z',
          flaggedByName: 'Partner A',
          resolution: 'Covenant headroom unchanged',
          resolvedAt: '2026-10-06T00:00:00Z',
          resolvedByName: 'Manager X',
        },
      }),
    );
    expect(await screen.findByText(/Covenant headroom unchanged/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reassessed — no change/ })).not.toBeInTheDocument();
  });
});
