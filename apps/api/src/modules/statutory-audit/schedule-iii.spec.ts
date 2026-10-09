import {
  FRAMEWORK_AREA_KEY,
  FS_COMPONENT,
  REPORTING_FRAMEWORK_OUTCOME,
  RULE_CRITERION,
  SCHEDULE_III_OUTCOME,
  type ResolvedRule,
  type RuleResolver,
  type ScheduleIiiFacts,
  type ScheduleIiiFrameworkVersion,
} from '@hsdg/contracts';
import {
  assessScheduleIii,
  type ScheduleIiiComponentSpec,
  type ScheduleIiiLibrary,
  type ScheduleIiiRequirementRow,
} from './schedule-iii';

const CRORE = 10_000_000;
const AREA = FRAMEWORK_AREA_KEY.scheduleIii;

function facts(partial: Partial<ScheduleIiiFacts> = {}): ScheduleIiiFacts {
  return {
    reportingFramework: REPORTING_FRAMEWORK_OUTCOME.accountingStandards,
    isNbfc: false,
    isBankOrInsurance: false,
    isOpc: false,
    isSmallCompany: false,
    isDormant: false,
    firstTimeIndAs: false,
    turnover: null,
    specialEntityTypes: [],
    financialYear: '2025-26',
    profileConfirmed: true,
    ...partial,
  };
}

/**
 * Fixture resolver mirroring the seeded rules (migrations 1763600000000 +
 * 1767200000000): the rounding band at ₹100cr with its units as rule data, and
 * the Division presentation thresholds. Keyed `area|criterion|entityClass`.
 */
type Seed = Record<string, Partial<ResolvedRule>>;
const ROUNDING_V2 = {
  ruleCode: 'SCH_III_ROUNDING',
  ruleVersionId: 'rv-round-2',
  threshold: 100 * CRORE,
  effectiveFrom: '2021-04-01',
  condition: {
    measure: 'total_income',
    measureLabel: 'Total income',
    mandatory: true,
    belowUnits: ['hundreds', 'thousands', 'lakhs', 'millions'],
    atOrAboveUnits: ['lakhs', 'millions', 'crores'],
    suggestedBelow: 'lakhs',
    suggestedAtOrAbove: 'crores',
  },
};
const SEED: Seed = {
  [`${AREA}|${RULE_CRITERION.turnover}|`]: ROUNDING_V2,
  [`${AREA}|presentation_materiality|division_i`]: {
    ruleCode: 'SCH_III_PRES_MAT_DIV_I',
    ruleVersionId: 'rv-pm-1',
    threshold: 100_000,
    condition: {
      percentOfMeasure: 1,
      measure: 'revenue_from_operations',
      measureLabel: 'Revenue from operations',
      whicheverHigher: true,
    },
  },
  [`${AREA}|presentation_materiality|division_ii`]: {
    ruleCode: 'SCH_III_PRES_MAT_DIV_II',
    ruleVersionId: 'rv-pm-2',
    threshold: 1_000_000,
    condition: {
      percentOfMeasure: 1,
      measure: 'revenue_from_operations',
      measureLabel: 'Revenue from operations',
      whicheverHigher: true,
    },
  },
};

function makeResolver(overrides: Seed = {}): RuleResolver {
  const table: Seed = { ...SEED, ...overrides };
  return (areaKey, criterion, entityClass): ResolvedRule | null => {
    const hit = table[`${areaKey}|${criterion}|${entityClass ?? ''}`];
    if (!hit) return null;
    return {
      ruleId: 'r',
      ruleCode: 'RULE',
      ruleVersionId: 'rv',
      version: 1,
      areaKey,
      entityClass: entityClass ?? null,
      criterion,
      operator: '>=',
      unit: 'inr',
      threshold: null,
      thresholdHigh: null,
      measurementBasis: 'standalone_audited_fs',
      outcome: null,
      effectiveFrom: '2014-04-01',
      authorityProvisionId: null,
      guidanceReference: null,
      bands: [],
      ...hit,
    } as ResolvedRule;
  };
}
const resolve = makeResolver();

