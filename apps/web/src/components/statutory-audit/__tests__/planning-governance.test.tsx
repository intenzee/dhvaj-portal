import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  PartnerAttentionItem,
  PlanningCapabilities,
  PlanningCapability,
  PlanningGovernanceView,
} from '@hsdg/contracts';
import {
  PartnerAttentionPanel,
  PlanningGovernanceProvider,
  PlanningGovernanceStrip,
  type PlanningGovernance,
} from '../planning-governance';
import { PlanningEvidence } from '../planning-evidence';

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
const BASE = '/engagements/e1/statutory-audit/wf1';

const item = (over: Partial<PartnerAttentionItem> = {}): PartnerAttentionItem => ({
  id: 'att-1',
  kind: 'signal',
  targetId: 'sig-1',
  code: 'PS-004',
  title: 'Whistle-blower complaint about revenue cut-off.',
  detail: null,
  attention: 'immediate_partner',
  managerAssessment: null,
  surfacedAt: '2026-10-01T00:00:00Z',
  status: 'surfaced',
  raisedByPartner: false,
  partnerNote: null,
  challenge: null,
  challengedAt: null,
  managerResponse: null,
  respondedByName: null,
  respondedAt: null,
  reviewedByName: null,
  reviewedAt: null,
  version: 1,
  ...over,
});

function governance(
  caps: Partial<PlanningCapabilities>,
  over: Partial<PlanningGovernanceView['access']> = {},
  items: PartnerAttentionItem[] = [],
): PlanningGovernance {
  const capabilities = { ...NONE, ...caps };
  const view: PlanningGovernanceView = {
    access: {
      role: 'manager',
      roleLabel: 'Engagement Manager',
      actingAsManager: false,
      employeeId: 'emp-1',
      capabilities,
      approved: false,
      locked: false,
      lockReason: null,
      versionNo: 1,
      versionLabel: 'v1.0',
      openRevision: null,
      revisions: [],
      ...over,
    },
    partnerAttention: {
      engagementPartnerName: 'Partner A',
      items,
      outstanding: items.filter((i) => i.status !== 'acknowledged').length,
    },
    proposals: {},
    evidenceCounts: {},
    downstreamFlags: [],
  };
  const has = (c: PlanningCapability) => capabilities[c];
  return {
    view,
    engagementId: 'e1',
    base: BASE,
    has,
    can: (c) => has(c) && !view.access.locked,
    refresh: jest.fn(),
  };
}

function wrap(gov: PlanningGovernance, ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PlanningGovernanceProvider value={gov}>{ui}</PlanningGovernanceProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({});
});

describe('03.1 Partner Attention queue', () => {
  it('lets the EP acknowledge an item inline (no pop-up)', async () => {
    const user = userEvent.setup();
    render(
      wrap(
        governance({ partnerReview: true }, { role: 'partner' }, [item()]),
        <PartnerAttentionPanel signals={[]} focus={[]} />,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await user.click(screen.getAllByRole('button', { name: 'Acknowledge' }).at(-1)!);
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/planning-attention/att-1/acknowledge`, {
      method: 'POST',
      body: { note: undefined, version: 1 },
    });
  });

  it('gives the Manager only "Respond" — and only once the EP challenged', () => {
    const { rerender } = render(
      wrap(
        governance({ assess: true, respondToChallenge: true }, {}, [item()]),
        <PartnerAttentionPanel signals={[]} focus={[]} />,
      ),
    );
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Respond/ })).not.toBeInTheDocument();
    rerender(
      wrap(
        governance({ assess: true, respondToChallenge: true }, {}, [
          item({ status: 'challenged', challenge: 'Forensic support?' }),
        ]),
        <PartnerAttentionPanel signals={[]} focus={[]} />,
      ),
    );
    expect(screen.getByRole('button', { name: /Respond to challenge/ })).toBeInTheDocument();
    expect(screen.getByText(/Forensic support\?/)).toBeInTheDocument();
  });
});

describe('03.1 controlled revision strip', () => {
  it('shows the freeze and reopens with a reason', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue(governance({}, { versionLabel: 'v1.1' }).view);
    render(
      wrap(
        governance(
          { assess: true, reopen: true },
          {
            approved: true,
            locked: true,
            lockReason: 'Planning was approved in 03.12; 03.1 v1.0 is frozen.',
          },
        ),
        <PlanningGovernanceStrip />,
      ),
    );
    expect(screen.getByText(/v1\.0 is frozen/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Reopen for revision/ }));
    const go = screen.getByRole('button', { name: 'Reopen 03.1' });
    expect(go).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'Acquisition announced.');
    await user.click(go);
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/planning-governance/reopen`, {
      method: 'POST',
      body: { reason: 'Acquisition announced.' },
    });
  });

  it('offers no reopen to the engagement team', () => {
    render(
      wrap(
        governance(
          { proposeSignals: true, addFacts: true },
          { role: 'team', roleLabel: 'Engagement team', locked: true, lockReason: 'Frozen.' },
        ),
        <PlanningGovernanceStrip />,
      ),
    );
    expect(screen.getByText('You: Engagement team')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reopen/ })).not.toBeInTheDocument();
  });
});

describe('03.1 evidence', () => {
  it('lets a Senior link an existing file but not upload one', async () => {
    const user = userEvent.setup();
    apiFetch.mockImplementation((url: string) =>
      url.includes('/planning-evidence?')
        ? Promise.resolve({
            targetType: 'change',
            targetId: 'chg-1',
            files: [],
            canAdd: true,
            canUpload: false,
            m365Enabled: false,
          })
        : Promise.resolve({ items: [] }),
    );
    render(
      wrap(
        governance({ proposeSignals: true, addFacts: true }, { role: 'team' }),
        <PlanningEvidence targetType="change" targetId="chg-1" />,
      ),
    );
    await user.click(screen.getByRole('button', { name: /Evidence/ }));
    expect(await screen.findByRole('button', { name: /Link Existing File/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add File/ })).not.toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(
      `${BASE}/planning-evidence?targetType=change&targetId=chg-1`,
    );
  });
});
