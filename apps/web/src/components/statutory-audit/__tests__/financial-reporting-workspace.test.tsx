import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { StatutoryAuditFinancialReporting } from '@hsdg/contracts';
import { FinancialReportingWorkspace } from '../financial-reporting-workspace';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));

const URL = '/engagements/e1/statutory-audit/wf1/financial-reporting';

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function fixture(
  over: Partial<StatutoryAuditFinancialReporting> = {},
): StatutoryAuditFinancialReporting {
  return {
    workflowInstanceId: 'wf1',
    auditFinancialYear: '2024-25',
    assessment: {
      id: 'sa1',
      state: 'system_suggested_applicable',
      systemOutcome: 'ind_as',
      systemBasis: 'Listed on NSE — Rule 4(1)(ii)(a).',
      conclusion: null,
      basis: null,
      isOverridden: false,
      needsReevaluation: false,
      authorityProvisionId: 'p1',
      version: 3,
    },
    baseFacts: {
      auditPeriodStart: '2024-04-01',
      listingStatus: 'listed',
      isCompany: true,
      isPrivateCompany: false,
      specialEntityTypes: [],
      priorFramework: null,
    },
    capturedFacts: {
      isListedOnSmeExchange: false,
      priorIndAs: false,
      voluntaryIndAs: false,
      groupTriggersIndAs: false,
    },
    detail: {
      applicabilityType: 'mandatory',
      effectiveFromFy: '2017-18',
      primaryTrigger: 'Equity listed on NSE',
      secondaryTriggers: [],
      entityBranch: 'corporate',
      confidence: 'determined',
      limitApplied: 'Listed — any net worth',
      rulesApplied: [
        {
          ruleCode: 'FRF_INDAS_CORP_LISTED_P2',
          ruleVersionId: 'v1',
          label: 'Listed company — phase II',
          effectiveFrom: '2017-04-01',
          result: 'triggered',
        },
      ],
      factsUsed: [
        {
          key: 'listing',
          label: 'Listing status',
          value: 'Listed (NSE)',
          source: '02.1 Card B',
          anchor: 'profile-card-b',
        },
      ],
      missingFacts: [],
    },
    professionalAction: null,
    pendingReason: null,
    partnerApproval: {
      required: false,
      reason: null,
      approvedAt: null,
      approvedByName: null,
      note: null,
    },
    firstTimeAdoption: { system: false, confirmed: null, reason: null, effective: false },
    completion: {
      complete: false,
      status: 'in_progress',
      items: [
        { key: 'system_conclusion', label: 'System conclusion generated', met: true, detail: null },
        {
          key: 'professional_conclusion',
          label: 'Professional conclusion recorded',
          met: false,
          detail: null,
        },
        { key: 'smc', label: 'SMC assessed', met: null, detail: null },
      ],
    },
    memoSuggested: false,
    blockingReviewOpen: false,
    approved: false,
    viewerIsPartner: false,
    masterFacts: [],
    ...over,
  } as unknown as StatutoryAuditFinancialReporting;
}

const partnerRequired = (reason: string) =>
  ({ required: true, reason, approvedAt: null, approvedByName: null, note: null }) as never;

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({});
});