const AS_COMPONENTS: ScheduleIiiComponentSpec[] = [
  { key: 'balance_sheet', label: 'Balance Sheet', when: 'always' },
  { key: 'statement_of_profit_and_loss', label: 'Statement of Profit and Loss', when: 'always' },
  { key: 'cash_flow_statement', label: 'Cash Flow Statement', when: 'cash_flow_required' },
  { key: 'notes_to_accounts', label: 'Notes to Financial Statements', when: 'always' },
];
const INDAS_COMPONENTS: ScheduleIiiComponentSpec[] = [
  { key: 'balance_sheet', label: 'Balance Sheet', when: 'always' },
  {
    key: 'statement_of_profit_and_loss',
    label: 'Statement of Profit and Loss (including OCI)',
    when: 'always',
    oci: true,
  },
  {
    key: 'statement_of_changes_in_equity',
    label: 'Statement of Changes in Equity',
    when: 'always',
  },
  { key: 'cash_flow_statement', label: 'Cash Flow Statement', when: 'cash_flow_required' },
  { key: 'notes_to_accounts', label: 'Notes to Financial Statements', when: 'always' },
];

function version(division: 'I' | 'II' | 'III', templateKey: string): ScheduleIiiFrameworkVersion {
  return {
    id: `fv-${division}`,
    frameworkId: `SCHEDULE_III_DIVISION_${division}`,
    division,
    title: `Schedule III Division ${division}`,
    versionLabel: 'As amended by G.S.R. 207(E), 24 March 2021',
    effectiveFrom: '2021-04-01',
    effectiveTo: null,
    notificationReference: 'G.S.R. 207(E)',
    provisionCode: `SCH_III_DIV_${division}`,
    provisionId: null,
    guidanceProvisionCode: `ICAI_GN_SCH_III_DIV_${division}`,
    guidanceProvisionId: null,
    guidanceVersion: '2022 edition',
    templateKey,
    status: 'active',
  };
}

function req(
  code: string,
  category: ScheduleIiiRequirementRow['category'],
  trigger: ScheduleIiiRequirementRow['trigger'] = null,
): ScheduleIiiRequirementRow {
  return {
    code,
    category,
    label: code,
    description: null,
    trigger,
    provisionCode: null,
    crossLink: null,
    effectiveFrom: '2021-04-01',
  };
}

const LIBRARY: ScheduleIiiLibrary = {
  frameworkVersions: {
    I: { version: version('I', 'fs_workbook_as_div_i'), components: AS_COMPONENTS },
    II: { version: version('II', 'fs_workbook_indas_div_ii'), components: INDAS_COMPONENTS },
    III: { version: version('III', 'fs_workbook_indas_div_iii'), components: INDAS_COMPONENTS },
  },
  requirements: {
    I: [
      req('SCH3_I_ARI_BENAMI', 'benami_property'),
      req('SCH3_I_ARI_TITLE_DEEDS', 'property_title_deeds', 'immovable_property_exists'),
      req('SCH3_I_ARI_CHARGES', 'borrowings_charges', 'borrowings_exist'),
      req('SCH3_I_ARI_CSR', 'csr', 'csr_applicable'),
    ],
    II: [
      req('SCH3_II_ARI_BENAMI', 'benami_property'),
      req('SCH3_II_INDAS_101', 'transition', 'first_time_ind_as'),
    ],
    III: [req('SCH3_III_ARI_RATIOS_NBFC', 'ratios')],
  },
  specialisedRules: [
    {
      code: 'SPEC_FMT_BANK',
      entityCategory: 'bank',
      governingAuthority: 'Reserve Bank of India',
      frameworkName: 'Third Schedule to the Banking Regulation Act, 1949',
      effect: 'replaces',
      provisionCode: 'BANKING_REG_ACT_29',
      provisionId: 'prov-bank',
      effectiveFrom: '2014-04-01',
    },
  ],
};

