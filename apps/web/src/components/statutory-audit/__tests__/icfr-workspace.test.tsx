import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  ICFR_CONTROL_REMINDER,
  type IcfrCondition,
  type IcfrDetail,
  type StatutoryAuditIcfr,
} from '@hsdg/contracts';
import { IcfrWorkspace } from '../icfr-workspace';

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

const CRORE = 10_000_000;

const condition = (
  key: IcfrCondition['key'],
  label: string,
  result: IcfrCondition['result'],
  actualDisplay: string,
  limitDisplay: string | null,
  provisionCodes: string[],
  pendingReason: string | null = null,
): IcfrCondition => ({
  key,
  label,
  requirement: `${label} requirement`,
  result,
  ruleCode: `ICFR_${key.toUpperCase()}`,
  ruleVersionId: `rv-${key}`,
  ruleVersion: 1,
  ruleEffectiveFrom: '2016-04-01',
  operator: key === 'filing' ? null : '<',
  threshold: null,
  unit: 'inr',
  measurementBasis: key === 'turnover' ? 'latest_audited_fs' : 'at_any_point_in_year',
  actual: null,
  actualDisplay,
  limitDisplay,
  calculation: null,
  pendingReason,
  guidanceReference: 'ICAI GN on Audit of ICFR',
  provisionCodes,
});

const detail = (over: Partial<IcfrDetail> = {}): IcfrDetail => ({
  reportingApplies: true,
  exemptionReason: null,
  monetaryTest: { tested: true, turnoverWithinLimit: true, borrowingsWithinLimit: false },
  filingDefaultBlocks: false,
  configuresIcfrWorkstream: true,
  controlsPhaseUnaffected: true,
  rule11gSeparate: true,
  entityRoute: 'private_company',
  notificationVersion: { code: 'MCA_ICFR_PVT_EXEMPTION', effectiveFrom: '2017-06-13' },
  monetaryJoin: 'and',
  routes: [
    {
      key: 'opc',
      label: 'One Person Company route',
      actual: 'Not an OPC',
      result: 'no',
      basis: '02.1 classifies the entity as a private limited company.',
      sourceSection: '02.1',
      ruleCode: 'ICFR_OPC_ROUTE',
      ruleVersionId: 'rv-opc',
      provisionCodes: ['MCA_ICFR_PVT_EXEMPTION'],
    },
    {
      key: 'small_company',
      label: 'Small Company route',
      actual: 'Not a small company',
      result: 'no',
      basis: 'Approved 02.1 small-company result: not small.',
      sourceSection: '02.1',
      ruleCode: 'ICFR_SMALL_COMPANY_ROUTE',
      ruleVersionId: 'rv-small',
      provisionCodes: ['MCA_ICFR_PVT_EXEMPTION'],
    },
  ],
  conditions: [
    condition('turnover', 'Turnover', 'satisfied', '₹40.00 cr', '₹50.00 cr', [
      'MCA_ICFR_PVT_EXEMPTION',
    ]),
    condition('borrowings', 'Borrowings', 'failed', '₹27.00 cr', '₹25.00 cr', [
      'MCA_ICFR_PVT_EXEMPTION',
    ]),
    condition('filing', 'Filing condition', 'satisfied', 'No Default Identified', null, [
      'COS_ACT_137',
      'COS_ACT_92',
    ]),
  ],
  turnover: {
    amount: 40 * CRORE,
    period: '2023-24',
    source: '02.1 financial data — audited comparative',
    audited: true,
    basis: 'Latest audited financial statements',
  },
  borrowing: {
    maximumAggregate: 27 * CRORE,
    peakDate: '2024-09-30',
    bySource: {
      bank: 15 * CRORE,
      financial_institution: null,
      body_corporate: 12 * CRORE,
      other: 5 * CRORE,
    },
    coveredSources: ['bank', 'financial_institution', 'body_corporate'],
    excludedSources: ['other'],
    dataBasis: 'monthly',
    balanceDates: 2,
    lenders: 3,
    method: 'schedule',
  },
  filing: {
    status: 'no_default',
    required: true,
    records: [
      {
        form: 'AOC-4',
        section: '137',
        period: '2023-24',
        dueDate: '2024-10-29',
        filedOn: '2024-10-20',
        srn: null,
        source: 'compliance_calendar',
        defaulted: false,
      },
    ],
    basis: 'Filed on or before the due date.',
  },
  conclusion: {
    result: 'applicable',
    entityRoute: 'private_company',
    opc: 'no',
    smallCompany: 'no',
    turnover: '₹40.00 cr',
    turnoverLimit: '₹50.00 cr',
    peakBorrowings: '₹27.00 cr',
    borrowingLimit: '₹25.00 cr',
    filingCondition: 'satisfied',
    reason: 'Borrowing condition failed; exemption unavailable',
    notificationVersion: 'MCA private-company exemption (effective 2017-06-13)',
  },
  factsUsed: [
    {
      key: 'company_type',
      label: 'Company type',
      value: 'Private company',
      source: '02.1',
      sourceSection: '02.1',
    },
    {
      key: 'cfs_in_scope',
      label: 'Consolidated FS in scope',
      value: 'Pending 02.6',
      source: '02.6',
      sourceSection: '02.6',
    },
  ],
  missingFacts: [],
  reportContexts: [
    {
      context: 'standalone',
      status: 'applicable',
      applies: true,
      basis: 'ICFR reporting applies.',
    },
    { context: 'consolidated', status: 'pending', applies: null, basis: '02.6 open.' },
  ],
  provisionCodes: ['COS_ACT_143_3_I', 'MCA_ICFR_PVT_EXEMPTION'],
  ...over,
});

