import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  UNDERSTANDING_SECTION_DEFS,
  type BusinessUnderstandingSummary,
  type PlanningCapabilities,
  type UnderstandingChallengeRecord,
} from '@hsdg/contracts';
import { BusinessUnderstandingPanel } from '../business-understanding-panel';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));
jest.mock('@/components/document-preview', () => ({ DocumentPreview: () => null }));
// §25 references read the signed-in user's library; not under test here.
jest.mock('../framework-references', () => ({ FrameworkReferences: () => null }));

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

const challenge = (over: Partial<UnderstandingChallengeRecord> = {}): UnderstandingChallengeRecord => ({
  id: 'ch-1',
  code: 'PC-001',
  targetType: 'section',
  targetRef: 'business_model',
  targetLabel: '03.2.1 Business & Operating Model',
  kind: 'challenge',
  body: 'Is consulting really the only revenue stream?',
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
  over: Partial<BusinessUnderstandingSummary> = {},
): BusinessUnderstandingSummary {
  const status = over.record?.status ?? 'in_progress';
  const complete = status === 'complete';
  return {
    record: { status, industryProfile: 'construction', ba01: null, conclusionSummary: null, version: 4 },
    access: {
      role: caps.partnerReview ? 'partner' : caps.assess ? 'manager' : 'team',
      roleLabel: caps.partnerReview ? 'Engagement Partner' : caps.assess ? 'Engagement Manager' : 'Engagement team',
      actingAsManager: false,
      capabilities: { ...NONE, ...caps },
      locked: complete,
      lockReason: complete ? '03.2 v1.0 is complete — reopen it for a controlled revision to change it.' : null,
      planningLocked: false,
    },
    versionInfo: {
      versionNo: 1,
      versionLabel: 'v1.0',
      completedAt: complete ? '2026-10-02T00:00:00Z' : null,
      completedByName: complete ? 'Manager X' : null,
      reassessmentReason: null,
      reassessmentFlaggedAt: null,
    },
    revisions: [],
    challenges: [],
    evidenceCounts: {},
    authorityAnchors: [],
    industryConsiderationDecisions: {},
    recordIds: { sections: { business_model: 'sec-bm' }, dataset: null },
    sections: UNDERSTANDING_SECTION_DEFS.map((d) => ({
      key: d.key,
      anythingChanged: d.key === 'business_model' ? 'yes' : null,
      answers: {},
      reviewed: false,
      reviewedAt: null,
      context: [],
      version: d.key === 'business_model' ? 2 : 0,
    })),
    industryConsiderations: ['Contract revenue over time (Ind AS 115)'],
    industryProfiles: [
      { key: 'generic', label: 'Generic', description: '' },
      { key: 'construction', label: 'Construction', description: '' },
    ],
    subIndustryOptions: [],
    analyticsMethodology: {
      profileKey: 'construction',
      profileLabel: 'Construction',
      profileVersion: 1,
      methodologyVersion: 'v1',
      resolvedOn: '2026-03-31',
      averageBalances: false,
      debtDefinition: 'Borrowings',
      financeCostBasis: 'finance_cost' as BusinessUnderstandingSummary['analyticsMethodology']['financeCostBasis'],
      metrics: [],
      staleCards: 0,
    },
    dataset: {
      periodEnd: null,
      pyPeriodEnd: null,
      currency: null,
      units: null,
      pyUnits: null,
      cySource: null,
      pySource: null,
      dataStatus: null,
      sourceDate: null,
      preparedByName: null,
      version: 0,
    },
    customMetrics: [],
    values: [],
    analytics: {
      methodologyVersion: 'v1',
      profile: 'construction',
      profileLabel: 'Construction',
      rules: [],
      ready: false,
      warnings: [],
      movements: [],
      ratios: [],
      exceptions: [],
    },
    openInvestigations: 0,
    completion: [],
    ...over,
  };
}

function renderPanel(s: BusinessUnderstandingSummary, editable = true) {
  apiFetch.mockImplementation((url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return Promise.resolve(s);
    if (url.endsWith('/business-understanding')) return Promise.resolve(s);
    return Promise.resolve([]);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BusinessUnderstandingPanel
        engagementId="e1"
        workflowInstanceId="wf1"
        team={[]}
        editable={editable}
        onChanged={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

const openTab = async (name: RegExp) => userEvent.click(await screen.findByRole('button', { name }));
const openSection = async (title: string) =>
  userEvent.click(await screen.findByRole('button', { name: new RegExp(title) }));

beforeEach(() => apiFetch.mockReset());

describe('03.2 §23 role gating', () => {
  it('lets the team save facts but not mark reviewed, confirm considerations or change the profile', async () => {
    renderPanel(summary(TEAM));
    expect(await screen.findByText(/You: Engagement team/)).toBeInTheDocument();
    expect(screen.getByLabelText('Industry analytics profile')).toBeDisabled();
    await openTab(/Understanding \(03\.2\.1–6\)/);
    await openSection('Business & Operating Model');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark reviewed/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Propose Planning Signal/ })).toBeInTheDocument();
    await openSection('Industry');
    expect(screen.getByText('Contract revenue over time (Ind AS 115)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Relevant' })).not.toBeInTheDocument();
  });

  it('lets the Manager mark reviewed and confirm a consideration', async () => {
    renderPanel(summary(MANAGER));
    await openTab(/Understanding \(03\.2\.1–6\)/);
    await openSection('Business & Operating Model');
    expect(screen.getByRole('button', { name: /Save & mark reviewed/ })).toBeEnabled();
    await openSection('Industry');
    await userEvent.type(screen.getByLabelText(/Note on Contract revenue/), 'Long-term contracts');
    await userEvent.click(screen.getByRole('button', { name: 'Relevant' }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/business-understanding/considerations', {
      method: 'POST',
      body: { consideration: 'Contract revenue over time (Ind AS 115)', relevant: true, note: 'Long-term contracts' },
    });
  });

  it('shows nothing editable while Section 03 is not open', async () => {
    renderPanel(summary(MANAGER), false);
    await openTab(/Understanding \(03\.2\.1–6\)/);
    await openSection('Business & Operating Model');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark reviewed/ })).not.toBeInTheDocument();
  });
});

