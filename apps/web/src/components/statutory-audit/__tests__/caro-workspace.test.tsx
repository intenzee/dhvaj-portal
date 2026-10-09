import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CaroCondition, CaroDetail, StatutoryAuditCaro } from '@hsdg/contracts';
import { CaroWorkspace } from '../caro-workspace';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));
jest.mock('../framework-evidence', () => ({
  FrameworkEvidence: () => <p>shared evidence</p>,
}));
jest.mock('../framework-references', () => ({
  FrameworkReferences: ({ anchors }: { anchors?: string[] }) => (
    <span data-testid="refs">{(anchors ?? []).join(',')}</span>
  ),
}));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const condition = (
  key: CaroCondition['key'],
  label: string,
  result: CaroCondition['result'],
  actualDisplay: string,
): CaroCondition => ({
  key,
  label,
  requirement: `${label} requirement`,
  result,
  ruleCode: `RULE_${key.toUpperCase()}`,
  ruleVersionId: `rv-${key}`,
  ruleVersion: 1,
  ruleEffectiveFrom: '2021-04-01',
  operator: '<=',
  threshold: 100000000,
  unit: 'inr',
  measurementBasis: 'caro_measurement_basis',
  actual: null,
  actualDisplay,
  limitDisplay: '₹10.00 cr',
  calculation: null,
  pendingReason: null,
  authorityProvisionId: null,
  guidanceReference: 'ICAI GN',
});

const detail: CaroDetail = {
  level1Applies: true,
  exemptionReason: null,
  orderVersion: { code: 'CARO_2020', effectiveFrom: '2021-04-01' },
  directTests: [
    {
      code: 'CARO-01',
      key: 'banking',
      question: 'Is the entity a banking company within the applicable CARO exemption?',
      answer: 'no',
      basis: '02.1 does not classify the entity as a banking company.',
      sourceSection: '02.1',
      provisionCodes: ['CARO_2020_PARA_1'],
      decisive: false,
    },
    {
      code: 'CARO-05',
      key: 'small_company',
      question: 'Is the entity a small company under section 2(85) for the relevant period?',
      answer: 'no',
      basis: '02.1 small-company conclusion: not a small company.',
      sourceSection: '02.1',
      provisionCodes: ['CARO_2020_PARA_1', 'COS_ACT_2_85'],
      decisive: false,
    },
  ],
  privateTest: {
    tested: true,
    qualified: false,
    conditions: [
      condition(
        'public_group',
        'Public-company group relationship',
        'satisfied',
        'No public-company relationship',
      ),
      condition('revenue', 'Total revenue', 'failed', '₹14.82 cr'),
    ],
  },
  conclusion: {
    result: 'applicable',
    entityRoute: 'private_company',
    directExemption: null,
    privateExemption: 'not_qualified',
    failedConditions: ['revenue'],
    failedCondition: 'Total revenue',
    actualValue: '₹14.82 cr',
    configuredLimit: '₹10.00 cr',
    orderVersion: 'CARO 2020 (effective 2021-04-01)',
  },
  factsUsed: [
    {
      key: 'company_type',
      label: 'Company type',
      value: 'Private company',
      source: '02.1',
      sourceSection: '02.1',
    },
  ],
  missingFacts: [],
  reportContexts: [
    {
      context: 'standalone',
      status: 'applicable',
      applies: true,
      scope: 'paragraph_3',
      basis: 'CARO applies.',
    },
    { context: 'consolidated', status: 'pending', applies: null, scope: null, basis: '02.6 open.' },
  ],
  instantiatesClauseProgramme: true,
  caroScope: 'standalone_paragraph_3',
  provisionCodes: ['CARO_2020', 'CARO_2020_PARA_1', 'ICAI_GN_CARO_2020'],
};

const baseAssessment: StatutoryAuditCaro['assessment'] = {
  id: 'sub1',
  subSectionKey: '02.4',
  areaKey: 'caro',
  title: 'CARO 2020 Applicability',
  state: 'system_suggested_applicable',
  systemOutcome: 'applicable',
  systemBasis: 'Private company does not qualify — total revenue exceeds the limit.',
  systemDetail: detail,
  ruleVersionId: 'rv-revenue',
  authorityProvisionId: 'p1',
  conclusion: null,
  isOverridden: false,
  basis: null,
  impact: null,
  facts: null,
  needsReevaluation: false,
  decidedByName: null,
  decidedAt: null,
  version: 4,
};

const caro = (over: Partial<StatutoryAuditCaro> = {}): StatutoryAuditCaro => ({
  workflowInstanceId: 'wf1',
  engagementServiceId: 's1',
  engagementId: 'e1',
  assessment: baseAssessment,
  detail,
  capturedFacts: {
    isHoldingOrSubsidiaryOfPublic: false,
    capitalPlusReserves: 5000000,
    peakBankFiBorrowings: 5000000,
    totalRevenue: 148200000,
  },
  baseFacts: {} as StatutoryAuditCaro['baseFacts'],
  masterFacts: [],
  upstreamReady: true,
  auditFinancialYear: '2024-25',
  professionalAction: null,
  pendingReason: null,
  partnerApproval: {
    required: false,
    reason: null,
    approvedByName: null,
    approvedAt: null,
    note: null,
  },
  completion: {
    complete: false,
    status: 'in_progress',
    items: [
      { key: 'professional_conclusion', label: 'Manager confirmed', met: false, detail: null },
    ],
    contexts: { standalone: false, consolidated: false },
  },
  reevaluation: { required: false, changes: [] },
  priorYear: null,
  approved: false,
  viewerIsPartner: false,
  memoSuggested: false,
  ...over,
});

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({});
});

