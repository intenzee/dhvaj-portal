import { TEMPLATE_MERGE_FIELDS } from '@hsdg/contracts';
import {
  componentInstructionValues,
  consolidationMergeValues,
  type ConsolidationMemoInput,
  type InstructionsInput,
} from './consolidation-memo-values';
import { emptyGroupAuditStatus } from './group-audit';

const base: ConsolidationMemoInput = {
  systemOutcome: 'cfs_required',
  systemBasis: 'The company has a subsidiary and no Rule 6 exemption holds.',
  conclusion: 'cfs_required',
  basis: null,
  isOverridden: false,
  technicalBasis: null,
  supportingEvidence: null,
  decidedByName: 'Asha Manager',
  decidedAt: '2025-05-02T10:00:00.000Z',
  professionalAction: null,
  pendingReason: null,
  partnerApprovedByName: null,
  partnerApprovedAt: null,
  rule6: null,
  perimeter: [
    {
      name: 'Alpha Pvt Ltd',
      relationship: 'subsidiary',
      method: 'full_consolidation',
      included: 'yes',
    },
    { name: 'Beta LLP', relationship: 'associate', method: 'equity_method', included: 'no' },
  ],
  groupFramework: 'ind_as',
  materialityNote: null,
  components: [
    {
      name: 'Alpha Pvt Ltd',
      auditorType: 'other_auditor',
      firmName: 'K & Co',
      reportType: 'unmodified',
    },
  ],
  ga01: 'further_assessment',
  findings: [
    { ref: 'GF-001', subject: 'Alpha Pvt Ltd', category: 'modified_opinion', status: 'open' },
  ],
  br01: 'no',
  branches: [],
  workProgramme: {
    status: 'active',
    label: 'DHVAJ consolidation programme 2025',
    applicable: 12,
    linked: 12,
  },
  status: {
    ...emptyGroupAuditStatus(),
    matrixComplete: true,
    otherAuditorComponents: 1,
    sa600Required: true,
    sa600Pending: 2,
    instructionsPending: 1,
    pendingReports: 3,
  },
};

describe('consolidationMergeValues (02.6 memo)', () => {
  it('only emits known merge fields', () => {
    const known = new Set(TEMPLATE_MERGE_FIELDS.map((f) => f.key));
    for (const k of Object.keys(consolidationMergeValues(base))) expect(known.has(k)).toBe(true);
  });

  it('merges the perimeter, component auditors, SA 600 state, findings and work programme', () => {
    const v = consolidationMergeValues(base);
    expect(v['cfs.perimeter']).toMatch(/^Alpha Pvt Ltd — /);
    expect(v['cfs.perimeter']).not.toMatch(/Beta/);
    expect(v['cfs.componentAuditors']).toMatch(/Alpha Pvt Ltd: .*\(K & Co\)/);
    expect(v['cfs.sa600']).toMatch(/SA 600 applies — 1 component audited by another auditor/);
    expect(v['cfs.sa600']).toMatch(/2 answers still pending; instructions pending for 1/);
    expect(v['cfs.reportingPackages']).toBe('3 reporting-package documents pending');
    expect(v['cfs.otherAuditorFindings']).toMatch(/^GF-001 Alpha Pvt Ltd — .*\(open\)$/);
    expect(v['cfs.branchAuditors']).toBe('BR-01 No — no branch audited by another auditor');
    expect(v['cfs.workProgramme']).toBe(
      'DHVAJ consolidation programme 2025 — 12 applicable items, 12 in Section 06',
    );
    expect(v['cfs.rule6']).toBe('Not reached — Rule 6 was not assessed');
    expect(v['cfs.overrideReason']).toBe('Not applicable');
  });

  it('says not applicable when CFS is not required, and records a withdrawn programme', () => {
    const v = consolidationMergeValues({
      ...base,
      systemOutcome: 'not_applicable',
      conclusion: 'not_applicable',
      components: [],
      workProgramme: { status: 'withdrawn', label: null, applicable: 0, linked: 0 },
      status: emptyGroupAuditStatus(),
    });
    expect(v['cfs.componentAuditors']).toMatch(/^Not applicable/);
    expect(v['cfs.sa600']).toMatch(/^Not applicable/);
    expect(v['cfs.reportingPackages']).toBe('Not applicable');
    expect(v['cfs.workProgramme']).toMatch(/^Withdrawn/);
  });

  it('leaves a gap (never a guess) for missing CFS-required facts', () => {
    const v = consolidationMergeValues({ ...base, components: [], workProgramme: null });
    expect(v['cfs.componentAuditors']).toBeNull();
    expect(v['cfs.workProgramme']).toBeNull();
  });

  it('is empty when 02.6 is not open', () => {
    expect(consolidationMergeValues(null)).toEqual({});
  });
});

describe('componentInstructionValues (§14)', () => {
  const input: InstructionsInput = {
    componentName: 'Alpha Pvt Ltd',
    relationship: 'subsidiary',
    componentCountry: 'India',
    isIndianCompany: true,
    firmName: 'K & Co',
    frn: '012345S',
    professionalBody: 'ICAI',
    partnerContact: 'R. Iyer',
    periodFrom: '2024-04-01',
    periodTo: '2025-03-31',
    reportingDeadline: '2025-04-30',
    groupFramework: 'ind_as',
    materiality: null,
    significantRisks: [],
    otherComponents: [],
    packageDocuments: ['audit_report', 'financial_statements'],
  };

  it('only emits known merge fields', () => {
    const known = new Set(TEMPLATE_MERGE_FIELDS.map((f) => f.key));
    for (const k of Object.keys(componentInstructionValues(input))) expect(known.has(k)).toBe(true);
  });

  it('never invents materiality before Section 03.3 is approved', () => {
    const v = componentInstructionValues(input);
    expect(v['ga.materiality']).toMatch(/once materiality is approved/);
    expect(v['ga.clearlyTrivial']).toMatch(/once materiality is approved/);
  });

  it('uses the approved materiality, risks and package list', () => {
    const v = componentInstructionValues({
      ...input,
      materiality: {
        versionNo: 2,
        overall: '1500000',
        performance: '1125000',
        clearlyTrivial: '75000',
      },
      significantRisks: [{ ref: 'R-01', description: 'Revenue cut-off' }],
      otherComponents: ['Gamma Ltd'],
    });
    expect(v['ga.materiality']).toMatch(/₹15,00,000.*₹11,25,000.*version 2/);
    expect(v['ga.clearlyTrivial']).toBe('₹75,000');
    expect(v['ga.significantRisks']).toBe('R-01 — Revenue cut-off');
    expect(v['ga.groupComponents']).toBe('Gamma Ltd');
    expect(v['ga.auditorFrn']).toBe('012345S — ICAI');
    expect(v['ga.reportingPackage']?.split('; ')).toHaveLength(2);
  });

  it('drops CARO and ICFR reporting for a foreign component', () => {
    const v = componentInstructionValues({ ...input, isIndianCompany: false });
    expect(v['ga.icfrReporting']).toMatch(/^Not required/);
    expect(v['ga.caroReporting']).toMatch(/^Not required/);
  });
});