const run = (
  f: Partial<ScheduleIiiFacts>,
  lib: ScheduleIiiLibrary = LIBRARY,
  r: RuleResolver = resolve,
) => assessScheduleIii(facts(f), r, lib);

describe('assessScheduleIii — routing (spec §6, §21 tests 1–4)', () => {
  it('1. AS → Division I with the versioned framework and its template key', () => {
    const res = run({});
    expect(res.outcome).toBe(SCHEDULE_III_OUTCOME.divisionI);
    expect(res.detail.sch01).toBe('yes');
    expect(res.detail.frameworkVersion?.frameworkId).toBe('SCHEDULE_III_DIVISION_I');
    expect(res.detail.frameworkVersion?.templateKey).toBe('fs_workbook_as_div_i');
    expect(res.detail.divisionProvisionCode).toBe('SCH_III_DIV_I');
    expect(res.detail.requiredComponents).not.toContain(FS_COMPONENT.statementOfChangesInEquity);
  });

  it('2. Ind AS non-NBFC → Division II with SoCE and an OCI P&L', () => {
    const res = run({ reportingFramework: REPORTING_FRAMEWORK_OUTCOME.indAs });
    expect(res.outcome).toBe(SCHEDULE_III_OUTCOME.divisionII);
    expect(res.detail.requiredComponents).toContain(FS_COMPONENT.statementOfChangesInEquity);
    expect(
      res.detail.componentLines?.find((c) => c.key === 'statement_of_profit_and_loss')?.includesOci,
    ).toBe(true);
  });

  it('3. Ind AS NBFC → Division III', () => {
    const res = run({ reportingFramework: REPORTING_FRAMEWORK_OUTCOME.indAs, isNbfc: true });
    expect(res.outcome).toBe(SCHEDULE_III_OUTCOME.divisionIII);
    expect(res.detail.disclosureLibrary?.map((d) => d.code)).toEqual(['SCH3_III_ARI_RATIOS_NBFC']);
  });

  it('4a. a bank matched by a library rule → specialised format, no Division forced', () => {
    const res = run({
      reportingFramework: REPORTING_FRAMEWORK_OUTCOME.indAs,
      isBankOrInsurance: true,
      specialEntityTypes: ['bank'],
    });
    expect(res.outcome).toBe(SCHEDULE_III_OUTCOME.specialisedFormat);
    expect(res.detail.division).toBeNull();
    expect(res.detail.specialised?.systemSuggested).toBe('yes');
    expect(res.detail.specialised?.frameworkName).toMatch(/Banking Regulation Act/);
    expect(res.detail.specialised?.resolved).toBe(false); // SCH-02 not yet answered
    expect(res.detail.blockingReview).toBe(true);
    expect(res.state).toBe('professional_judgement_required');
  });

  it('4b. a regulated entity with no library rule → further assessment, never a Division', () => {
    const res = run({ specialEntityTypes: ['other_regulator'] });
    expect(res.outcome).toBe(SCHEDULE_III_OUTCOME.professionalReview);
    expect(res.detail.sch01).toBe('further_assessment');
    expect(res.detail.blockingReview).toBe(true);
  });

  it('4c. SCH-02 answered with every field resolves the specialised format', () => {
    const res = assessScheduleIii(
      facts({ isBankOrInsurance: true, specialEntityTypes: ['bank'] }),
      resolve,
      LIBRARY,
      { specialisedAnswer: 'yes' },
    );
    expect(res.detail.specialised?.resolved).toBe(true);
    expect(res.detail.blockingReview).toBe(false);
  });

  it('5. information-insufficient until 02.2 is concluded', () => {
    const res = run({ reportingFramework: null });
    expect(res.outcome).toBe(SCHEDULE_III_OUTCOME.informationInsufficient);
    expect(res.detail.missingFacts?.map((m) => m.key)).toContain('reporting_framework');
  });

  it('a missing framework version is reported, never replaced by a constant', () => {
    const res = run({}, { ...LIBRARY, frameworkVersions: {} });
    expect(res.detail.frameworkVersion).toBeNull();
    expect(res.detail.componentLines).toEqual([]);
    expect(res.detail.missingFacts?.map((m) => m.key)).toContain('framework_version');
    expect(res.detail.blockingReview).toBe(true);
  });
});