const baseAssessment: StatutoryAuditIcfr['assessment'] = {
  id: 'sub1',
  subSectionKey: '02.5',
  areaKey: 'ifc',
  title: 'ICFR Reporting',
  state: 'system_suggested_applicable',
  systemOutcome: 'applicable',
  systemBasis: 'Private company — borrowings exceed the limit; ICFR reporting applies.',
  systemDetail: null,
  ruleVersionId: 'rv-borrowings',
  authorityProvisionId: 'p1',
  conclusion: null,
  isOverridden: false,
  basis: null,
  impact: null,
  facts: null,
  needsReevaluation: false,
  decidedByName: null,
  decidedAt: null,
  version: 7,
};

const icfr = (over: Partial<StatutoryAuditIcfr> = {}): StatutoryAuditIcfr => ({
  workflowInstanceId: 'wf1',
  engagementServiceId: 's1',
  engagementId: 'e1',
  assessment: baseAssessment,
  detail: detail(),
  capturedFacts: { peakCoveredBorrowings: null, filingDefault: null },
  baseFacts: {} as StatutoryAuditIcfr['baseFacts'],
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
      { key: 'consolidated', label: 'Consolidated context', met: null, detail: null },
    ],
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

describe('IcfrWorkspace (02.5 spec §4)', () => {
  it('shows the §10 structured conclusion: routes, actual vs limit and the reason', () => {
    render(wrap(<IcfrWorkspace engagementId="e1" icfr={icfr()} canManage />));
    const sys = screen.getByLabelText('ICFR system conclusion');
    expect(within(sys).getByText('Private company')).toBeInTheDocument();
    expect(within(sys).getByText('₹27.00 cr (limit ₹25.00 cr)')).toBeInTheDocument();
    expect(
      within(sys).getByText('Borrowing condition failed; exemption unavailable'),
    ).toBeInTheDocument();
  });

  it('lists the OPC / Small routes and every condition with its provision anchors', () => {
    render(wrap(<IcfrWorkspace engagementId="e1" icfr={icfr()} canManage />));
    const routes = screen.getByLabelText('Exemption routes');
    expect(within(routes).getByText('One Person Company route')).toBeInTheDocument();
    expect(within(routes).getAllByRole('button', { name: 'Open 02.1' })).toHaveLength(2);
    const conds = screen.getByLabelText('Exemption conditions');
    expect(within(conds).getByText('Failed')).toBeInTheDocument();
    expect(within(conds).getAllByText('Satisfied')).toHaveLength(2);
    expect(within(conds).getByText('section_137,section_92')).toBeInTheDocument();
  });

  it('shows the computed peak with the per-source split and excluded sources', () => {
    render(wrap(<IcfrWorkspace engagementId="e1" icfr={icfr()} canManage />));
    const peak = screen.getByLabelText('Computed peak');
    expect(peak).toHaveTextContent('₹27,00,00,000');
    expect(peak).toHaveTextContent('Body corporate ₹12,00,00,000');
    expect(peak).toHaveTextContent('excluded: Other');
  });

  it('shows the compliance-calendar filings until the team records its own', () => {
    render(wrap(<IcfrWorkspace engagementId="e1" icfr={icfr()} canManage />));
    const table = screen.getByLabelText('Filing records');
    expect(within(table).getByText('Compliance calendar')).toBeInTheDocument();
    expect(screen.getByText(/Read from the compliance calendar/)).toBeInTheDocument();
  });

  it('saves IFC-01 to IFC-03 — schedule rows and traceable filings — with the version', async () => {
    const user = userEvent.setup();
    render(wrap(<IcfrWorkspace engagementId="e1" icfr={icfr()} canManage />));
    await user.selectOptions(screen.getByLabelText(/Data available/), 'monthly');
    await user.type(screen.getByLabelText('As on'), '2024-09-30');
    await user.type(screen.getByLabelText('Lender'), 'Acme Holdings');
    await user.selectOptions(screen.getByLabelText('Borrowing source'), 'body_corporate');
    await user.type(screen.getByLabelText('Outstanding (₹)'), '120000000');
    await user.click(screen.getByRole('button', { name: 'Add balance' }));

    await user.selectOptions(screen.getByLabelText('Form'), 'MGT-7');
    await user.type(screen.getByLabelText('Period'), '2023-24');
    await user.type(screen.getByLabelText('Due date'), '2024-11-28');
    await user.type(screen.getByLabelText('Filed on'), '2024-11-25');
    await user.type(screen.getByLabelText('SRN'), 'AB7654321');
    await user.click(screen.getByRole('button', { name: 'Add filing' }));

    await user.click(screen.getByRole('button', { name: 'Save IFC-01 to IFC-03' }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/icfr/facts', {
      method: 'POST',
      body: {
        auditedTurnover: null,
        auditedTurnoverPeriod: null,
        auditedTurnoverSource: null,
        borrowingDataBasis: 'monthly',
        peakCoveredBorrowings: null,
        peakDate: null,
        borrowingSchedule: [
          {
            asOn: '2024-09-30',
            lender: 'Acme Holdings',
            source: 'body_corporate',
            amount: 120000000,
          },
        ],
        filings: [
          {
            form: 'MGT-7',
            section: '92',
            source: 'manual',
            period: '2023-24',
            dueDate: '2024-11-28',
            filedOn: '2024-11-25',
            srn: 'AB7654321',
          },
        ],
        filingDefault: null,
        filingEvidence: null,
        version: 7,
      },
    });
  });

  it('Confirm posts IFC-04 confirm; it is unavailable when information is pending', async () => {
    const user = userEvent.setup();
    const { unmount } = render(wrap(<IcfrWorkspace engagementId="e1" icfr={icfr()} canManage />));
    await user.click(screen.getByRole('button', { name: /Confirm System Assessment/ }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/icfr/decision', {
      method: 'POST',
      body: { action: 'confirm', version: 7 },
    });
    unmount();

    const pending = icfr({
      assessment: { ...baseAssessment, systemOutcome: 'information_insufficient' },
      detail: detail({
        missingFacts: [
          {
            key: 'peak_borrowings',
            label: 'Maximum aggregate covered borrowings',
            source: 'IFC-02',
          },
        ],
      }),
    });
    render(wrap(<IcfrWorkspace engagementId="e1" icfr={pending} canManage />));
    expect(screen.getByRole('button', { name: /Confirm System Assessment/ })).toBeDisabled();
    expect(screen.getAllByText(/Maximum aggregate covered borrowings \(IFC-02\)/)).not.toHaveLength(
      0,
    );
  });

  it('Override needs the final selection, reason and technical basis', async () => {
    const user = userEvent.setup();
    render(wrap(<IcfrWorkspace engagementId="e1" icfr={icfr()} canManage />));
    await user.click(screen.getByRole('button', { name: 'Override Assessment' }));
    const record = screen.getByRole('button', { name: 'Record override' });
    expect(record).toBeDisabled();
    await user.selectOptions(screen.getByLabelText(/Final selection/), 'exempt');
    await user.type(screen.getByLabelText(/^Reason/), 'One-day overdraft.');
    await user.type(screen.getByLabelText(/Technical basis/), 'GN on ICFR.');
    await user.type(screen.getByLabelText(/Supporting evidence/), 'Bank statement.');
    await user.click(record);
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/icfr/decision', {
      method: 'POST',
      body: {
        action: 'override',
        conclusion: 'exempt',
        basis: 'One-day overdraft.',
        technicalBasis: 'GN on ICFR.',
        supportingEvidence: 'Bank statement.',
        version: 7,
      },
    });
  });

  it('an Exempt result keeps the persistent control-audit reminder (§12)', () => {
    const exempt = icfr({
      assessment: { ...baseAssessment, systemOutcome: 'exempt' },
    });
    render(wrap(<IcfrWorkspace engagementId="e1" icfr={exempt} canManage />));
    expect(screen.getByRole('note')).toHaveTextContent(ICFR_CONTROL_REMINDER);
  });

  it('mounts the Section 05 workstream for Applicable — provisional until IFC-04 confirms', () => {
    const { unmount } = render(
      wrap(
        <IcfrWorkspace engagementId="e1" icfr={icfr()} canManage workstream={<p>processes</p>} />,
      ),
    );
    expect(screen.getByText('processes')).toBeInTheDocument();
    expect(screen.getByText(/Provisional — follows the system suggestion/)).toBeInTheDocument();
    unmount();

    const decided = icfr({
      assessment: { ...baseAssessment, state: 'applicable', conclusion: 'applicable' },
    });
    const { unmount: u2 } = render(
      wrap(
        <IcfrWorkspace engagementId="e1" icfr={decided} canManage workstream={<p>processes</p>} />,
      ),
    );
    expect(screen.getByText('processes')).toBeInTheDocument();
    expect(screen.queryByText(/Provisional — follows the system suggestion/)).toBeNull();
    u2();

    const exempt = icfr({
      assessment: { ...baseAssessment, state: 'not_applicable', conclusion: 'exempt' },
    });
    render(
      wrap(
        <IcfrWorkspace engagementId="e1" icfr={exempt} canManage workstream={<p>processes</p>} />,
      ),
    );
    expect(screen.queryByText('processes')).toBeNull();
  });

  it('keeps the system result after an override and waits for the Partner', () => {
    const over = icfr({
      assessment: {
        ...baseAssessment,
        state: 'overridden',
        conclusion: 'exempt',
        isOverridden: true,
        basis: 'One-day overdraft.',
      },
      capturedFacts: {
        peakCoveredBorrowings: null,
        filingDefault: null,
        technicalBasis: 'GN on ICFR.',
      },
      partnerApproval: {
        required: true,
        reason: 'The conclusion overrides the system assessment.',
        approvedByName: null,
        approvedAt: null,
        note: null,
      },
      memoSuggested: true,
    });
    render(wrap(<IcfrWorkspace engagementId="e1" icfr={over} canManage />));
    expect(
      screen.getByText('System conclusion retained: Section 143(3)(i) Reporting Applicable'),
    ).toBeInTheDocument();
    expect(screen.getByText('Technical basis: GN on ICFR.')).toBeInTheDocument();
    expect(screen.getByText('Awaiting Engagement Partner approval.')).toBeInTheDocument();
    expect(screen.getByText(/ICFR applicability memo is suggested/)).toBeInTheDocument();
  });
});
