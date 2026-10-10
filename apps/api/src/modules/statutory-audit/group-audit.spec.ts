import type { ConsolidationWorkLibraryItem } from '@hsdg/contracts';
import {
  auditorChanged,
  branchMissing,
  componentMissing,
  computeGroupAuditStatus,
  findingCategoryForReport,
  findingDefaults,
  findingImpactError,
  findingRef,
  groupMatrixState,
  matrixComponents,
  packageRelevance,
  pendingPackageDocuments,
  perimeterFromDetail,
  planConsolidationProcedures,
  planWorkProgramme,
  suggestAuditor,
  suggestBr01,
  suggestGa01,
  suggestSa600,
  workItemApplicability,
  workItemsInForce,
  workProgrammeFacts,
  workProgrammeState,
  type ComponentRowFacts,
  type StatusComponent,
} from './group-audit';

const detail = {
  perimeter: [
    {
      id: 'c1',
      name: 'Alpha Pvt Ltd',
      relationship: 'subsidiary',
      method: 'full_consolidation',
      included: 'yes',
      country: 'India',
      isIndianCompany: true,
      auditedByOtherAuditor: true,
      policy: { result: 'aligned' },
    },
    {
      id: 'c2',
      name: 'Beta GmbH',
      relationship: 'associate',
      method: 'equity_method',
      included: 'yes',
      country: 'Germany',
      isIndianCompany: false,
      policy: { result: 'conversion_required' },
    },
    { id: 'c3', name: 'Gamma', relationship: 'subsidiary', included: 'no' },
    { id: 'c4', name: 'Delta', relationship: 'none', included: 'yes' },
    { name: '  ' },
    { id: 'c5', name: 'Epsilon JO', relationship: 'joint_operation', included: 'yes' },
  ],
};

