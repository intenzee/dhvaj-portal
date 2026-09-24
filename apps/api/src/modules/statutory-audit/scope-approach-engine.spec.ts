import type { ScopeApproachRecord, ScopeDecision, ScopeMapItem, ScopeUnit } from '@hsdg/contracts';
import {
  composeScopeConclusion,
  consistencyChecks,
  decisionPrompt,
  deriveTriggers,
  generateImplications,
  generateMapAreas,
  generatePopulation,
  generateSpecialists,
  materialityContext,
  partnerAttention,
  scopeCompletion,
  suggestedConfirmationAreas,
  type ScopeFacts,
  type ScopeState,
} from './scope-approach-engine';

const facts = (over: Partial<ScopeFacts> = {}): ScopeFacts => ({
  entityName: 'Acme Ltd',
  initialAudit: false,
  jointAudit: false,
  accountingEnvironment: 'in_house',
  sa402: false,
  frameworkConclusions: {},
  investees: [],
  hasBranches: false,
  metrics: {},
  unitFactor: 100,
  overallMateriality: 1000,
  performanceMateriality: 600,
  specific: [],
  signals: [],
  focusNames: [],
  changeCategories: [],
  erpChange: false,
  cycles: [],
  otherSystems: [],
  customerTypes: [],
  serviceOrgContext: null,
  revenueAnalyticsFlag: false,
  ...over,
});

const record = (over: Partial<ScopeApproachRecord> = {}): ScopeApproachRecord => ({
  id: 'r1',
  versionNo: 1,
  versionLabel: 'v1.0',
  status: 'draft',
  methodologyVersion: null,
  sc01: null,
  sc01Other: null,
  sc02: null,
  sc02Note: null,
  ap01: null,
  ap01Rationale: null,
  icfrNote: null,
  ec01: null,
  ec01Areas: [],
  ec01Note: null,
  inventoryDecision: null,
  inventoryLocations: null,
  inventoryNote: null,
  physicalOther: null,
  physicalOtherNote: null,
  obInputs: {},
  ob01: null,
  ob01Note: null,
  ia01: null,
  ia01Note: null,
  jointAuditNote: null,
  dt01: null,
  dt01Note: null,
  sl01: null,
  materialityVersionNo: null,
  reassessmentReason: null,
  reassessmentSource: null,
  revisionTrigger: null,
  revisionReason: null,
  conclusionSummary: null,
  ap02: null,
  completedByName: null,
  completedAt: null,
  version: 1,
  ...over,
});

const unit = (over: Partial<ScopeUnit> = {}): ScopeUnit => ({
  id: 'u1',
  code: 'SU-001',
  unitKey: 'entity',
  isAuto: true,
  sourceLabel: null,
  name: 'Acme',
  unitType: 'entity',
  location: null,
  finMetric: null,
  finAmount: null,
  finSource: null,
  finNotAvailable: false,
  materialityContext: null,
  relevance: [],
  relevanceOther: null,
  qualitativeNote: null,
  signalIds: [],
  focusIds: [],
  specificMateriality: false,
  auditor: 'dhvaj',
  auditorStrategy: null,
  scopeConclusion: null,
  rationale: null,
  noLongerGenerated: false,
  version: 1,
  ...over,
});

const mapItem = (over: Partial<ScopeMapItem> = {}): ScopeMapItem => ({
  id: 'm1',
  code: 'AM-001',
  areaKey: 'revenue',
  isAuto: true,
  sourceLabel: null,
  name: 'Revenue',
  metricKey: 'revenue',
  amount: null,
  manualAmount: null,
  materialityContext: null,
  materialityNote: null,
  specificMateriality: [],
  signalIds: [],
  focusIds: [],
  controlsStrategy: null,
  timing: null,
  evidenceChannels: [],
  specialConsiderations: [],
  suggestedSpecial: [],
  note: null,
  included: true,
  exclusionReason: null,
  reassessmentRequired: false,
  reassessmentReason: null,
  version: 1,
  ...over,
});

const state = (over: Partial<ScopeState> = {}): ScopeState => ({
  record: record(),
  triggers: deriveTriggers(facts(), []),
  units: [],
  decisions: [],
  serviceOrgs: [],
  considerations: [],
  dependencies: [],
  limitations: [],
  mapItems: [],
  partnerActions: [],
  ...over,
});

