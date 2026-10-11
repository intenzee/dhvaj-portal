import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  EMPTY_OTHER_REPORTING_CAPTURED,
  type OtherReportingDetail,
  type ReportingCard,
  type StatutoryAuditOtherReporting,
} from '@hsdg/contracts';
import { OtherReportingWorkspace } from '../other-reporting-workspace';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));
jest.mock('../framework-references', () => ({
  FrameworkReferences: ({ anchors }: { anchors?: string[] }) => (
    <span data-testid="refs">{(anchors ?? []).join(',')}</span>
  ),
}));
jest.mock('../other-reporting-fraud', () => ({ OtherReportingFraud: () => <p>fraud slot</p> }));
jest.mock('../other-reporting-directors', () => ({
  OtherReportingDirectors: () => <p>directors slot</p>,
}));
jest.mock('../other-reporting-cross-refs', () => ({
  OtherReportingCrossRefs: () => <p>cross-refs slot</p>,
}));
jest.mock('../other-reporting-evidence', () => ({
  ReportingCardEvidence: ({ cardKey }: { cardKey: string }) => <p>evidence {cardKey}</p>,
}));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const card = (over: Partial<ReportingCard>): ReportingCard => ({
  key: 's143_3_b_books',
  group: 'section_143_3',
  requirement: 'Proper books of account',
  clause: 'Section 143(3)(b)',
  applicability: 'applicable',
  applicabilityBasis: 'Every company audit.',
  applicabilitySource: 'Companies Act',
  workSource: 'Books assessment',
  workConfigured: 'yes',
  finalStage: 'Section 08',
  systemExceptions: [],
  systemReportingStatus: 'unmodified_expected',
  evidenceCount: 2,
  anchors: ['section_143_3'],
  state: {
    workStatus: 'not_started',
    reportingStatus: null,
    proposedConclusion: null,
    exceptions: 0,
    exceptionNote: null,
    sourceWorkpaper: null,
    reviewedByName: null,
    reviewedAt: null,
    version: 3,
  },
  ...over,
});

const detail = (over: Partial<OtherReportingDetail> = {}): OtherReportingDetail =>
  ({
    cards: [
      card({}),
      card({
        key: 's197_16_remuneration',
        group: 'remuneration',
        clause: 'Section 197(16)',
        requirement: 'Managerial remuneration',
        applicability: 'not_applicable',
        systemReportingStatus: 'not_applicable',
        anchors: ['section_197_16'],
      }),
    ],
    rule11g: {
      applicable: true,
      effectiveFrom: '2023-04-01',
      systems: [],
      retentionYears: 8,
      allAdequate: false,
      basis: '',
    },
    remuneration: {
      applicable: false,
      outcome: 'not_applicable',
      limitPercent: null,
      section198NetProfit: null,
      permittedAmount: null,
      paidAmount: null,
      scheduleVRoute: false,
      categories: [],
      scheduleV: {
        triggered: false,
        reason: null,
        effectiveCapital: null,
        bands: [],
        band: null,
        ceiling: null,
        doubled: false,
        exceeding: [],
        basis: '',
      },
      appointmentFlags: [],
      basis: '',
    },
    fraud: {
      identified: false,
      route: 'none',
      thresholdAmount: 10_000_000,
      amount: null,
      boardReplyByDate: null,
      cgForwardByDate: null,
      formReference: null,
      basis: 'No fraud matter recorded.',
    },
    rule11ef: {
      intermediaryFundsAdvanced: false,
      ultimateBeneficiaryFundsReceived: false,
      representationsObtained: false,
      satisfied: false,
      basis: '',
    },
    dividendCompliesSec123: null,
    pendingLitigationDisclosed: null,
    foreseeableLossesProvided: null,
    iepfTransferDelay: null,
    matters: [],
    missingFacts: [],
    rulesUsed: [
      {
        code: 'FRAUD_CG_THRESHOLD',
        label: 'Fraud — Central Government threshold',
        value: 10_000_000,
        unit: 'inr',
        effectiveFrom: '2015-12-14',
        ruleVersionId: 'rv1',
      },
    ],
    rule11Version: { code: 'AUDIT_RULE_11', effectiveFrom: '2021-04-01' },
    removedObligations: [],
    ...over,
  }) as OtherReportingDetail;

const or = (over: Partial<StatutoryAuditOtherReporting> = {}, d = detail()) =>
  ({
    workflowInstanceId: 'wf1',
    engagementServiceId: 'es1',
    engagementId: 'e1',
    assessment: {
      state: 'system_suggested_applicable',
      systemOutcome: 'configured',
      systemBasis: 'Every obligation identified.',
      conclusion: null,
      isOverridden: false,
      basis: null,
      needsReevaluation: false,
      version: 7,
    },
    detail: d,
    masterFacts: [],
    capturedFacts: { ...EMPTY_OTHER_REPORTING_CAPTURED },
    baseFacts: { isPublicCompany: false, publicCompanySource: 'Entity type: private limited' },
    upstreamReady: true,
    partnerApproval: { required: false, reason: null, approvedByName: null, approvedAt: null, note: null },
    completion: {
      complete: false,
      status: 'in_progress',
      items: [
        { key: 'applicability', label: 'Applicability determined', met: true, detail: null },
        { key: 'conclusion', label: 'Conclusion recorded', met: false, detail: null },
      ],
    },
    viewerIsPartner: false,
    ...over,
  }) as unknown as StatutoryAuditOtherReporting;

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({});
});