describe('03.2 §20 completion lock and reopen', () => {
  it('freezes a completed 03.2 and lets the Manager reopen it inline with a reason', async () => {
    renderPanel(summary(MANAGER, { record: { status: 'complete', industryProfile: 'construction', ba01: 'yes_complete', conclusionSummary: 'x', version: 7 } }));
    expect(await screen.findByText(/is complete — reopen it/)).toBeInTheDocument();
    expect(screen.getByText(/Completed by Manager X/)).toBeInTheDocument();
    await openTab(/Understanding \(03\.2\.1–6\)/);
    await openSection('Business & Operating Model');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Reopen for revision/ }));
    const reopen = screen.getByRole('button', { name: 'Reopen as v1.1' });
    expect(reopen).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Why is 03\.2 being revised/), 'Client restated the business');
    await userEvent.click(reopen);
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/business-understanding/reopen', {
      method: 'POST',
      body: { reason: 'Client restated the business', version: 7 },
    });
  });

  it('does not offer the team a reopen', async () => {
    renderPanel(summary(TEAM, { record: { status: 'complete', industryProfile: 'construction', ba01: 'yes_complete', conclusionSummary: 'x', version: 7 } }));
    expect(await screen.findByText(/is complete — reopen it/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reopen for revision/ })).not.toBeInTheDocument();
  });

  it('flags a system reassessment', async () => {
    renderPanel(
      summary(MANAGER, {
        record: { status: 'reassessment_required', industryProfile: 'construction', ba01: null, conclusionSummary: 'x', version: 9 },
        versionInfo: {
          versionNo: 2,
          versionLabel: 'v1.1',
          completedAt: null,
          completedByName: null,
          reassessmentReason: 'Figures changed after 03.2 v1.0 was completed: AX-002 needs reassessment.',
          reassessmentFlaggedAt: '2026-10-03T00:00:00Z',
        },
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/AX-002 needs reassessment/);
    expect(screen.getByText('Reassessment required')).toBeInTheDocument();
  });
});

