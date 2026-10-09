import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { FsWorkbookView, ScheduleIiiDetail, StatutoryAuditScheduleIii } from '@hsdg/contracts';
import { ScheduleIiiWorkspace } from '../schedule-iii-workspace';
import { FsWorkbookCard } from '../fs-workbook-card';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  fetchBlob: jest.fn(),
  downloadFile: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
jest.mock('@/lib/principal', () => ({ can: () => true }));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));
// The evidence and references panels fetch their own data; they have their own tests.
const evidenceProps = jest.fn();
jest.mock('../framework-evidence', () => ({
  FrameworkEvidence: (p: { question?: string }) => {
    evidenceProps(p);
    return <p>evidence:{p.question ?? 'all'}</p>;
  },
}));
const referenceProps = jest.fn();
jest.mock('../framework-references', () => ({
  FrameworkReferences: (p: { anchors?: string[] }) => {
    referenceProps(p);
    return <p>refs:{(p.anchors ?? ['*']).join('|')}</p>;
  },
}));
jest.mock('@/components/document-preview', () => ({
  DocumentPreview: ({ doc }: { doc: { title: string } }) => <p>preview:{doc.title}</p>,
}));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  apiFetch.mockReset();
  evidenceProps.mockReset();
  referenceProps.mockReset();
});

const detail = (over: Partial<ScheduleIiiDetail> = {}): ScheduleIiiDetail => ({
  division: 'division_ii',
  divisionProvisionCode: 'SCH_III_DIV_II',
  cashFlowRequired: true,
  cashFlowExemptionReason: null,
  cashFlowProvisionId: null,
  requiredComponents: ['balance_sheet'],
  roundingThreshold: 1e9,
  roundingUnits: ['lakhs', 'millions', 'crores'],
  disclosures: [],
  sch01: 'yes',
  frameworkVersion: {
    id: 'fv2',
    frameworkId: 'SCHEDULE_III_DIVISION_II',
    division: 'II',
    title: 'Schedule III Division II',
    versionLabel: 'As amended by G.S.R. 207(E)',
    effectiveFrom: '2021-04-01',
    effectiveTo: null,
    notificationReference: 'G.S.R. 207(E), 24 March 2021',
    provisionCode: 'SCH_III_DIV_II',
    provisionId: 'p-div2',
    guidanceProvisionCode: 'ICAI_GN_SCH_III_DIV_II',
    guidanceProvisionId: 'p-gn2',
    guidanceVersion: 'Revised January 2022',
    templateKey: 'fs_workbook_indas_div_ii',
    status: 'active',
  },
  componentLines: [
    { key: 'balance_sheet', label: 'Balance Sheet', required: true, basis: 'Division II' },
    {
      key: 'statement_of_profit_and_loss',
      label: 'Statement of Profit and Loss',
      required: true,
      basis: 'Division II',
      includesOci: true,
    },
  ],
  cashFlow: {
    status: 'required',
    basis: 'Not an OPC, small or dormant company (02.1).',
    classifications: ['Public company'],
    provisionCode: 'COS_ACT_2_40',
    provisionId: 'p-240',
  },
  rounding: {
    sourceLabel: 'Total income',
    sourceAmount: 2_000_000_000,
    ruleCode: 'SCH_III_ROUNDING',
    ruleVersionId: 'rv2',
    effectiveFrom: '2021-04-01',
    threshold: 1_000_000_000,
    band: 'at_or_above',
    permittedUnits: ['lakhs', 'millions', 'crores'],
    systemUnit: 'lakhs',
    selectedUnit: null,
    overridden: false,
    reason: null,
    provisionId: 'p-round',
    basis: 'Total income ₹200 cr is at or above ₹100 cr.',
  },
  presentationMateriality: {
    label: 'Financial Statement Presentation Materiality',
    ruleCode: 'SCH_III_PRESENTATION',
    ruleVersionId: 'pm1',
    percentOfRevenue: 1,
    floor: 100000,
    measureLabel: 'Revenue from operations',
    measureAmount: 2_000_000_000,
    amount: 20_000_000,
    basis: '1% of revenue or ₹1 lakh, whichever is higher.',
    provisionId: null,
    auditMaterialityNote: 'Audit materiality (SA 320) is determined in Section 03.',
  },
  disclosureLibrary: [
    {
      code: 'D2_TITLE_DEEDS',
      category: 'property_title_deeds',
      label: 'Title deeds not held in the company’s name',
      description: null,
      trigger: 'immovable_property_exists',
      applicability: 'included_pending_fact',
      reason: 'Immovable property not yet known — kept in',
      provisionCode: 'SCH_III_DIV_II',
      provisionId: null,
      crossLink: null,
      effectiveFrom: '2021-04-01',
    },
    {
      code: 'D2_CSR',
      category: 'csr',
      label: 'Corporate social responsibility',
      description: null,
      trigger: 'csr_applicable',
      applicability: 'not_triggered',
      reason: 'CSR not applicable (02.7)',
      provisionCode: null,
      provisionId: null,
      crossLink: '02.7',
      effectiveFrom: '2021-04-01',
    },
    {
      code: 'D2_RATIOS',
      category: 'ratios',
      label: 'Ratios',
      description: null,
      trigger: null,
      applicability: 'baseline',
      reason: 'Mandatory in Division II',
      provisionCode: null,
      provisionId: null,
      crossLink: null,
      effectiveFrom: '2021-04-01',
    },
  ],
  specialised: {
    sch01: 'yes',
    systemSuggested: 'no',
    matchedRules: [],
    answer: null,
    governingAuthority: null,
    frameworkName: null,
    effect: null,
    effectiveVersion: null,
    provisionId: null,
    reference: null,
    resolved: true,
  },
  comparatives: {
    system: 'required',
    status: 'required',
    confirmed: null,
    reason: null,
    firstFinancialYear: false,
    incorporationDate: '2010-05-01',
    priorPeriod: '2023-24',
    priorEngagementId: null,
    priorYearFileCount: 0,
    basis: 'Not the first financial year — comparatives are presented.',
  },
  rulesApplied: [
    {
      ruleCode: 'SCH_III_ROUNDING',
      ruleVersionId: 'rv2',
      label: 'Schedule III rounding band',
      effectiveFrom: '2021-04-01',
      condition: 'Total income ₹200.00 cr ≥ ₹100.00 cr',
      provisionId: 'p-round',
    },
  ],
  factsUsed: [
    {
      key: 'framework',
      label: 'Financial reporting framework',
      value: 'Ind AS',
      source: '02.2',
      anchor: 'frf-05',
    },
  ],
  missingFacts: [],
  downstream: [
    {
      key: 'division',
      label: 'Schedule III Division + version',
      value: 'Division II',
      usedBy: 'Financial-statement review, Section 06, Section 07 Completion',
    },
  ],
  ...over,
});