describe('perimeter and matrix plan (§12)', () => {
  const perimeter = perimeterFromDetail(detail);

  it('reads the extra facts aligned with the component refs', () => {
    expect(perimeter.map((p) => p.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(perimeter[0]).toMatchObject({ auditedByOtherAuditor: true, policyResult: 'aligned' });
    expect(perimeter[1]).toMatchObject({
      auditedByOtherAuditor: false,
      policyResult: 'conversion_required',
      isIndianCompany: false,
    });
  });

  it('gives a matrix row only to included subsidiaries, associates and JVs', () => {
    expect(matrixComponents(perimeter).map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('is active only while CFS is required', () => {
    expect(groupMatrixState(true).state).toBe('active');
    expect(groupMatrixState(false).state).toBe('not_required');
    expect(groupMatrixState(null).state).toBe('awaiting');
  });
});

describe('suggestions', () => {
  it('rolls the auditor forward from last year first', () => {
    const s = suggestAuditor(
      { auditedByOtherAuditor: false },
      {
        auditorType: 'other_auditor',
        firmName: 'KR & Co',
        frn: null,
        professionalBody: null,
        auditorCountry: null,
        partnerContact: null,
        reportType: null,
      },
    );
    expect(s).toMatchObject({ type: 'other_auditor', source: 'prior_year' });
    expect(s.basis).toContain('KR & Co');
  });

  it('falls back to the 02.6 record, else TBD', () => {
    expect(suggestAuditor({ auditedByOtherAuditor: true }, null).type).toBe('other_auditor');
    expect(suggestAuditor({ auditedByOtherAuditor: false }, null).type).toBe('tbd');
  });

  it('derives SA 600 from the auditor', () => {
    expect(suggestSa600('other_auditor')).toBe('required');
    expect(suggestSa600('dhvaj')).toBe('not_applicable');
    expect(suggestSa600('unaudited_special_purpose')).toBe('not_applicable');
    expect(suggestSa600('tbd')).toBe('pending');
  });

  it('suggests GA-01 Yes only when DHVAJ audits every component', () => {
    expect(suggestGa01(['dhvaj', 'none']).answer).toBe('yes');
    expect(suggestGa01(['dhvaj', 'other_auditor']).answer).toBe('further_assessment');
    expect(suggestGa01(['tbd']).answer).toBe('further_assessment');
    expect(suggestGa01([]).answer).toBeNull();
  });

  it('suggests BR-01 from branch records and the master', () => {
    expect(suggestBr01({ branchesOnMaster: false, branchRecords: 2 }).answer).toBe('yes');
    expect(suggestBr01({ branchesOnMaster: true, branchRecords: 0 }).answer).toBe('pending');
    expect(suggestBr01({ branchesOnMaster: false, branchRecords: 0 }).answer).toBe('no');
  });
});

describe('reporting package (§15)', () => {
  it('needs no package for DHVAJ / none / TBD', () => {
    expect(packageRelevance('dhvaj', true)).toBeNull();
    expect(packageRelevance('tbd', null)).toBeNull();
  });

  it('drops ICFR / CARO for a foreign component, audit report / memo when unaudited', () => {
    const foreign = packageRelevance('other_auditor', false)!;
    expect(foreign.icfr_report).toBe(false);
    expect(foreign.caro_report).toBe(false);
    expect(foreign.audit_report).toBe(true);
    expect(packageRelevance('other_auditor', null)!.caro_report).toBe(true);
    const unaudited = packageRelevance('unaudited_special_purpose', true)!;
    expect(unaudited.audit_report).toBe(false);
    expect(unaudited.completion_memo).toBe(false);
  });

  it('counts relevant documents still pending', () => {
    const rel = packageRelevance('other_auditor', false);
    expect(pendingPackageDocuments(rel, {})).toHaveLength(8);
    expect(
      pendingPackageDocuments(rel, { component_tb: 'received', audit_report: 'not_applicable' }),
    ).toHaveLength(6);
  });
});

describe('row completeness', () => {
  const base: ComponentRowFacts = {
    auditorType: 'other_auditor',
    firmName: 'KR & Co',
    country: 'India',
    auditorCountry: null,
    periodFrom: '2025-04-01',
    periodTo: '2026-03-31',
    reportType: 'unmodified',
    sa600: 'required',
    significance: 'significant',
    ga02: 'yes',
    ga03: 'yes',
    ga04: 'yes',
    hasReport: true,
    hasCompletionMemo: true,
    hasInstructions: true,
    pendingPackage: 0,
    priorReportType: null,
    findingCategories: [],
  };

  it('is complete when everything is recorded', () => {
    expect(componentMissing(base)).toEqual([]);
  });

  it('asks only for the auditor while TBD', () => {
    expect(componentMissing({ ...base, auditorType: 'tbd' })).toEqual([
      'Record who audits this component',
    ]);
  });

  it('lists what another auditor still needs', () => {
    const m = componentMissing({
      ...base,
      firmName: null,
      ga03: 'pending',
      hasInstructions: false,
      ga04: 'pending',
      hasReport: false,
      pendingPackage: 3,
    });
    expect(m).toEqual([
      'Component auditor firm',
      'Component instructions (GA-03)',
      'GA-04 sufficiency of the other auditor’s work',
      'Component audit report (SharePoint)',
      '3 reporting-package documents pending',
    ]);
  });

  it("carries last year's modified opinion as a follow-up (§21)", () => {
    expect(componentMissing({ ...base, reportType: null, priorReportType: 'qualified' })).toContain(
      "Follow up last year's qualified opinion",
    );
  });

  it('asks for a group finding for a modified or emphasis report until one is recorded (§16)', () => {
    expect(componentMissing({ ...base, reportType: 'qualified' })).toEqual([
      'Record a group finding for the qualified opinion (modified opinion)',
    ]);
    expect(
      componentMissing({
        ...base,
        reportType: 'qualified',
        findingCategories: ['modified_opinion'],
      }),
    ).toEqual([]);
    expect(componentMissing({ ...base, reportType: 'unmodified_emphasis' })).toEqual([
      expect.stringContaining('(emphasis / other matter)'),
    ]);
  });

  it('needs nothing extra for a DHVAJ component', () => {
    expect(componentMissing({ ...base, auditorType: 'dhvaj', firmName: null })).toEqual([]);
  });

  it('lists what a branch record needs', () => {
    expect(
      branchMissing({
        firmName: 'B & Co',
        appointmentBasis: 'board_authorised',
        periodFrom: '2025-04-01',
        periodTo: '2026-03-31',
        significance: 'not_significant',
        ga02: 'yes',
        ga03: 'yes',
        ga04: 'pending',
        hasReport: false,
        hasInstructions: true,
        principalResponse: null,
        conclusion: 'pending',
      }),
    ).toEqual([
      'GA-04 sufficiency of the branch auditor’s work',
      'Branch audit report (SharePoint)',
      'Principal auditor response / conclusion',
    ]);
  });

  it('flags a changed auditor against last year', () => {
    const prior = {
      auditorType: 'other_auditor' as const,
      firmName: 'KR & Co',
      frn: null,
      professionalBody: null,
      auditorCountry: null,
      partnerContact: null,
      reportType: null,
    };
    expect(auditorChanged({ auditorType: 'other_auditor', firmName: 'kr  & co' }, prior)).toBe(
      false,
    );
    expect(auditorChanged({ auditorType: 'other_auditor', firmName: 'New LLP' }, prior)).toBe(true);
    expect(auditorChanged({ auditorType: 'dhvaj', firmName: null }, prior)).toBe(true);
    expect(auditorChanged({ auditorType: 'tbd', firmName: null }, prior)).toBe(false);
    expect(auditorChanged({ auditorType: 'dhvaj', firmName: null }, null)).toBe(false);
  });
});

describe('findings (§16)', () => {
  it('numbers findings GF-001…', () => {
    expect(findingRef(7)).toBe('GF-007');
  });

  it('accepts only the impacts of the category', () => {
    expect(findingImpactError('modified_opinion', ['partner_attention'])).toBeNull();
    expect(findingImpactError('modified_opinion', [])).toContain('Choose the group impact');
    expect(findingImpactError('going_concern', ['no_impact'])).toContain('not an impact');
  });

  it('escalates fraud and sends reporting matters to Section 07 / 08', () => {
    expect(findingDefaults('fraud')).toEqual({ escalated: true, reportingConsideration: true });
    expect(findingDefaults('emphasis_other_matter')).toEqual({
      escalated: false,
      reportingConsideration: false,
    });
  });

  it('suggests a category from the component report', () => {
    expect(findingCategoryForReport('adverse')).toBe('modified_opinion');
    expect(findingCategoryForReport('unmodified_emphasis')).toBe('emphasis_other_matter');
    expect(findingCategoryForReport('unmodified')).toBeNull();
  });
});

describe('work programme (§19)', () => {
  const lib = (
    key: string,
    from: string,
    to: string | null = null,
  ): ConsolidationWorkLibraryItem => ({
    id: `${key}-${from}`,
    frameworkCode: 'DHVAJ_CFS',
    frameworkLabel: 'v1',
    itemKey: key,
    title: key,
    objective: 'o',
    evidence: 'e',
    activation: 'always',
    sortOrder: key === 'b' ? 1 : 2,
    effectiveFrom: from,
    effectiveTo: to,
  });

  it('takes the version in force per item', () => {
    const items = workItemsInForce(
      [lib('a', '2014-04-01'), lib('a', '2025-04-01'), lib('b', '2014-04-01', '2020-03-31')],
      '2025-04-01',
    );
    expect(items.map((i) => i.id)).toEqual(['a-2025-04-01']);
  });

  it('activates items from the perimeter facts', () => {
    const perimeter = matrixComponents(perimeterFromDetail(detail));
    const f = workProgrammeFacts(perimeter, 1);
    expect(f).toEqual({
      subsidiaries: 1,
      associatesJvs: 1,
      foreign: 1,
      conversions: 1,
      otherAuditors: 1,
    });
    expect(workItemApplicability('foreign', f).applicable).toBe(true);
    const none = {
      subsidiaries: 0,
      associatesJvs: 0,
      foreign: 0,
      conversions: 0,
      otherAuditors: 0,
    };
    expect(workItemApplicability('subsidiary', none)).toEqual({
      applicable: false,
      basis: 'N/A — no subsidiary in the perimeter.',
    });
    expect(workItemApplicability('always', none).applicable).toBe(true);
  });

  it('ensures while CFS is required and withdraws (kept) when not', () => {
    expect(planWorkProgramme(true, 'none')).toBe('ensure');
    expect(planWorkProgramme(true, 'withdrawn')).toBe('ensure');
    expect(planWorkProgramme(false, 'active')).toBe('withdraw');
    expect(planWorkProgramme(false, 'none')).toBe('none');
    expect(planWorkProgramme(null, 'active')).toBe('none');
    expect(workProgrammeState(false, 'withdrawn').state).toBe('withdrawn');
    expect(workProgrammeState(null, 'none').state).toBe('awaiting');
  });

  it('plans one procedure per applicable live item', () => {
    const p = planConsolidationProcedures(
      [
        {
          itemKey: 'nci',
          title: 'NCI',
          objective: 'o',
          evidence: 'e',
          applicable: true,
          withdrawn: false,
        },
        {
          itemKey: 'aoc_1',
          title: 'AOC-1',
          objective: 'o',
          evidence: '',
          applicable: false,
          withdrawn: false,
        },
        {
          itemKey: 'x',
          title: 'X',
          objective: 'o',
          evidence: 'e',
          applicable: true,
          withdrawn: true,
        },
      ],
      'DHVAJ consolidation work programme v1',
    );
    expect(p).toEqual([
      {
        sourceKey: 'cfs:nci',
        sourceNote: '02.6 — DHVAJ consolidation work programme v1',
        title: 'NCI',
        objective: 'o',
        expectedEvidence: 'e',
      },
    ]);
  });
});

describe('group-audit status (Track A reads it)', () => {
  const comp = (over: Partial<StatusComponent> = {}): StatusComponent => ({
    componentId: 'c1',
    componentName: 'Alpha',
    auditorType: 'other_auditor',
    firmName: 'KR & Co',
    significance: 'significant',
    ga02: 'yes',
    ga03: 'yes',
    ga04: 'pending',
    hasInstructions: false,
    pendingPackage: 2,
    ...over,
  });

  it('counts the matrix and blocks a significant GA-04 Pending', () => {
    const s = computeGroupAuditStatus({
      cfsRequired: true,
      expectedComponentIds: ['c1', 'c2'],
      components: [
        comp(),
        comp({ componentId: 'c2', componentName: 'Beta', auditorType: 'dhvaj', firmName: null }),
      ],
      ga01: 'further_assessment',
      br01: 'no',
      branches: [],
      findings: [
        { ref: 'GF-001', subjectName: 'Alpha', category: 'fraud', status: 'open' },
        { ref: 'GF-002', subjectName: 'Alpha', category: 'emphasis_other_matter', status: 'open' },
        { ref: 'GF-003', subjectName: 'Alpha', category: 'going_concern', status: 'resolved' },
      ],
      workProgrammeActive: true,
    });
    expect(s).toMatchObject({
      matrixComplete: true,
      dhvajComponents: 1,
      otherAuditorComponents: 1,
      tbdComponents: 0,
      sa600Required: true,
      sa600Pending: 2,
      instructionsPending: 1,
      pendingReports: 4,
      branchAuditPresent: 'no',
      workProgrammeGenerated: true,
    });
    expect(s.byComponent).toEqual({
      c1: { auditorType: 'other_auditor', auditorName: 'KR & Co' },
      c2: { auditorType: 'dhvaj', auditorName: 'DHVAJ' },
    });
    expect(s.blockingMatters).toHaveLength(2);
    expect(s.blockingMatters[0]).toContain('GA-04 is Pending for Alpha');
    expect(s.blockingMatters[1]).toContain('GF-001');
  });

  it('does not block GA-04 Pending on a component that is not significant', () => {
    const s = computeGroupAuditStatus({
      cfsRequired: true,
      expectedComponentIds: ['c1'],
      components: [comp({ significance: 'not_significant' })],
      ga01: 'yes',
      br01: 'no',
      branches: [],
      findings: [],
      workProgrammeActive: false,
    });
    expect(s.blockingMatters).toEqual([]);
    expect(s.sa600Pending).toBe(1);
  });

  it('is incomplete while a row is missing or TBD; complete when CFS is not required', () => {
    const base = {
      ga01: null,
      br01: 'pending' as const,
      branches: [],
      findings: [],
      workProgrammeActive: false,
    };
    expect(
      computeGroupAuditStatus({
        ...base,
        cfsRequired: true,
        expectedComponentIds: ['c1', 'c9'],
        components: [comp()],
      }).matrixComplete,
    ).toBe(false);
    expect(
      computeGroupAuditStatus({
        ...base,
        cfsRequired: true,
        expectedComponentIds: ['c1'],
        components: [comp({ auditorType: 'tbd' })],
      }).matrixComplete,
    ).toBe(false);
    const notReq = computeGroupAuditStatus({
      ...base,
      cfsRequired: false,
      expectedComponentIds: [],
      components: [comp()],
    });
    expect(notReq.matrixComplete).toBe(true);
    expect(notReq.otherAuditorComponents).toBe(0);
    expect(
      computeGroupAuditStatus({
        ...base,
        cfsRequired: null,
        expectedComponentIds: [],
        components: [],
      }).matrixComplete,
    ).toBe(false);
  });

  it('counts branch auditors only under BR-01 Yes', () => {
    const branch = {
      branchName: 'Pune',
      significance: 'significant' as const,
      ga02: 'yes' as const,
      ga03: 'pending' as const,
      ga04: 'pending' as const,
      hasReport: false,
      principalResponse: null,
      conclusion: 'pending',
    };
    const base = {
      cfsRequired: false,
      expectedComponentIds: [],
      components: [],
      ga01: null,
      branches: [branch],
      findings: [],
      workProgrammeActive: false,
    };
    const yes = computeGroupAuditStatus({ ...base, br01: 'yes' });
    expect(yes).toMatchObject({
      sa600Required: true,
      branchAuditors: 1,
      branchPending: 1,
      sa600Pending: 3,
    });
    expect(yes.blockingMatters[0]).toContain('branch Pune');
    expect(computeGroupAuditStatus({ ...base, br01: 'no' }).branchAuditors).toBe(0);
  });

  it('blocks GA-04 No on a significant branch until the response is recorded', () => {
    const branch = {
      branchName: 'Pune',
      significance: 'significant' as const,
      ga02: 'yes' as const,
      ga03: 'yes' as const,
      ga04: 'no' as const,
      hasReport: true,
      principalResponse: 'Extended procedures',
      conclusion: 'reliance_with_further_work',
    };
    const base = {
      cfsRequired: false,
      expectedComponentIds: [],
      components: [],
      ga01: 'yes' as const,
      br01: 'yes' as const,
      findings: [],
      workProgrammeActive: false,
    };
    const open = { ...branch, principalResponse: null, conclusion: 'pending' };
    const s = computeGroupAuditStatus({ ...base, branches: [open] });
    expect(s.blockingMatters).toEqual([expect.stringContaining('GA-04 is No for branch Pune')]);
    expect(computeGroupAuditStatus({ ...base, branches: [branch] }).blockingMatters).toEqual([]);
    expect(
      computeGroupAuditStatus({
        ...base,
        branches: [{ ...open, significance: 'not_significant' }],
      }).blockingMatters,
    ).toEqual([]);
  });
});
