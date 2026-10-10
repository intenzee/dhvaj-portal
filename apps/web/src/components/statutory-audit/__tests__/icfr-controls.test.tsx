import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  IcfrComponent,
  IcfrControl,
  IcfrDeficiency,
  IcfrProcessArea,
  StatutoryAuditIcfr,
  StatutoryAuditIcfrConsolidated,
  StatutoryAuditIcfrWorkstream,
} from '@hsdg/contracts';
import { IcfrWorkstream } from '../icfr-workstream';
import { IcfrConsolidated } from '../icfr-consolidated';
import { IcfrEvidence } from '../icfr-evidence';

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

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => apiFetch.mockReset());

const BASE = '/engagements/e1/statutory-audit/wf1/icfr';

function area(over: Partial<IcfrProcessArea> = {}): IcfrProcessArea {
  return {
    id: 'a1',
    areaKey: 'financial_close',
    title: 'Financial Close & Reporting',
    description: 'Period-end close.',
    activation: 'always',
    source: 'framework',
    scoping: 'in_scope',
    scopingSource: 'system',
    suggestedScoping: 'in_scope',
    systemBasis: 'Always in scope for ICFR.',
    scopingReason: null,
    scopedByName: null,
    scopedAt: null,
    procedures: [
      {
        key: 'fcr',
        title: 'Financial close walkthrough',
        objective: 'Walk through.',
        evidence: 'Notes',
      },
    ],
    controls: 1,
    keyIcfrControls: 1,
    openDeficiencies: 0,
    withdrawn: false,
    version: 1,
    ...over,
  };
}

function control(over: Partial<IcfrControl> = {}): IcfrControl {
  return {
    id: 'c1',
    seq: 1,
    controlRef: 'IC-001',
    processAreaId: 'a1',
    process: 'Financial Close & Reporting',
    description: 'Manual journals are approved by the CFO.',
    purposeFsAudit: true,
    purposeIcfr: true,
    assertions: ['accuracy'],
    relatedRiskId: null,
    relatedRiskRef: null,
    relatedRisk: null,
    nature: 'manual',
    frequency: 'monthly',
    isKey: true,
    owner: 'CFO',
    procedureId: null,
    procedureRef: 'P-03',
    design: 'adequate',
    implementation: 'implemented',
    operatingEffectiveness: null,
    overall: 'in_progress',
    testNote: null,
    reviewState: 'open',
    returnNote: null,
    submittedByName: null,
    submittedAt: null,
    reviewedByName: null,
    reviewedAt: null,
    evidence: [],
    deficiencies: [],
    priorYear: null,
    blockers: ['An ICFR control needs an operating-effectiveness conclusion.'],
    withdrawn: false,
    version: 2,
    ...over,
  };
}

function deficiency(over: Partial<IcfrDeficiency> = {}): IcfrDeficiency {
  return {
    id: 'd1',
    seq: 1,
    ref: 'ICD-001',
    classification: 'significant_deficiency',
    suggestedClassification: 'material_weakness',
    description: 'Journals posted without review.',
    controlId: 'c1',
    controlRef: 'IC-001',
    processAreaId: 'a1',
    processTitle: 'Financial Close & Reporting',
    workAreaKey: null,
    affectedAccount: 'Journal entries',
    assertions: ['accuracy'],
    magnitude: 'material',
    likelihood: 'probable',
    compensatingControlIds: [],
    compensatingControlRefs: [],
    compensatingNote: null,
    remediationAction: null,
    remediationStatus: 'not_started',
    auditImpact: null,
    reportingImpact: null,
    reportingNote: null,
    followUpId: null,
    reviewedByName: null,
    reviewedAt: null,
    partnerRequired: true,
    partnerConclusion: null,
    partnerByName: null,
    partnerAt: null,
    status: 'open',
    blockers: ['Classified below the methodology — evaluate the compensating controls.'],
    withdrawn: false,
    version: 1,
    ...over,
  };
}