describe('03.4 scope & approach engine', () => {
  it('generates the population from known facts without excluding anything', () => {
    const f = facts({
      frameworkConclusions: { cfs: 'applicable' },
      investees: [
        { name: 'Sub One Pvt Ltd', relationship: 'subsidiary', auditedByOtherAuditor: true },
      ],
      hasBranches: true,
      accountingEnvironment: 'hybrid',
      metrics: { revenue: { cy: 5, py: 4 } },
    });
    const units = generatePopulation(f);
    expect(units.map((u) => u.unitKey)).toEqual([
      'entity',
      'investee:sub_one_pvt_ltd',
      'branches',
      'service_org:accounting',
    ]);
    expect(units[0]!.finAmount).toBe(500);
    expect(units[1]!.auditor).toBe('component_auditor');
    expect(units.every((u) => !('scopeConclusion' in u))).toBe(true);
  });

  it('shows materiality as context — a unit below OM is never excluded on that basis', () => {
    expect(materialityContext(2500, 1000)).toBe('2.5× OM');
    expect(materialityContext(200, 1000)).toContain('not excluded');
    expect(materialityContext(null, 1000)).toBeNull();
  });

  it('derives triggers: service organisation, CFS, inventory relevance', () => {
    const t = deriveTriggers(
      facts({
        sa402: true,
        frameworkConclusions: {
          cfs: 'applicable',
          ifc: 'applicable',
          internal_audit: 'applicable',
        },
        investees: [{ name: 'A', relationship: null, auditedByOtherAuditor: false }],
        metrics: { inventory: { cy: 7, py: 5 } },
      }),
      [],
    );
    expect(t.serviceOrganisation).toBe(true);
    expect(t.cfsApplicable).toBe(true);
    expect(t.suggestedFsCovered).toBe('both');
    expect(t.icfrApplicable).toBe(true);
    expect(t.inventoryRelevant).toBe(true);
    expect(t.inventoryReason).toContain('performance materiality');
  });

  it('suggests map areas from 03.2 metrics plus CFS / initial-audit areas', () => {
    const f = facts({
      initialAudit: true,
      metrics: { revenue: { cy: 1, py: 1 }, inventory: { cy: 1, py: null } },
    });
    const areas = generateMapAreas(f, deriveTriggers(f, []));
    expect(areas.map((a) => a.areaKey)).toEqual([
      'revenue',
      'inventory',
      'financial_close',
      'opening_balances',
    ]);
    expect(areas.find((a) => a.areaKey === 'inventory')!.suggestedSpecial).toContain(
      'physical_attendance',
    );
  });

  it('proposes special implications from facts and 03.4-destined signals; specialists from 03.8', () => {
    const f = facts({
      initialAudit: true,
      changeCategories: ['litigation'],
      signals: [
        {
          id: 's1',
          code: 'PS-001',
          observation: 'Valuation of unlisted investments',
          potentialImplications: null,
          ruleKey: null,
          attention: 'enhanced',
          destinations: ['03.8'],
        },
        {
          id: 's2',
          code: 'PS-002',
          observation: 'New warehouse',
          potentialImplications: 'Attendance',
          ruleKey: null,
          attention: 'standard',
          destinations: ['03.4'],
        },
      ],
    });
    const imp = generateImplications(f, deriveTriggers(f, []), 2);
    expect(imp.map((i) => i.key)).toEqual(
      expect.arrayContaining([
        'fact:initial_audit',
        'fact:litigation',
        'fact:multiple_warehouses',
        'signal:s2',
      ]),
    );
    const sp = generateSpecialists(f);
    expect(sp).toHaveLength(1);
    expect(sp[0]!.attention).toBe('enhanced');
  });

  it('prompts roll-forward when reliance is contemplated with interim controls work', () => {
    const d = (kind: ScopeDecision['kind'], itemKey: string, status: string | null) => ({
      kind,
      itemKey,
      status,
    });
    const all = [
      d('controls_cycle', 'revenue', 'reliance_contemplated'),
      d('timing', 'controls', 'interim'),
    ];
    expect(decisionPrompt(all[1]!, all)).toContain('roll-forward');
    expect(decisionPrompt(d('timing', 'controls', 'year_end'), all)).toBeNull();
  });

  it('suggests confirmation areas from known balances', () => {
    expect(
      suggestedConfirmationAreas(
        facts({ metrics: { cash_bank: { cy: 1, py: 1 }, total_borrowings: { cy: 1, py: 1 } } }),
      ),
    ).toEqual(['banks', 'loans']);
  });

  it('blocks: initial audit without OB-01; service org without SO-01; other auditor without a conclusion', () => {
    const s = state({
      triggers: deriveTriggers(facts({ initialAudit: true, sa402: true }), []),
      units: [unit({ auditor: 'component_auditor', code: 'SU-002' })],
    });
    const failing = consistencyChecks(s)
      .filter((c) => !c.met)
      .map((c) => c.key);
    expect(failing).toEqual(
      expect.arrayContaining(['opening_balances', 'service_org_sa402', 'other_auditor_conclusion']),
    );
  });

  it('inventory "information required" must be owned by a dependency', () => {
    const t = deriveTriggers(facts({ metrics: { inventory: { cy: 1, py: 1 } } }), []);
    const base = state({
      triggers: t,
      record: record({ inventoryDecision: 'information_required' }),
    });
    expect(consistencyChecks(base).find((c) => c.key === 'inventory_attendance')!.met).toBe(false);
    const owned = state({
      ...base,
      dependencies: [
        {
          id: 'd',
          code: 'SD-001',
          description: 'Inventory count date',
          affected: null,
          unitId: null,
          ownerEmployeeId: null,
          ownerName: null,
          ownerParty: 'client',
          neededBy: null,
          impact: 'information',
          status: 'open',
          resolution: null,
          partnerAttention: false,
          version: 1,
        },
      ],
    });
    expect(consistencyChecks(owned).find((c) => c.key === 'inventory_attendance')!.met).toBe(true);
  });

  it('a materiality revision flags map items for reassessment (blocking) and SL-01 yes needs a limitation', () => {
    const s = state({
      record: record({ sl01: 'yes' }),
      mapItems: [mapItem({ reassessmentRequired: true })],
    });
    const failing = consistencyChecks(s)
      .filter((c) => !c.met)
      .map((c) => c.key);
    expect(failing).toEqual(expect.arrayContaining(['map_reassessment', 'scope_limitation']));
  });

  it('limitations are always Immediate Partner Attention', () => {
    const s = state({
      limitations: [
        {
          id: 'l1',
          code: 'SL-001',
          matter: 'No access to branch records',
          affected: null,
          managementPosition: null,
          alternativeEvidence: null,
          ownerEmployeeId: null,
          ownerName: null,
          status: 'open',
          resolution: null,
          planningMatterId: 'pm',
          planningMatterCode: 'PM-001',
          version: 1,
        },
      ],
    });
    expect(partnerAttention(s).map((p) => p.key)).toContain('limitation:l1');
  });

  it('completion requires rationale for excluding a relevant unit and AP-02', () => {
    const s = state({
      units: [
        unit({ scopeConclusion: 'not_separately_scoped', relevance: ['financial_significance'] }),
      ],
    });
    const checks = scopeCompletion(s, consistencyChecks(s));
    expect(checks.find((c) => c.key === 'significance')!.met).toBe(false);
    expect(checks.find((c) => c.key === 'ap02')!.met).toBe(false);
  });

  it('composes a conclusion that never calls controls effective', () => {
    const s = state({
      record: record({ sc01: 'standalone', ap01: 'not_yet_determinable' }),
      units: [unit({ scopeConclusion: 'in_scope' })],
      decisions: [
        {
          kind: 'controls_cycle',
          itemKey: 'revenue',
          label: 'Revenue',
          isCustom: false,
          options: [],
          hint: null,
          status: 'reliance_contemplated',
          rollForward: null,
          prompt: null,
          note: null,
          version: 1,
        },
      ],
      mapItems: [mapItem()],
    });
    const text = composeScopeConclusion(s, []);
    expect(text).toContain('Not Yet Determinable');
    expect(text).toContain('planned, not concluded');
    expect(text).not.toMatch(/effective/i);
  });
});