describe('02.2 financial reporting workspace', () => {
  it('shows the system assessment, the facts used and only relevant checklist items', () => {
    render(wrap(<FinancialReportingWorkspace engagementId="e1" fr={fixture()} canManage />));
    expect(screen.getByText('Equity listed on NSE')).toBeInTheDocument();
    expect(screen.getByText('FY 2017-18')).toBeInTheDocument();
    expect(screen.getByText('FRF_INDAS_CORP_LISTED_P2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '02.1 Card B' })).toBeInTheDocument();
    expect(screen.getByText('Professional conclusion recorded')).toBeInTheDocument();
    expect(screen.queryByText('SMC assessed')).not.toBeInTheDocument();
    // First-time adoption shows for Ind AS; the SMC sub-assessment does not.
    expect(screen.getByText(/FRF-06 Is this the company/)).toBeInTheDocument();
    expect(screen.queryByText(/SMC sub-assessment/)).not.toBeInTheDocument();
  });

  it('confirms the system assessment', async () => {
    const user = userEvent.setup();
    render(wrap(<FinancialReportingWorkspace engagementId="e1" fr={fixture()} canManage />));
    await user.click(screen.getByRole('button', { name: /Confirm System Assessment/ }));
    expect(apiFetch).toHaveBeenCalledWith(`${URL}/decision`, {
      method: 'POST',
      body: { action: 'confirm', version: 3 },
    });
  });

  it('overrides only with a framework and a reason', async () => {
    const user = userEvent.setup();
    render(wrap(<FinancialReportingWorkspace engagementId="e1" fr={fixture()} canManage />));
    await user.click(screen.getByRole('button', { name: 'Override Assessment' }));
    const record = screen.getByRole('button', { name: 'Record override' });
    expect(record).toBeDisabled();
    await user.selectOptions(screen.getByLabelText(/^Framework/), 'accounting_standards');
    expect(record).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason \(mandatory\)/), 'Listing was withdrawn');
    await user.click(record);
    expect(apiFetch).toHaveBeenCalledWith(`${URL}/decision`, {
      method: 'POST',
      body: {
        action: 'override',
        conclusion: 'accounting_standards',
        basis: 'Listing was withdrawn',
        version: 3,
      },
    });
  });

  it('marks information pending with the missing item', async () => {
    const user = userEvent.setup();
    render(wrap(<FinancialReportingWorkspace engagementId="e1" fr={fixture()} canManage />));
    await user.click(screen.getByRole('button', { name: 'Information Pending' }));
    await user.type(screen.getByLabelText(/Which information is pending/), 'FY 2023-24 net worth');
    await user.click(screen.getByRole('button', { name: 'Mark Information Pending' }));
    expect(apiFetch).toHaveBeenCalledWith(`${URL}/decision`, {
      method: 'POST',
      body: { action: 'information_pending', pendingReason: 'FY 2023-24 net worth', version: 3 },
    });
  });

  it('cannot confirm when the system could not determine the framework', () => {
    const fr = fixture();
    fr.assessment.systemOutcome = 'professional_review_required' as never;
    render(wrap(<FinancialReportingWorkspace engagementId="e1" fr={fr} canManage />));
    expect(screen.getByRole('button', { name: /Confirm System Assessment/ })).toBeDisabled();
  });

  it('lets the Engagement Partner approve an override', async () => {
    const user = userEvent.setup();
    const fr = fixture({
      viewerIsPartner: true,
      partnerApproval: partnerRequired('The team overrode the system assessment'),
    });
    fr.assessment.state = 'overridden' as never;
    fr.assessment.conclusion = 'accounting_standards' as never;
    fr.assessment.isOverridden = true;
    render(wrap(<FinancialReportingWorkspace engagementId="e1" fr={fr} canManage />));
    await user.type(screen.getByLabelText(/Approval note/), 'Agreed');
    await user.click(screen.getByRole('button', { name: /Approve as Engagement Partner/ }));
    expect(apiFetch).toHaveBeenCalledWith(`${URL}/partner-approve`, {
      method: 'POST',
      body: { note: 'Agreed', version: 3 },
    });
  });

  it('shows awaiting approval to someone who is not the Engagement Partner', () => {
    const fr = fixture({ partnerApproval: partnerRequired('Specialised framework') });
    render(wrap(<FinancialReportingWorkspace engagementId="e1" fr={fr} canManage />));
    expect(screen.getByText('Awaiting Engagement Partner approval.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Approve as Engagement Partner/ }),
    ).not.toBeInTheDocument();
  });

  it('records the FRF-01 prior framework and FRF-02 answer', async () => {
    const user = userEvent.setup();
    render(wrap(<FinancialReportingWorkspace engagementId="e1" fr={fixture()} canManage />));
    await user.click(screen.getByRole('button', { name: /02.2A Framework history/ }));
    await user.selectOptions(screen.getByLabelText(/FRF-01/), 'accounting_standards');
    expect(apiFetch).toHaveBeenCalledWith(`${URL}/facts`, {
      method: 'POST',
      body: {
        priorFramework: 'accounting_standards',
        priorFrameworkSource: 'Prior-year financial statements (team)',
        version: 3,
      },
    });
    await user.selectOptions(screen.getByLabelText(/FRF-02/), 'no');
    expect(apiFetch).toHaveBeenCalledWith(`${URL}/facts`, {
      method: 'POST',
      body: { indAsAlreadyApplicable: 'no', version: 3 },
    });
  });

  it('shows the SMC sub-assessment when AS applies', () => {
    const fr = fixture();
    fr.assessment.systemOutcome = 'accounting_standards' as never;
    fr.detail!.smc = {
      status: 'smc',
      turnover: 1_000_000_000,
      turnoverThreshold: 2_500_000_000,
      borrowings: 0,
      borrowingsThreshold: 500_000_000,
      conditions: [
        { key: 'turnover', label: 'Turnover within the limit', result: 'met', detail: '₹100 crore' },
      ],
      authorityProvisionId: null,
    } as never;
    render(wrap(<FinancialReportingWorkspace engagementId="e1" fr={fr} canManage />));
    expect(screen.getByText(/SMC sub-assessment/)).toBeInTheDocument();
    expect(screen.getByText('Turnover within the limit')).toBeInTheDocument();
    expect(screen.queryByText(/FRF-06 Is this the company/)).not.toBeInTheDocument();
  });

  it('is read-only once approved', () => {
    const fr = fixture({ approved: true });
    fr.assessment.state = 'approved' as never;
    fr.assessment.conclusion = 'ind_as' as never;
    render(wrap(<FinancialReportingWorkspace engagementId="e1" fr={fr} canManage />));
    expect(
      screen.queryByRole('button', { name: /Confirm System Assessment/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Approved (Section 02)')).toBeInTheDocument();
  });
});
