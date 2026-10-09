import {
  IND_AS_FIRST_TIME_WORK_AREA,
  planFinancialReportingDownstream,
  scheduleIiiDivisionFor,
  type FinancialReportingMemoFacts,
  type FrameworkDownstreamFacts,
  type SmcRelaxation,
} from '@hsdg/contracts';
import { frameworkMemoMergeValues } from './framework-memo-values';
import { suggestProcedures } from './work-automation';

const facts = (o: Partial<FrameworkDownstreamFacts>): FrameworkDownstreamFacts => ({
  framework: null,
  isNbfc: false,
  smcStatus: null,
  firstTimeAdoption: null,
  ...o,
});
const keys = (f: FrameworkDownstreamFacts) => planFinancialReportingDownstream(f).map((a) => a.key);

describe('02.2 downstream plan (spec §19)', () => {
  it('Ind AS activates the Ind AS review framework and routes 02.3 to Division II', () => {
    const f = facts({ framework: 'ind_as' });
    expect(keys(f)).toEqual(['ind_as_review']);
    expect(scheduleIiiDivisionFor(f)).toBe('II');
    expect(planFinancialReportingDownstream(f)[0]!.workAreaKey).toBe('ind_as_review');
  });

  it('NBFC Ind AS routes to Division III with the NBFC presentation logic', () => {
    const f = facts({ framework: 'ind_as', isNbfc: true });
    expect(keys(f)).toEqual(['ind_as_review', 'nbfc_division_iii']);
    expect(scheduleIiiDivisionFor(f)).toBe('III');
  });

  it('first-time Ind AS activates the Ind AS 101 transition work, linked to Ind AS 101', () => {
    const plan = planFinancialReportingDownstream(
      facts({ framework: 'ind_as', firstTimeAdoption: true }),
    );
    const t = plan.find((a) => a.key === 'ind_as_101_transition')!;
    expect(t.provisionCode).toBe('INDAS_101');
    expect(t.workAreaKey).toBe(IND_AS_FIRST_TIME_WORK_AREA.workAreaKey);
  });

  it('AS activates the AS review framework (Division I); AS + SMC adds the SMC relaxations', () => {
    expect(keys(facts({ framework: 'accounting_standards', smcStatus: 'non_smc' }))).toEqual([
      'as_review',
    ]);
    const smc = facts({ framework: 'accounting_standards', smcStatus: 'smc' });
    expect(keys(smc)).toEqual(['as_review', 'smc_relaxations']);
    expect(scheduleIiiDivisionFor(smc)).toBe('I');
  });

  it('first-time adoption never applies outside Ind AS; SMC never outside AS', () => {
    expect(keys(facts({ framework: 'accounting_standards', firstTimeAdoption: true }))).toEqual([
      'as_review',
    ]);
    expect(keys(facts({ framework: 'ind_as', smcStatus: 'smc' }))).toEqual(['ind_as_review']);
  });

  it('a specialised / undetermined conclusion shows the blocking Framework Review owned by 02.2', () => {
    const plan = planFinancialReportingDownstream(facts({ framework: 'specialised_framework' }));
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ key: 'framework_review', managedBy02_2: true });
    expect(scheduleIiiDivisionFor(facts({ framework: 'specialised_framework' }))).toBeNull();
  });

  it('no 02.2 result plans nothing', () => {
    expect(planFinancialReportingDownstream(facts({}))).toEqual([]);
  });
});