const sch = (over: Partial<StatutoryAuditScheduleIii> = {}): StatutoryAuditScheduleIii => ({
  workflowInstanceId: 'wf1',
  engagementServiceId: 'es1',
  engagementId: 'e1',
  assessment: {
    id: 's3',
    subSectionKey: '02.3',
    areaKey: 'schedule_iii',
    title: 'Schedule III',
    state: 'system_suggested_applicable',
    systemOutcome: 'division_ii',
    systemBasis: 'Ind AS company, not an NBFC — Division II.',
    ruleVersionId: null,
    authorityProvisionId: 'p-div2',
    conclusion: null,
    isOverridden: false,
    basis: null,
    impact: null,
    facts: {},
    needsReevaluation: false,
    decidedByName: null,
    decidedAt: null,
    version: 4,
  } as unknown as StatutoryAuditScheduleIii['assessment'],
  detail: detail(),
  baseFacts: {
    reportingFramework: 'ind_as',
    isNbfc: false,
    isBankOrInsurance: false,
    isOpc: false,
    isSmallCompany: false,
    isDormant: false,
    firstTimeIndAs: false,
    turnover: 2_000_000_000,
    specialEntityTypes: [],
    financialYear: '2024-25',
  },
  upstreamReady: true,
  auditFinancialYear: '2024-25',
  capturedFacts: {},
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
      { key: 'route', label: 'Schedule III route determined', met: true, detail: null },
      { key: 'conclusion', label: 'Manager confirms or overrides', met: false, detail: null },
    ],
  },
  memoSuggested: false,
  workbookAvailable: false,
  approved: false,
  viewerIsPartner: true,
  ...over,
});