describe('assessScheduleIii — cash flow consumes 02.1 (spec §10, test 7)', () => {
  it('ordinary company → required', () => {
    expect(run({}).detail.cashFlow?.status).toBe('required');
  });
  it.each([
    [{ isOpc: true }, /One Person Company/],
    [{ isSmallCompany: true }, /small company/],
    [{ isDormant: true }, /dormant/],
  ])('%o → exempt with the exact basis, cash-flow component not required', (f, re) => {
    const res = run(f);
    expect(res.detail.cashFlow?.status).toBe('exempt');
    expect(res.detail.cashFlow?.basis).toMatch(re);
    expect(res.detail.cashFlowRequired).toBe(false);
    expect(res.detail.componentLines?.find((c) => c.key === 'cash_flow_statement')?.required).toBe(
      false,
    );
  });
  it('02.1 unconfirmed and no exemption → further assessment', () => {
    expect(run({ profileConfirmed: false }).detail.cashFlow?.status).toBe('further_assessment');
  });
});

describe('assessScheduleIii — rounding from rule data (spec §14, test 8)', () => {
  it('reads the measure, permitted units and suggestion from the rule version', () => {
    const below = run({ turnover: 80 * CRORE }).detail.rounding!;
    expect(below.band).toBe('below');
    expect(below.permittedUnits).toEqual(['hundreds', 'thousands', 'lakhs', 'millions']);
    expect(below.systemUnit).toBe('lakhs');
    expect(below.sourceLabel).toMatch(/Total income — 02\.1 turnover used as proxy/);
    const above = run({ turnover: 150 * CRORE }).detail.rounding!;
    expect(above.band).toBe('at_or_above');
    expect(above.systemUnit).toBe('crores');
  });

  it('changing the rule data changes the units — nothing is a frontend/engine constant', () => {
    const r = makeResolver({
      [`${AREA}|${RULE_CRITERION.turnover}|`]: {
        ...ROUNDING_V2,
        condition: {
          ...ROUNDING_V2.condition,
          belowUnits: ['thousands'],
          suggestedBelow: 'thousands',
        },
      },
    });
    expect(run({ turnover: 10 * CRORE }, LIBRARY, r).detail.rounding?.permittedUnits).toEqual([
      'thousands',
    ]);
  });

  it('a pre-2021 version measures turnover', () => {
    const r = makeResolver({
      [`${AREA}|${RULE_CRITERION.turnover}|`]: {
        ...ROUNDING_V2,
        effectiveFrom: '2014-04-01',
        condition: { ...ROUNDING_V2.condition, measure: 'turnover', measureLabel: 'Turnover' },
      },
    });
    expect(run({ turnover: 10 * CRORE }, LIBRARY, r).detail.rounding?.sourceLabel).toBe(
      'Turnover (02.1)',
    );
  });

  it('a selected unit other than the system unit is an override', () => {
    const res = assessScheduleIii(facts({ turnover: 80 * CRORE }), resolve, LIBRARY, {
      roundingUnit: 'thousands',
      roundingReason: 'Group policy',
    });
    expect(res.detail.rounding?.overridden).toBe(true);
    expect(res.detail.rounding?.reason).toBe('Group policy');
  });

  it('a missing rule leaves rounding pending but still concludes the Division', () => {
    const res = run(
      { turnover: 80 * CRORE },
      LIBRARY,
      makeResolver({ [`${AREA}|${RULE_CRITERION.turnover}|`]: undefined as never }),
    );
    expect(res.outcome).toBe(SCHEDULE_III_OUTCOME.divisionI);
    expect(res.detail.rounding?.permittedUnits).toEqual([]);
  });
});