describe('CaroWorkspace (02.4 spec §4)', () => {
  it('shows the §8 conclusion: route, failed condition, actual value and configured limit', () => {
    render(wrap(<CaroWorkspace engagementId="e1" caro={caro()} canManage />));
    const sys = screen.getByLabelText('Applicability conclusion');
    expect(within(sys).getByText('Private Company')).toBeInTheDocument();
    expect(within(sys).getByText('Not Qualified')).toBeInTheDocument();
    expect(within(sys).getByText('₹14.82 cr')).toBeInTheDocument();
    expect(within(sys).getByText('₹10.00 cr')).toBeInTheDocument();
  });

  it('lists CARO-01..05 with System Yes/No/Pending and the provision links', () => {
    render(wrap(<CaroWorkspace engagementId="e1" caro={caro()} canManage />));
    const table = screen.getByLabelText('Direct exemption tests');
    expect(within(table).getByText('CARO-05')).toBeInTheDocument();
    expect(within(table).getAllByText('No')).toHaveLength(2);
    expect(within(table).getByText('caro_para_1,section_2_85')).toBeInTheDocument();
    expect(
      within(table).getByRole('button', { name: 'Open 02.1 Small Company Assessment' }),
    ).toBeInTheDocument();
  });

  it('shows every cumulative condition with Satisfied / Failed', () => {
    render(wrap(<CaroWorkspace engagementId="e1" caro={caro()} canManage />));
    const table = screen.getByLabelText('Private company cumulative test');
    expect(within(table).getByText('Satisfied')).toBeInTheDocument();
    expect(within(table).getByText('Failed')).toBeInTheDocument();
  });

  it('Confirm System Assessment posts CARO-06 confirm with the version', async () => {
    const user = userEvent.setup();
    render(wrap(<CaroWorkspace engagementId="e1" caro={caro()} canManage />));
    await user.click(screen.getByRole('button', { name: /Confirm System Assessment/ }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/caro/decision', {
      method: 'POST',
      body: { action: 'confirm', version: 4 },
    });
  });

  it('Override needs the final selection, reason and technical basis', async () => {
    const user = userEvent.setup();
    render(wrap(<CaroWorkspace engagementId="e1" caro={caro()} canManage />));
    await user.click(screen.getByRole('button', { name: 'Override Assessment' }));
    const record = screen.getByRole('button', { name: 'Record override' });
    expect(record).toBeDisabled();
    await user.selectOptions(screen.getByLabelText(/Final selection/), 'not_applicable_exempt');
    await user.type(screen.getByLabelText(/^Reason/), 'Revenue restated.');
    await user.type(screen.getByLabelText(/Technical basis/), 'GN on CARO.');
    await user.type(screen.getByLabelText(/Supporting evidence/), 'Restated TB.');
    await user.click(record);
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/caro/decision', {
      method: 'POST',
      body: {
        action: 'override',
        conclusion: 'not_applicable_exempt',
        basis: 'Revenue restated.',
        technicalBasis: 'GN on CARO.',
        supportingEvidence: 'Restated TB.',
        version: 4,
      },
    });
  });

  it('the work programme appears only after applicability is confirmed', () => {
    const { unmount } = render(
      wrap(
        <CaroWorkspace engagementId="e1" caro={caro()} canManage programme={<p>clause list</p>} />,
      ),
    );
    expect(screen.queryByText('clause list')).toBeNull();
    expect(
      screen.getByText(/Generated only after CARO applicability is confirmed/),
    ).toBeInTheDocument();
    unmount();
    const decided = caro({
      assessment: { ...baseAssessment, state: 'applicable', conclusion: 'applicable' },
    });
    render(
      wrap(
        <CaroWorkspace engagementId="e1" caro={decided} canManage programme={<p>clause list</p>} />,
      ),
    );
    expect(screen.getByText('clause list')).toBeInTheDocument();
  });

  it('keeps the system result visible after an override and asks the Partner', () => {
    const over = caro({
      assessment: {
        ...baseAssessment,
        state: 'overridden',
        conclusion: 'not_applicable_exempt',
        isOverridden: true,
        basis: 'Revenue restated.',
      },
      capturedFacts: { ...caro().capturedFacts, technicalBasis: 'GN.', supportingEvidence: 'TB.' },
      partnerApproval: {
        required: true,
        reason: 'The conclusion overrides the system assessment (significant override).',
        approvedByName: null,
        approvedAt: null,
        note: null,
      },
    });
    render(wrap(<CaroWorkspace engagementId="e1" caro={over} canManage />));
    expect(screen.getByText(/System conclusion retained: CARO Applicable/)).toBeInTheDocument();
    expect(screen.getByText('Awaiting Engagement Partner approval.')).toBeInTheDocument();
  });

  it('saves a borrowing balance schedule for the aggregate "any point" test', async () => {
    const user = userEvent.setup();
    render(wrap(<CaroWorkspace engagementId="e1" caro={caro()} canManage />));
    const form = screen.getByLabelText('Borrowing balance schedule');
    await user.type(within(form).getByLabelText('As on'), '2024-09-30');
    await user.type(within(form).getByLabelText('Lender'), 'HDFC');
    await user.type(within(form).getByLabelText('Outstanding (₹)'), '12000000');
    await user.click(within(form).getByRole('button', { name: 'Add balance' }));
    await user.click(screen.getByRole('button', { name: 'Save measurement data' }));
    const call = apiFetch.mock.calls.find((c) => String(c[0]).endsWith('/caro/facts'));
    expect(call?.[1].body.borrowingSchedule).toEqual([
      { asOn: '2024-09-30', lender: 'HDFC', lenderType: 'bank', amount: 12000000 },
    ]);
    expect(call?.[1].body.version).toBe(4);
  });
});