describe('02.7 Other reporting workspace', () => {
  it('shows status, the Rules Library values, the completion checklist and mounts the Track B slots', () => {
    render(wrap(<OtherReportingWorkspace engagementId="e1" or={or()} canManage />));
    expect(screen.getByText('In progress')).toBeInTheDocument();
    const rules = screen.getByRole('table', { name: 'Rules Library values used' });
    expect(within(rules).getByText(/FRAUD_CG_THRESHOLD/)).toBeInTheDocument();
    expect(within(rules).getByText('2015-12-14')).toBeInTheDocument();
    const checklist = screen.getByRole('list', { name: '02.7 completion checklist' });
    expect(within(checklist).getByLabelText('Open')).toBeInTheDocument();
    expect(screen.getByText(/Rule 11 version: AUDIT_RULE_11 from 2021-04-01/)).toBeInTheDocument();
  });

  it('lists blocking facts and refuses Confirm until they are answered', () => {
    const o = or(
      { assessment: { ...or().assessment, systemOutcome: 'information_insufficient' } },
      detail({
        missingFacts: [
          { key: 'rule_11_f_dividend', label: 'Rule 11(f): dividend declared or paid?', blocking: true },
          { key: 's143_3_b_branch_returns', label: 'Branches (02.6)', blocking: false },
        ],
      }),
    );
    render(wrap(<OtherReportingWorkspace engagementId="e1" or={o} canManage />));
    expect(screen.getAllByText('Pending facts').length).toBeGreaterThan(0);
    expect(screen.getByText('Rule 11(f): dividend declared or paid?')).toBeInTheDocument();
    expect(screen.getByText(/Awaiting other work \(not blocking\): Branches \(02.6\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm System Assessment/ })).toBeDisabled();
  });

  it('opens a requirement card in place and saves its work state with the card version', async () => {
    const user = userEvent.setup();
    render(wrap(<OtherReportingWorkspace engagementId="e1" or={or()} canManage />));
    const row = screen.getByRole('button', { name: /Section 143\(3\)\(b\)/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Every company audit.')).toBeInTheDocument();
    expect(screen.getByText('evidence s143_3_b_books')).toBeInTheDocument();
    expect(screen.getAllByTestId('refs').some((r) => r.textContent === 'section_143_3')).toBe(true);

    await user.selectOptions(screen.getByLabelText('Work status'), 'complete');
    await user.click(screen.getByRole('button', { name: 'Save card' }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/other-reporting/cards/s143_3_b_books',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ workStatus: 'complete', exceptions: 0, version: 3 }),
      }),
    );
  });

  it('a team exception on a card needs a description before it saves', async () => {
    const user = userEvent.setup();
    render(wrap(<OtherReportingWorkspace engagementId="e1" or={or()} canManage />));
    await user.click(screen.getByRole('button', { name: /Section 143\(3\)\(b\)/ }));
    const count = screen.getByLabelText('Exceptions (team)');
    await user.clear(count);
    await user.type(count, '1');
    expect(screen.getByRole('button', { name: 'Save card' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Describe the exception/), 'Stock register not kept');
    expect(screen.getByRole('button', { name: 'Save card' })).toBeEnabled();
  });

  it('records an applicability override with its reason as a fact', async () => {
    const user = userEvent.setup();
    render(wrap(<OtherReportingWorkspace engagementId="e1" or={or()} canManage />));
    const matrix = screen.getByTestId('other-reporting-matrix');
    await user.click(within(matrix).getByRole('button', { name: /Managerial remuneration/ }));
    await user.selectOptions(screen.getByLabelText('Override applicability'), 'applicable');
    await user.type(screen.getByLabelText('Override reason'), 'Deemed public company');
    await user.click(screen.getByRole('button', { name: 'Save override' }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/other-reporting/facts', {
      method: 'POST',
      body: {
        applicabilityOverrides: {
          s197_16_remuneration: { applicability: 'applicable', reason: 'Deemed public company' },
        },
        version: 7,
      },
    });
  });

  it('an override needs the conclusion, a reason and the technical basis', async () => {
    const user = userEvent.setup();
    render(wrap(<OtherReportingWorkspace engagementId="e1" or={or()} canManage />));
    await user.click(screen.getByRole('button', { name: 'Override Assessment' }));
    const record = screen.getByRole('button', { name: 'Record override' });
    await user.selectOptions(screen.getByLabelText(/Final conclusion/), 'attention_required');
    await user.type(screen.getByLabelText(/Reason \(mandatory\)/), 'Fraud found after period end');
    expect(record).toBeDisabled();
    await user.type(screen.getByLabelText(/Technical basis/), 'Section 143(12) applies');
    await user.click(record);
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/wf1/other-reporting/decision', {
      method: 'POST',
      body: {
        action: 'override',
        conclusion: 'attention_required',
        basis: 'Fraud found after period end',
        technicalBasis: 'Section 143(12) applies',
        supportingEvidence: undefined,
        version: 7,
      },
    });
  });

  it('only the Engagement Partner sees the approval action for a significant override', async () => {
    const user = userEvent.setup();
    const pa = { required: true, reason: 'Removes statutory obligation(s)', approvedByName: null, approvedAt: null, note: null };
    const { unmount } = render(
      wrap(<OtherReportingWorkspace engagementId="e1" or={or({ partnerApproval: pa })} canManage />),
    );
    expect(screen.getByText('Awaiting Engagement Partner approval.')).toBeInTheDocument();
    unmount();
    render(
      wrap(
        <OtherReportingWorkspace
          engagementId="e1"
          or={or({ partnerApproval: pa, viewerIsPartner: true })}
          canManage
        />,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Approve as Engagement Partner' }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/other-reporting/partner-approve',
      { method: 'POST', body: { note: undefined, version: 7 } },
    );
  });

  it('Section 197(16) is not applicable to a private company', async () => {
    const user = userEvent.setup();
    render(wrap(<OtherReportingWorkspace engagementId="e1" or={or()} canManage />));
    await user.click(screen.getByRole('button', { name: /Section 197\(16\) — managerial remuneration/ }));
    expect(
      screen.getByText(/applies to a public company only \(Entity type: private limited\)/),
    ).toBeInTheDocument();
  });

  it('adds a system to the Rule 11(g) register and saves the whole register', async () => {
    const user = userEvent.setup();
    render(wrap(<OtherReportingWorkspace engagementId="e1" or={or()} canManage />));
    await user.click(screen.getByRole('button', { name: /Rule 11\(g\) — audit trail/ }));
    expect(screen.getByText(/preserved for 8 years/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add system/ }));
    expect(screen.getByRole('button', { name: 'Save register' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Software \/ system name/), 'SAP B1');
    await user.click(screen.getByRole('button', { name: 'Save register' }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/other-reporting/facts',
      expect.objectContaining({
        body: expect.objectContaining({
          softwareSystems: [expect.objectContaining({ name: 'SAP B1', featureStatus: 'pending' })],
          version: 7,
        }),
      }),
    );
  });

  it('an approved Section 02 locks the facts but keeps the cards workable', async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <OtherReportingWorkspace
          engagementId="e1"
          or={or({ approved: true, assessment: { ...or().assessment, state: 'approved' } })}
          canManage
        />,
      ),
    );
    expect(screen.getByText('Approved (Section 02)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Section 143\(3\)\(b\)/ }));
    expect(screen.getByRole('button', { name: 'Save card' })).toBeEnabled();
    expect(screen.queryByLabelText('Override applicability')).toBeNull();
    expect(screen.getByRole('button', { name: /Confirm System Assessment/ })).toBeDisabled();
  });

  it('a card opens its workpaper panel in place', async () => {
    const user = userEvent.setup();
    render(wrap(<OtherReportingWorkspace engagementId="e1" or={or()} canManage />));
    const panel = screen.getByRole('button', { name: /Section 143\(3\) — team confirmations/ });
    expect(panel).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: /Section 143\(3\)\(b\)/ }));
    await user.click(screen.getByRole('button', { name: 'Open workpaper' }));
    expect(panel).toHaveAttribute('aria-expanded', 'true');
  });

  it('captures the Section 196 appointment facts and shows the system flags', async () => {
    const user = userEvent.setup();
    const flag = 'A. Rao: age 72 (70 or above) — Section 196(3)(a) requires a special resolution; none recorded.';
    const d = detail({
      remuneration: { ...detail().remuneration, applicable: true, appointmentFlags: [flag] },
    });
    const o = or(
      {
        baseFacts: { isPublicCompany: true, publicCompanySource: 'Entity type: public limited' },
        capturedFacts: {
          ...EMPTY_OTHER_REPORTING_CAPTURED,
          managerialPersons: [
            { id: 'p1', name: 'A. Rao', category: 'managing_director', remuneration: 4_000_000 },
          ],
        },
      },
      d,
    );
    render(wrap(<OtherReportingWorkspace engagementId="e1" or={o} canManage />));
    await user.click(screen.getByRole('button', { name: /Section 197\(16\) — managerial remuneration/ }));
    expect(screen.getByRole('list', { name: 'Section 196 appointment checks' })).toHaveTextContent(flag);
    await user.type(screen.getByLabelText('Age'), '72');
    await user.type(screen.getByLabelText('Term (years)'), '5');
    await user.click(screen.getByLabelText('Special resolution (70 or above)'));
    await user.click(screen.getByRole('button', { name: 'Save remuneration' }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/other-reporting/facts',
      expect.objectContaining({
        body: expect.objectContaining({
          managerialPersons: [
            expect.objectContaining({ name: 'A. Rao', age: 72, termYears: 5, ageSpecialResolution: true }),
          ],
        }),
      }),
    );
  });
});