function workstream(
  over: Partial<StatutoryAuditIcfrWorkstream> = {},
): StatutoryAuditIcfrWorkstream {
  return {
    workflowInstanceId: 'wf1',
    engagementId: 'e1',
    state: 'active',
    reason:
      'Section 143(3)(i) reporting applies (02.5 concluded) — the ICFR audit workstream is configured in Section 05.',
    level1: {
      outcome: 'applicable',
      decided: true,
      reportingApplies: true,
      consolidatedStatus: 'not_applicable',
      financialYear: '2024-25',
      periodStart: '2024-04-01',
    },
    workstream: {
      id: 'w1',
      frameworkCode: 'DHVAJ_ICFR',
      frameworkLabel: 'DHVAJ ICFR process-area framework v1',
      periodStart: '2024-04-01',
      status: 'active',
      withdrawnAt: null,
      withdrawnReason: null,
      conclusion: null,
      conclusionNote: null,
      concludedByName: null,
      concludedAt: null,
      createdAt: '2025-05-02T10:00:00Z',
      version: 3,
    },
    processAreas: [
      area(),
      area({
        id: 'a2',
        areaKey: 'itgc',
        title: 'IT General Controls',
        activation: 'it_dependency',
        scoping: 'to_be_scoped',
        suggestedScoping: 'to_be_scoped',
        systemBasis: 'No accounting software recorded — scope it.',
        controls: 0,
        keyIcfrControls: 0,
      }),
    ],
    controls: [control()],
    deficiencies: [deficiency()],
    followUps: [
      {
        id: 'f1',
        priorFinancialYear: '2023-24',
        priorRef: 'ICD-004',
        priorClassification: 'material_weakness',
        priorDescription: 'No inventory count controls.',
        priorProcess: 'Inventory',
        priorRemediationAction: 'Introduce cycle counts.',
        priorRemediationStatus: 'not_remediated',
        status: 'open',
        conclusionNote: null,
        deficiencyId: null,
        deficiencyRef: null,
        concludedByName: null,
        concludedAt: null,
        version: 1,
      },
    ],
    priorYear: {
      financialYear: '2023-24',
      applicability: 'applicable',
      workstreamConclusion: 'modified_material_weakness',
      materialWeaknesses: [
        {
          ref: 'ICD-004',
          description: 'No inventory count controls.',
          remediationStatus: 'not_remediated',
        },
      ],
      significantDeficiencies: [],
    },
    summary: {
      processAreas: { inScope: 1, notInScope: 0, toBeScoped: 1 },
      controls: {
        total: 1,
        icfr: 1,
        fsAuditOnly: 0,
        both: 1,
        effective: 0,
        deficient: 0,
        notAssessed: 0,
        awaitingReview: 0,
      },
      deficiencies: {
        total: 1,
        open: 1,
        controlDeficiencies: 0,
        significantDeficiencies: 1,
        materialWeaknesses: 0,
        awaitingReview: 1,
        awaitingPartner: 0,
      },
      followUps: { total: 1, open: 1 },
    },
    conclusionBlockers: ['Scope IT General Controls.', 'Manager review of ICD-001.'],
    methodology: {
      basis: 'DHVAJ methodology aligned with the ICAI Guidance Note on Audit of ICFR.',
      matrix: [
        { magnitude: 'material', likelihood: 'probable', classification: 'material_weakness' },
      ],
      partnerConclusionFor: ['significant_deficiency', 'material_weakness'],
    },
    risks: [],
    workAreas: [],
    readOnly: false,
    ...over,
  };
}