describe('downstream work (§19 → Audit Areas)', () => {
  const relax: SmcRelaxation[] = [
    {
      key: 'as17_segment',
      standardCode: 'AS_17',
      standardLabel: 'AS 17 Segment Reporting',
      kind: 'not_applicable',
      paragraphs: null,
      relaxation: 'AS 17 does not apply to an SMC.',
      provisionCode: 'AS_RULES_2021_SMC',
    },
    {
      key: 'as29_disclosures',
      standardCode: 'AS_29',
      standardLabel: 'AS 29 Provisions',
      kind: 'disclosure_exemption',
      paragraphs: '66, 67',
      relaxation: 'Not required.',
      provisionCode: 'AS_RULES_2021_SMC',
    },
  ];

  it('the AS review procedure marks the SMC-exempt items when SMC relaxations are activated', () => {
    const out = suggestProcedures({
      areaKeys: new Set(['schedule_iii_work']),
      fsAreas: [],
      risks: [],
      smcRelaxations: relax,
    });
    const p = out.find((x) => x.sourceKey === 'std:schedule_iii_work:smc_relaxations')!;
    expect(p.workAreaKey).toBe('schedule_iii_work');
    expect(p.objective).toContain('AS 17 Segment Reporting');
    expect(p.objective).toContain('paras 66, 67');
  });

  it('no SMC procedure without activated relaxations or without the AS work area', () => {
    const none = suggestProcedures({
      areaKeys: new Set(['schedule_iii_work']),
      fsAreas: [],
      risks: [],
    });
    expect(none.some((x) => x.sourceKey.endsWith(':smc_relaxations'))).toBe(false);
    const noArea = suggestProcedures({
      areaKeys: new Set(['caro']),
      fsAreas: [],
      risks: [],
      smcRelaxations: relax,
    });
    expect(noArea.some((x) => x.sourceKey.endsWith(':smc_relaxations'))).toBe(false);
  });

  it('the Ind AS 101 work area gets the transition programme', () => {
    const out = suggestProcedures({
      areaKeys: new Set([IND_AS_FIRST_TIME_WORK_AREA.workAreaKey]),
      fsAreas: [],
      risks: [],
    });
    expect(out.map((x) => x.sourceKey)).toEqual([
      'std:ind_as_first_time_adoption:opening_balance_sheet',
      'std:ind_as_first_time_adoption:exemptions_exceptions',
      'std:ind_as_first_time_adoption:reconciliations',
    ]);
  });
});

describe('technical memo merge values (§18)', () => {
  const memo: FinancialReportingMemoFacts = {
    entityName: 'Acme',
    financialYear: '2025-26',
    framework: 'Ind AS',
    applicabilityType: 'Mandatory',
    effectiveFromFy: 'FY 2017-18',
    primaryTrigger: 'Unlisted; net worth ₹312 crore ≥ ₹250 crore',
    secondaryTriggers: '',
    ruleApplied: 'FRF_INDAS_NETWORTH v2 — Rule 4(1)(iii)',
    limitApplied: '₹250 crore',
    factsUsed: [
      { label: 'Listing', value: 'Unlisted' },
      { label: 'Net worth', value: '' },
    ],
    systemConclusion: 'Ind AS',
    systemBasis: 'Unlisted company; applicable net worth ₹312 crore.',
    professionalConclusion: 'Ind AS',
    isOverridden: false,
    overrideReason: '',
    smcStatus: 'Not applicable',
    firstTimeAdoption: 'No',
    decidedBy: 'Partner A',
    decidedAt: '2026-05-04T10:00:00.000Z',
    partnerApproval: '',
    pendingReason: '',
  };

  it('fills the frf.* fields as display text; blanks stay gaps', () => {
    const v = frameworkMemoMergeValues(memo);
    expect(v['frf.framework']).toBe('Ind AS');
    expect(v['frf.limitApplied']).toBe('₹250 crore');
    expect(v['frf.secondaryTriggers']).toBeNull();
    expect(v['frf.overrideReason']).toBeNull();
    expect(v['frf.overridden']).toBe('No');
    expect(v['frf.factsUsed']).toBe('Listing: Unlisted; Net worth: —');
    expect(v['frf.decidedAt']).toMatch(/2026/);
  });

  it('no assessment fills nothing', () => {
    expect(frameworkMemoMergeValues(null)).toEqual({});
  });
});