const workbookView = (over: Partial<FsWorkbookView> = {}): FsWorkbookView => ({
  workflowInstanceId: 'wf1',
  available: false,
  reason:
    'Conclude 02.3 (SCH-06) first — the workbook follows the established presentation framework.',
  selection: null,
  workbook: null,
  m365Enabled: false,
  readOnly: false,
  ...over,
});

const expand = (name: RegExp) => userEvent.click(screen.getByRole('button', { name }));

describe('02.3 Schedule III workspace', () => {
  it('shows the system assessment, the logic behind it and the period-correct references', async () => {
    render(wrap(<ScheduleIiiWorkspace engagementId="e1" sch={sch()} canManage />));
    expect(screen.getByText('Schedule III & Financial Statement Presentation')).toBeInTheDocument();
    expect(
      screen.getByText(/Determine the statutory presentation and disclosure framework/),
    ).toBeInTheDocument();
    const system = screen.getByText('Schedule III / specialised framework').closest('dl')!;
    expect(within(system).getByText('Schedule III Division II')).toBeInTheDocument();
    expect(within(system).getByText('Ind AS')).toBeInTheDocument();
    expect(within(system).getByText('Ordinary company')).toBeInTheDocument();
    // View Section 129 | View Schedule III Division II | View ICAI Division II Guidance Note.
    expect(screen.getAllByText('refs:section_129|schedule_iii_div_ii|icai_gn_div_ii').length).toBe(
      1,
    );
    expect(referenceProps).toHaveBeenCalledWith(
      expect.objectContaining({ contextKey: '02.3', effectiveOn: '2024-04-01' }),
    );

    await expand(/View Assessment Logic/);
    const logic = screen.getByTestId('sch-assessment-logic');
    expect(within(logic).getByText(/Total income ₹200.00 cr ≥ ₹100.00 cr/)).toBeInTheDocument();
    expect(within(logic).getByText(/SCH_III_ROUNDING, version from/)).toBeInTheDocument();
    expect(
      within(logic).getByText('Ind AS company, not an NBFC — Division II.'),
    ).toBeInTheDocument();
  });

  it('opens the source assessment of a fact used', async () => {
    const target = document.createElement('div');
    target.id = 'frf-05';
    target.scrollIntoView = jest.fn();
    document.body.appendChild(target);
    render(wrap(<ScheduleIiiWorkspace engagementId="e1" sch={sch()} canManage />));
    await userEvent.click(screen.getByRole('button', { name: 'Open Source Assessment' }));
    expect(target.scrollIntoView).toHaveBeenCalled();
    target.remove();
  });

  it('shows the Division version metadata, components, cash flow and the grouped disclosure library', async () => {
    render(wrap(<ScheduleIiiWorkspace engagementId="e1" sch={sch()} canManage />));
    expect(screen.getByText('SCHEDULE_III_DIVISION_II')).toBeInTheDocument();
    expect(screen.getByText('Revised January 2022')).toBeInTheDocument();
    // The mapped workbook template, by its title (Division panel and §17 summary).
    expect(
      screen.getAllByText('Financial Statements Workbook — Ind AS / Schedule III Division II'),
    ).toHaveLength(2);

    await expand(/Financial statement components/);
    expect(screen.getByText('Includes OCI')).toBeInTheDocument();
    await expand(/SCH-03 Cash Flow Statement/);
    expect(screen.getByText('Not an OPC, small or dormant company (02.1).')).toBeInTheDocument();
    expect(screen.getByText('refs:section_2_40')).toBeInTheDocument();

    await expand(/Schedule III disclosure library/);
    expect(screen.getByText(/2 of 3 requirements apply/)).toBeInTheDocument();
    expect(screen.getByText('Property / title deeds (1)')).toBeInTheDocument();
    expect(screen.getByText('Included — fact pending')).toBeInTheDocument();
    expect(screen.queryByText('Corporate social responsibility')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Show not-triggered/ }));
    expect(screen.getByText('Corporate social responsibility')).toBeInTheDocument();
    expect(screen.getByText('See 02.7')).toBeInTheDocument();
  });

  it('SCH-05: confirms the system unit, and an override needs a reason', async () => {
    apiFetch.mockResolvedValue({});
    render(wrap(<ScheduleIiiWorkspace engagementId="e1" sch={sch()} canManage />));
    await expand(/SCH-05 Rounding/);
    expect(screen.getByText('lakhs, millions, crores')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm unit' }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/schedule-iii/facts',
      {
        method: 'POST',
        body: { roundingUnit: 'lakhs', roundingReason: null, version: 4 },
      },
    );

    await userEvent.selectOptions(screen.getByLabelText('Unit of presentation'), 'crores');
    const override = screen.getByRole('button', { name: 'Override unit' });
    expect(override).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Override reason/), 'Group reporting in crores');
    await userEvent.click(override);
    expect(apiFetch).toHaveBeenLastCalledWith(
      '/engagements/e1/statutory-audit/wf1/schedule-iii/facts',
      {
        method: 'POST',
        body: { roundingUnit: 'crores', roundingReason: 'Group reporting in crores', version: 4 },
      },
    );
  });

  it('SCH-02: captures the specialised format for a bank and says it blocks completion', async () => {
    apiFetch.mockResolvedValue({});
    const bank = sch({
      assessment: {
        ...sch().assessment,
        systemOutcome: 'specialised_format',
      },
      baseFacts: { ...sch().baseFacts, isBankOrInsurance: true, specialEntityTypes: ['bank'] },
      capturedFacts: { specialisedAnswer: 'yes' },
      detail: detail({
        specialised: {
          sch01: 'specialised_format',
          systemSuggested: 'yes',
          matchedRules: [
            {
              code: 'SPEC_BANK',
              entityCategory: 'bank',
              governingAuthority: 'RBI',
              frameworkName: 'Third Schedule to the Banking Regulation Act, 1949',
              effect: 'replaces',
              provisionCode: 'BANKING_REG_ACT_29',
              provisionId: 'p-br29',
              effectiveFrom: '1949-03-16',
            },
          ],
          answer: 'yes',
          governingAuthority: null,
          frameworkName: null,
          effect: null,
          effectiveVersion: null,
          provisionId: null,
          reference: null,
          resolved: false,
        },
      }),
    });
    render(wrap(<ScheduleIiiWorkspace engagementId="e1" sch={bank} canManage />));
    expect(
      screen.getByText(/Third Schedule to the Banking Regulation Act, 1949 — RBI/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Unresolved — this blocks 02.3 completion/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save specialised format' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Governing authority/), 'RBI');
    await userEvent.type(screen.getByLabelText(/Framework name/), 'Banking Regulation Act forms');
    await userEvent.selectOptions(screen.getByLabelText(/Effect on Schedule III/), 'replaces');
    await userEvent.type(screen.getByLabelText(/Authoritative reference/), 's.29 BR Act');
    expect(screen.getByText(/needs Engagement Partner approval at SCH-06/)).toBeInTheDocument();
    await userEvent.click(save);
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/schedule-iii/facts',
      {
        method: 'POST',
        body: {
          governingAuthority: 'RBI',
          frameworkName: 'Banking Regulation Act forms',
          specialisedEffect: 'replaces',
          specialisedVersion: null,
          specialisedReference: 's.29 BR Act',
          version: 4,
        },
      },
    );
    // The question's own evidence (sch_02).
    await expand(/SCH-02 evidence/);
    expect(screen.getByText('evidence:sch_02')).toBeInTheDocument();
  });

  it('SCH-04: links prior-year statements and a status change needs a reason', async () => {
    apiFetch.mockResolvedValue({});
    render(wrap(<ScheduleIiiWorkspace engagementId="e1" sch={sch()} canManage />));
    await expand(/SCH-04 Comparative information/);
    expect(screen.getByText('2023-24')).toBeInTheDocument();
    expect(screen.getByText(/Link the prior-year financial statements below/)).toBeInTheDocument();
    await expand(/SCH-04 prior-year financial statements/);
    expect(screen.getByText('evidence:sch_04')).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByLabelText('Confirm or change the status'),
      'not_applicable',
    );
    expect(screen.getByRole('button', { name: 'Save SCH-04' })).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText(/Reason \(required/),
      'First audited year after conversion',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save SCH-04' }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/schedule-iii/facts',
      {
        method: 'POST',
        body: {
          comparativesStatus: 'not_applicable',
          comparativesReason: 'First audited year after conversion',
          version: 4,
        },
      },
    );
  });

  it('keeps presentation materiality separate from SA 320', async () => {
    render(wrap(<ScheduleIiiWorkspace engagementId="e1" sch={sch()} canManage />));
    await expand(/Presentation Materiality/);
    expect(screen.getByText('₹2,00,00,000')).toBeInTheDocument();
    expect(screen.getByText(/determined in Section 03/)).toBeInTheDocument();
  });

  it('SCH-06: confirms, and an override needs the framework, reason and technical basis', async () => {
    apiFetch.mockResolvedValue({});
    render(wrap(<ScheduleIiiWorkspace engagementId="e1" sch={sch()} canManage />));
    const summary = screen.getByText('Financial Reporting Framework').closest('dl')!;
    expect(within(summary).getByText('lakhs (system-determined)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Confirm Assessment/ }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/schedule-iii/decision',
      {
        method: 'POST',
        body: { action: 'confirm', version: 4 },
      },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Override' }));
    const record = screen.getByRole('button', { name: 'Record override' });
    await userEvent.selectOptions(screen.getByLabelText(/Presentation framework/), 'division_iii');
    await userEvent.type(screen.getByLabelText(/^Reason/), 'Registered as an NBFC on 1 March');
    expect(record).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Technical basis/), 'RBI CoR dated 1 March 2025');
    await userEvent.click(record);
    expect(apiFetch).toHaveBeenLastCalledWith(
      '/engagements/e1/statutory-audit/wf1/schedule-iii/decision',
      {
        method: 'POST',
        body: {
          action: 'override',
          conclusion: 'division_iii',
          basis: 'Registered as an NBFC on 1 March',
          technicalBasis: 'RBI CoR dated 1 March 2025',
          version: 4,
        },
      },
    );
  });

  it('retains the system conclusion on an override and takes the partner approval', async () => {
    apiFetch.mockResolvedValue({});
    const overridden = sch({
      assessment: {
        ...sch().assessment,
        state: 'overridden',
        conclusion: 'division_iii',
        isOverridden: true,
        basis: 'Registered as an NBFC',
      } as StatutoryAuditScheduleIii['assessment'],
      capturedFacts: { technicalBasis: 'RBI CoR' },
      partnerApproval: {
        required: true,
        reason: 'An override needs Engagement Partner approval.',
        approvedByName: null,
        approvedAt: null,
        note: null,
      },
      memoSuggested: true,
    });
    render(wrap(<ScheduleIiiWorkspace engagementId="e1" sch={overridden} canManage />));
    expect(
      screen.getByText(/System conclusion retained: Schedule III Division II/),
    ).toBeInTheDocument();
    expect(screen.getByText('Technical basis: RBI CoR')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve as Engagement Partner' }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/schedule-iii/partner-approve',
      { method: 'POST', body: { note: undefined, version: 4 } },
    );
    // A complex / overridden case opens the evidence with the memo suggested.
    expect(evidenceProps).toHaveBeenCalledWith(
      expect.objectContaining({ subAssessmentId: 's3', memoSuggested: true }),
    );
  });

  it('shows the blocking facts when information is pending', () => {
    const pending = sch({
      professionalAction: 'information_pending',
      pendingReason: 'NBFC registration certificate',
      detail: detail({
        missingFacts: [{ key: 'nbfc', label: 'NBFC status', source: '02.1', anchor: null }],
      }),
    });
    render(wrap(<ScheduleIiiWorkspace engagementId="e1" sch={pending} canManage />));
    expect(
      screen.getByText('Information Pending — NBFC registration certificate'),
    ).toBeInTheDocument();
    expect(screen.getByText('NBFC status (02.1)')).toBeInTheDocument();
    expect(screen.getByText(/Information prevents determination/)).toBeInTheDocument();
  });

  it('is read-only once Section 02 is approved', () => {
    render(
      wrap(
        <ScheduleIiiWorkspace
          engagementId="e1"
          sch={sch({
            approved: true,
            completion: { complete: true, status: 'complete', items: [] },
          })}
          canManage
        />,
      ),
    );
    expect(screen.getByText('Approved (Section 02)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm Assessment/ })).toBeNull();
  });
});