describe('IcfrWorkstream (02.5 §13–§16, §19)', () => {
  it('waits for a decisive 02.5 result — nothing is configured by hand', async () => {
    apiFetch.mockResolvedValueOnce(
      workstream({
        state: 'awaiting_conclusion',
        reason:
          '02.5 is Further Assessment Required — the ICFR workstream waits for a decisive result.',
        workstream: null,
        processAreas: [],
        controls: [],
        deficiencies: [],
        followUps: [],
        priorYear: null,
      }),
    );
    render(wrap(<IcfrWorkstream engagementId="e1" workflowInstanceId="wf1" canManage={false} />));
    expect(await screen.findByText('Awaiting the 02.5 conclusion')).toBeInTheDocument();
    expect(screen.getByText(/waits for a decisive result/)).toBeInTheDocument();
    expect(screen.queryByText('Workstream conclusion')).not.toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/workstream`);
  });

  it('shows the framework, scoping basis, prior-year follow-up and what blocks the conclusion', async () => {
    apiFetch.mockResolvedValueOnce(workstream());
    render(wrap(<IcfrWorkstream engagementId="e1" workflowInstanceId="wf1" />));
    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.getByText(/DHVAJ ICFR process-area framework v1/)).toBeInTheDocument();
    expect(screen.getByText('1 to be scoped')).toBeInTheDocument();
    const fu = screen.getByLabelText('Follow-up ICD-004');
    expect(within(fu).getByRole('combobox', { name: 'This year' })).toHaveValue('open');
    expect(within(fu).getByText(/Introduce cycle counts/)).toBeInTheDocument();
    expect(screen.getByText(/never rolled forward/)).toBeInTheDocument();
    const blockers = screen.getByLabelText('ICFR workstream conclusion');
    expect(within(blockers).getByText('Scope IT General Controls.')).toBeInTheDocument();
    expect(within(blockers).getByRole('button', { name: /Conclude/ })).toBeDisabled();
  });

  it('records a team scoping decision with its reason', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce(workstream());
    render(wrap(<IcfrWorkstream engagementId="e1" workflowInstanceId="wf1" />));
    await user.click(await screen.findByLabelText('Expand IT General Controls'));
    const row = screen.getByLabelText('Process area IT General Controls');
    expect(within(row).getByText(/No accounting software recorded/)).toBeInTheDocument();
    await user.selectOptions(within(row).getByLabelText('Scoping'), 'not_in_scope');
    await user.type(within(row).getByLabelText('Reason'), 'Manual records only.');
    apiFetch.mockResolvedValueOnce(workstream());
    await user.click(within(row).getByRole('button', { name: 'Save scoping' }));
    expect(apiFetch).toHaveBeenLastCalledWith(`${BASE}/process-areas/a2`, {
      method: 'PATCH',
      body: { scoping: 'not_in_scope', scopingReason: 'Manual records only.', version: 1 },
    });
  });

  it('keeps D / I / OE separate and blocks the submit until they are concluded', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce(workstream());
    render(wrap(<IcfrWorkstream engagementId="e1" workflowInstanceId="wf1" />));
    const row = await screen.findByLabelText('Control IC-001');
    expect(within(row).getByText('FS audit')).toBeInTheDocument();
    expect(within(row).getByText('ICFR')).toBeInTheDocument();
    await user.click(within(row).getByLabelText('Expand IC-001'));
    expect(
      within(row).getByText('An ICFR control needs an operating-effectiveness conclusion.'),
    ).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Submit for review' })).toBeDisabled();
    await user.selectOptions(within(row).getByLabelText('Operating effectiveness'), 'effective');
    apiFetch.mockResolvedValueOnce(workstream());
    await user.click(within(row).getByRole('button', { name: 'Save conclusions' }));
    expect(apiFetch).toHaveBeenLastCalledWith(`${BASE}/controls/c1`, {
      method: 'PATCH',
      body: {
        design: 'adequate',
        implementation: 'implemented',
        operatingEffectiveness: 'effective',
        testNote: null,
        version: 2,
      },
    });
  });

  it('shows the methodology suggestion and gates the Manager review on its blockers', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce(workstream());
    render(wrap(<IcfrWorkstream engagementId="e1" workflowInstanceId="wf1" />));
    const row = await screen.findByLabelText('Deficiency ICD-001');
    expect(within(row).getByText('Significant Deficiency')).toBeInTheDocument();
    expect(within(row).getByText('Methodology: Material Weakness')).toBeInTheDocument();
    await user.click(within(row).getByLabelText('Expand ICD-001'));
    expect(within(row).getByText(/evaluate the compensating controls/)).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Record Manager review' })).toBeDisabled();
  });

  it('lets the partner conclude a reviewed SD / MW with a note', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce(
      workstream({
        deficiencies: [
          deficiency({
            classification: 'material_weakness',
            reviewedAt: '2025-05-03T10:00:00Z',
            reviewedByName: 'Asha Manager',
            blockers: [],
          }),
        ],
      }),
    );
    render(wrap(<IcfrWorkstream engagementId="e1" workflowInstanceId="wf1" />));
    const row = await screen.findByLabelText('Deficiency ICD-001');
    await user.click(within(row).getByLabelText('Expand ICD-001'));
    await user.type(within(row).getByLabelText('Partner conclusion'), 'Opinion modified.');
    apiFetch.mockResolvedValueOnce(workstream());
    await user.click(within(row).getByRole('button', { name: 'Partner concludes' }));
    expect(apiFetch).toHaveBeenLastCalledWith(`${BASE}/deficiencies/d1/review`, {
      method: 'POST',
      body: { action: 'partner_conclude', partnerConclusion: 'Opinion modified.', version: 1 },
    });
  });

  it('a withdrawn workstream keeps its record, read-only for ICFR', async () => {
    apiFetch.mockResolvedValueOnce(
      workstream({
        state: 'withdrawn',
        reason: 'Statutory ICFR reporting is exempt — no separate section 143(3)(i) workstream.',
        workstream: {
          ...workstream().workstream!,
          status: 'withdrawn',
          withdrawnAt: '2025-06-01T00:00:00Z',
        },
      }),
    );
    render(wrap(<IcfrWorkstream engagementId="e1" workflowInstanceId="wf1" />));
    expect(await screen.findByText('Withdrawn')).toBeInTheDocument();
    expect(screen.getByLabelText('Control IC-001')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add another significant process' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Conclude/ })).not.toBeInTheDocument();
  });
});

function component(over: Partial<IcfrComponent> = {}): IcfrComponent {
  return {
    id: 'm1',
    source: '02.6',
    componentName: 'Acme Retail Pvt Ltd',
    relationship: 'subsidiary',
    indianCompany: 'yes',
    componentIcfr: 'pending',
    auditor: null,
    auditorName: null,
    reportDocumentId: null,
    reportDocumentTitle: null,
    materiality: null,
    materialityNote: null,
    materialWeakness: null,
    materialWeaknessDetails: null,
    missing: ['Decide whether section 143(3)(i) applies to the component.'],
    withdrawn: false,
    version: 1,
    ...over,
  };
}

function consolidated(
  over: Partial<StatutoryAuditIcfrConsolidated> = {},
): StatutoryAuditIcfrConsolidated {
  return {
    workflowInstanceId: 'wf1',
    engagementId: 'e1',
    state: 'active',
    reason: 'Consolidated financial statements are in scope (02.6).',
    consolidated: {
      id: 'k1',
      status: 'active',
      withdrawnReason: null,
      parentConclusion: null,
      parentConclusionNote: null,
      concludedByName: null,
      concludedAt: null,
      version: 1,
    },
    components: [component()],
    summary: { components: 1, pending: 1, indianCompanies: 1, materialWeaknesses: 0 },
    suggestedConclusion: null,
    conclusionBlockers: ['Acme Retail Pvt Ltd: decide whether section 143(3)(i) applies.'],
    readOnly: false,
    ...over,
  };
}

describe('IcfrConsolidated (02.5 §17)', () => {
  it('lists the 02.6 components with what each still needs', async () => {
    apiFetch.mockResolvedValueOnce(consolidated());
    render(wrap(<IcfrConsolidated engagementId="e1" workflowInstanceId="wf1" />));
    const row = await screen.findByLabelText('Component Acme Retail Pvt Ltd');
    expect(within(row).getByText('From 02.6')).toBeInTheDocument();
    expect(within(row).getByText('ICFR Pending')).toBeInTheDocument();
    expect(within(row).getByText(/Still needed/)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    expect(screen.getByText('1 pending')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/consolidated`);
  });

  it('records the component ICFR answer', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce(consolidated());
    render(wrap(<IcfrConsolidated engagementId="e1" workflowInstanceId="wf1" />));
    const row = await screen.findByLabelText('Component Acme Retail Pvt Ltd');
    apiFetch.mockResolvedValueOnce(consolidated());
    await user.selectOptions(
      within(row).getByLabelText('Section 143(3)(i) for the component'),
      'applicable',
    );
    expect(apiFetch).toHaveBeenLastCalledWith(`${BASE}/consolidated/components/m1`, {
      method: 'PATCH',
      body: { componentIcfr: 'applicable', version: 1 },
    });
  });

  it('pre-selects the suggested parent conclusion for the partner', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce(
      consolidated({
        components: [
          component({ componentIcfr: 'applicable', materialWeakness: true, missing: [] }),
        ],
        summary: { components: 1, pending: 0, indianCompanies: 1, materialWeaknesses: 1 },
        suggestedConclusion: 'modified_component_material_weakness',
        conclusionBlockers: [],
      }),
    );
    render(wrap(<IcfrConsolidated engagementId="e1" workflowInstanceId="wf1" />));
    const box = await screen.findByLabelText('Consolidated ICFR conclusion');
    expect(within(box).getByText(/Suggested from the components/)).toBeInTheDocument();
    expect(within(box).getByLabelText('Conclusion')).toHaveValue(
      'modified_component_material_weakness',
    );
    apiFetch.mockResolvedValueOnce(consolidated());
    await user.click(within(box).getByRole('button', { name: /Conclude/ }));
    expect(apiFetch).toHaveBeenLastCalledWith(`${BASE}/consolidated/conclusion`, {
      method: 'POST',
      body: {
        parentConclusion: 'modified_component_material_weakness',
        note: null,
        version: 1,
      },
    });
  });

  it('says why nothing is needed without CFS in scope', async () => {
    apiFetch.mockResolvedValueOnce(
      consolidated({
        state: 'not_required',
        reason: 'No consolidated financial statements in scope (02.6).',
        consolidated: null,
        components: [],
        summary: { components: 0, pending: 0, indianCompanies: 0, materialWeaknesses: 0 },
        conclusionBlockers: [],
      }),
    );
    render(wrap(<IcfrConsolidated engagementId="e1" workflowInstanceId="wf1" />));
    expect(await screen.findByText('Not required')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add component' })).not.toBeInTheDocument();
  });
});

describe('IcfrEvidence (02.5 §20)', () => {
  it('suggests the ICFR memo through the shared Section 02 evidence', async () => {
    apiFetch.mockResolvedValue({
      subAssessmentId: 's1',
      subSectionKey: '02.5',
      files: [],
      memo: { available: true, reason: null, templateVersionNo: 1 },
      m365Enabled: false,
      readOnly: false,
    });
    render(
      wrap(
        <IcfrEvidence
          engagementId="e1"
          icfr={
            {
              workflowInstanceId: 'wf1',
              assessment: { id: 's1' },
              memoSuggested: true,
            } as unknown as StatutoryAuditIcfr
          }
          readOnly={false}
        />,
      ),
    );
    expect(await screen.findByLabelText('ICFR evidence and memo')).toBeInTheDocument();
    expect(apiFetch.mock.calls[0]?.[0]).toMatch(/framework\/s1\/evidence/);
  });
});