describe('03.2 §23 Partner review', () => {
  it('lets the EP raise a challenge and close one the Manager answered', async () => {
    renderPanel(
      summary(PARTNER, {
        challenges: [challenge({ status: 'responded', response: 'Training income < 1%.', respondedByName: 'Manager X' })],
      }),
    );
    await openTab(/Partner review & revisions \(1\)/);
    expect(screen.getByText(/Training income < 1%/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Respond' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close challenge' }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/understanding-challenges/ch-1/close', {
      method: 'POST',
      body: { version: 1 },
    });
    await userEvent.type(screen.getByLabelText(/^Comment/), 'Check the KPI source.');
    await userEvent.click(screen.getByRole('button', { name: 'Raise challenge' }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/business-understanding/challenges', {
      method: 'POST',
      body: { targetType: 'section', targetRef: null, kind: 'challenge', body: 'Check the KPI source.' },
    });
  });

  it('lets the Manager respond but not raise or close', async () => {
    renderPanel(summary(MANAGER, { challenges: [challenge()] }));
    await openTab(/Partner review & revisions \(1\)/);
    const card = screen.getByText('PC-001').closest('div.space-y-2') as HTMLElement;
    expect(within(card).queryByRole('button', { name: /Close/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Raise/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Response to PC-001'), 'Under 1% of revenue.');
    await userEvent.click(screen.getByRole('button', { name: 'Respond' }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/understanding-challenges/ch-1/respond', {
      method: 'POST',
      body: { response: 'Under 1% of revenue.', version: 1 },
    });
  });
});

describe('03.2 §7 sub-industry from the industry profile', () => {
  const OPTIONS = ['EPC — infrastructure', 'Real estate development'];
  const withIndustry = (answers: Record<string, string>, subIndustryOptions = OPTIONS) => {
    const base = summary(TEAM);
    return summary(TEAM, {
      subIndustryOptions,
      sections: base.sections.map((x) =>
        x.key === 'industry' ? { ...x, anythingChanged: 'no' as const, answers, version: 1 } : x,
      ),
    });
  };
  const saveBody = () =>
    apiFetch.mock.calls.find(([url]) => String(url).endsWith('/business-understanding/sections/industry'))?.[1]
      ?.body as { answers: Record<string, unknown> } | undefined;
  const subIndustry = () => screen.getByRole('combobox', { name: 'Sub-industry' });

  it('offers the profile list and saves the picked value', async () => {
    renderPanel(withIndustry({}));
    await openTab(/Understanding \(03\.2\.1–6\)/);
    await openSection('Industry');
    expect(within(subIndustry()).getByRole('option', { name: 'Other (specify)' })).toBeInTheDocument();
    await userEvent.selectOptions(subIndustry(), 'Real estate development');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveBody()?.answers.sub_industry).toBe('Real estate development');
  });

  it('takes free text under Other', async () => {
    renderPanel(withIndustry({}));
    await openTab(/Understanding \(03\.2\.1–6\)/);
    await openSection('Industry');
    await userEvent.selectOptions(subIndustry(), 'Other (specify)');
    await userEvent.type(screen.getByLabelText('Sub-industry — other'), 'Metro rail signalling');
    expect(screen.queryByText(/Not in the current profile list/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveBody()?.answers.sub_industry).toBe('Metro rail signalling');
  });

  it('keeps a saved value the profile no longer lists, shown as Other', async () => {
    renderPanel(withIndustry({ sub_industry: 'Dredging' }));
    await openTab(/Understanding \(03\.2\.1–6\)/);
    await openSection('Industry');
    expect(subIndustry()).toHaveValue('__other__');
    expect(screen.getByLabelText('Sub-industry — other')).toHaveValue('Dredging');
    expect(screen.getByText(/Not in the current profile list — kept as entered/)).toBeInTheDocument();
  });

  it('keeps an unlisted value visible as Other when the profile changes under an open section', async () => {
    const first = summary(MANAGER, {
      subIndustryOptions: OPTIONS,
      sections: summary(MANAGER).sections.map((x) =>
        x.key === 'industry'
          ? { ...x, anythingChanged: 'no' as const, answers: { sub_industry: 'Real estate development' }, version: 1 }
          : x,
      ),
    });
    let current = first;
    apiFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (init?.method === 'POST' && String(url).endsWith('/business-understanding')) {
        current = {
          ...first,
          record: { ...first.record, industryProfile: 'generic' },
          subIndustryOptions: ['Wholesale', 'Retail'],
        };
        return Promise.resolve(current);
      }
      if (String(url).endsWith('/business-understanding')) return Promise.resolve(current);
      return Promise.resolve([]);
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <BusinessUnderstandingPanel engagementId="e1" workflowInstanceId="wf1" team={[]} editable onChanged={jest.fn()} />
      </QueryClientProvider>,
    );
    await openTab(/Understanding \(03\.2\.1–6\)/);
    await openSection('Industry');
    expect(subIndustry()).toHaveValue('Real estate development');
    await userEvent.selectOptions(screen.getByLabelText('Industry analytics profile'), 'generic');
    expect(await screen.findByRole('option', { name: 'Wholesale' })).toBeInTheDocument();
    expect(subIndustry()).toHaveValue('__other__');
    expect(screen.getByLabelText('Sub-industry — other')).toHaveValue('Real estate development');
  });

  it('stays free text when the profile has no list', async () => {
    renderPanel(withIndustry({ sub_industry: 'Anything' }, []));
    await openTab(/Understanding \(03\.2\.1–6\)/);
    await openSection('Industry');
    expect(screen.queryByRole('combobox', { name: 'Sub-industry' })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Anything')).toBeInTheDocument();
  });
});