describe('Financial Statements Workbook card (§16)', () => {
  const card = () => wrap(<FsWorkbookCard engagementId="e1" workflowInstanceId="wf1" canManage />);
  const URL = '/engagements/e1/statutory-audit/wf1/schedule-iii/workbook';
  const selection = {
    templateKey: 'fs_workbook_indas_div_ii' as const,
    templateTitle: 'Financial Statements Workbook — Ind AS / Schedule III Division II',
    frameworkVersionId: 'fv2',
    frameworkId: 'SCHEDULE_III_DIVISION_II',
    frameworkVersionLabel: 'As amended by G.S.R. 207(E)',
    division: 'II' as const,
    financialYear: '2024-25',
    periodStart: '2024-04-01',
    entityTypeSlug: 'public_limited',
    templateId: 't1',
    templateVariantKey: 'standard',
    templateVersionId: 'tv3',
    templateVersionNo: 3,
  };

  it('explains why it cannot be created yet', async () => {
    apiFetch.mockResolvedValue(workbookView());
    render(card());
    expect(await screen.findByText(/Conclude 02.3 \(SCH-06\) first/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Create Financial Statements Workbook/ }),
    ).toBeNull();
  });

  it('shows the template it will use and creates the workbook in SharePoint', async () => {
    const created = {
      id: 'w1',
      workflowInstanceId: 'wf1',
      engagementId: 'e1',
      documentId: 'd9',
      title: 'Financial Statements Workbook FY 2024-25 - Acme',
      filename: 'Financial Statements Workbook FY 2024-25 - Acme.xlsx',
      templateKey: 'fs_workbook_indas_div_ii' as const,
      templateId: 't1',
      templateVariantKey: 'standard',
      templateVersionId: 'tv3',
      templateVersionNo: 3,
      frameworkVersionId: 'fv2',
      frameworkId: 'SCHEDULE_III_DIVISION_II',
      frameworkVersionLabel: 'As amended by G.S.R. 207(E)',
      division: 'II' as const,
      financialYear: '2024-25',
      entityTypeSlug: 'public_limited',
      createdByName: 'Partner A',
      createdAt: '2026-10-09T10:00:00Z',
      inSharePoint: true,
      currentVersionNo: 1,
      lastEditedBy: null,
      lastSavedAt: null,
    };
    apiFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === URL && init?.method === 'POST') {
        return Promise.resolve({
          view: workbookView({ workbook: created, selection, reason: null }),
          documentId: 'd9',
          editorUrl: null,
          missingFields: [],
        });
      }
      if (url === URL)
        return Promise.resolve(workbookView({ available: true, reason: null, selection }));
      if (url === '/engagements/e1/documents/d9') return Promise.resolve({ title: 'FS workbook' });
      return Promise.resolve({ source: 'sharepoint', entries: [] });
    });
    render(card());
    expect(await screen.findByText(selection.templateTitle)).toBeInTheDocument();
    expect(screen.getByText('standard · version 3')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: /Create Financial Statements Workbook/ }),
    );
    expect(apiFetch).toHaveBeenCalledWith(URL, { method: 'POST', body: {} });
    // Opened straight away; the card now carries the version metadata.
    expect(await screen.findByText('preview:FS workbook')).toBeInTheDocument();
    expect(screen.getByText('fs_workbook_indas_div_ii · standard · version 3')).toBeInTheDocument();
    expect(
      screen.getByText('SCHEDULE_III_DIVISION_II — As amended by G.S.R. 207(E)'),
    ).toBeInTheDocument();
    expect(screen.getByText('SharePoint')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Version History/ }));
    expect(await screen.findByText('SharePoint version history')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(`${URL}/versions`);
  });
});