describe('assessScheduleIii — presentation materiality (spec §15)', () => {
  it('1% of revenue or the floor, whichever is higher — and never SA 320', () => {
    const pm = run({ turnover: 80 * CRORE }).detail.presentationMateriality!;
    expect(pm.amount).toBe(0.8 * CRORE);
    expect(pm.ruleCode).toBe('SCH_III_PRES_MAT_DIV_I');
    expect(pm.auditMaterialityNote).toMatch(/Section 03/);
    const small = run({
      reportingFramework: REPORTING_FRAMEWORK_OUTCOME.indAs,
      turnover: 5 * CRORE,
    }).detail.presentationMateriality!;
    expect(small.amount).toBe(1_000_000);
  });
});

describe('assessScheduleIii — disclosure library (spec §11, §12, test 9)', () => {
  it('loads the version requirements; triggers activate; unknown never suppresses', () => {
    const lib = run({
      triggers: { immovable_property_exists: true, borrowings_exist: false },
    }).detail.disclosureLibrary!;
    const by = Object.fromEntries(lib.map((d) => [d.code, d.applicability]));
    expect(by.SCH3_I_ARI_BENAMI).toBe('baseline');
    expect(by.SCH3_I_ARI_TITLE_DEEDS).toBe('triggered');
    expect(by.SCH3_I_ARI_CHARGES).toBe('not_triggered');
    expect(by.SCH3_I_ARI_CSR).toBe('included_pending_fact');
  });

  it('first-time Ind AS triggers the transition disclosure', () => {
    const lib = run({
      reportingFramework: REPORTING_FRAMEWORK_OUTCOME.indAs,
      triggers: { first_time_ind_as: true },
    }).detail.disclosureLibrary!;
    expect(lib.find((d) => d.code === 'SCH3_II_INDAS_101')?.applicability).toBe('triggered');
  });

  it('CFS required flags consolidated presentation for 02.6', () => {
    expect(run({ triggers: { cfs_required: true } }).detail.cfsPresentationRequired).toBe(true);
  });
});

describe('assessScheduleIii — comparatives (spec §13)', () => {
  it('required for an existing company, with the prior period', () => {
    const c = run({ incorporationDate: '2010-05-01' }).detail.comparatives!;
    expect(c.status).toBe('required');
    expect(c.priorPeriod).toBe('2024-25');
  });
  it('first financial year → not applicable from entity history', () => {
    const c = run({ incorporationDate: '2025-06-10' }).detail.comparatives!;
    expect(c.firstFinancialYear).toBe(true);
    expect(c.status).toBe('not_applicable');
    expect(c.priorPeriod).toBeNull();
  });
  it('a confirmed status overrides the system', () => {
    const res = assessScheduleIii(facts({}), resolve, LIBRARY, {
      comparativesStatus: 'not_applicable',
      comparativesReason: 'Restructured',
    });
    expect(res.detail.comparatives?.status).toBe('not_applicable');
    expect(res.detail.comparatives?.system).toBe('required');
  });
});

describe('assessScheduleIii — traceability (spec §3, §19)', () => {
  it('lists facts used, rules applied and downstream outputs', () => {
    const d = run({ turnover: 80 * CRORE }).detail;
    expect(d.factsUsed?.map((f) => f.key)).toEqual(
      expect.arrayContaining(['reporting_framework', 'turnover', 'small_company']),
    );
    expect(d.rulesApplied?.map((r) => r.ruleCode)).toEqual([
      'SCH_III_ROUNDING',
      'SCH_III_PRES_MAT_DIV_I',
    ]);
    expect(d.downstream?.map((o) => o.key)).toEqual(
      expect.arrayContaining([
        'division',
        'components',
        'cash_flow',
        'disclosures',
        'rounding',
        'template',
        'cfs',
      ]),
    );
  });
});
