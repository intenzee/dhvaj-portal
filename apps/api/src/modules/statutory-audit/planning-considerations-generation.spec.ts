import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  deriveStrategicConsiderations,
  type ConsiderationSignalFact,
  type PlanningConsiderationRule,
} from './planning-considerations-generation';

/** The seeded Strategic Consideration Library, read from the migration itself. */
function seededRules(): PlanningConsiderationRule[] {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../../db/migrations/1768300000000_planning_consideration_library.sql',
    ),
    'utf8',
  );
  const arr = (lit: string) => (lit === '{}' ? [] : lit.slice(1, -1).split(','));
  const tuple =
    /\('(PCR-\d{3})', (\d+), '([a-z0-9_]+)', '(timing|resource)',\s*'([^']+)',\s*'([^']+)',\s*'(\{[^}]*\})',\s*'(\{[^}]*\})',\s*'(\{[^}]*\})'/g;
  return [...sql.matchAll(tuple)].map((m) => ({
    ruleCode: m[1]!,
    version: Number(m[2]),
    considerationKey: m[3]!,
    kind: m[4] as 'timing' | 'resource',
    label: m[5]!,
    basis: m[6]!,
    matchRuleKeys: arr(m[7]!),
    matchChangeCategories: arr(m[8]!),
    matchAttention: arr(m[9]!) as PlanningConsiderationRule['matchAttention'],
    effectiveFrom: '2000-01-01',
    effectiveTo: null,
    active: true,
  }));
}

const RULES = seededRules();
const ON = '2025-03-31';

const sig = (over: Partial<ConsiderationSignalFact>): ConsiderationSignalFact => ({
  id: over.id ?? 'sig',
  ruleKey: null,
  changeCategory: null,
  attention: 'standard',
  status: 'open',
  ...over,
});

const derive = (signals: ConsiderationSignalFact[], rules = RULES, on = ON) =>
  deriveStrategicConsiderations(rules, signals, on);
const keys = (signals: ConsiderationSignalFact[]) => derive(signals).map((c) => c.key);

describe('deriveStrategicConsiderations (03.1 §13.2–13.3)', () => {
  it('reads the 17 seeded library rules', () => {
    expect(RULES).toHaveLength(17);
    expect(RULES.filter((r) => r.kind === 'timing')).toHaveLength(8);
  });

  it('derives nothing from an empty register', () => {
    expect(derive([])).toEqual([]);
  });

  it('ICFR prompts interim control testing (timing) and IT expertise (resource)', () => {
    const out = derive([sig({ id: 'icfr', ruleKey: 'icfr_applicable' })]);
    expect(out.map((c) => [c.key, c.kind, c.signalId, c.ruleCode, c.ruleVersion])).toEqual([
      ['interim_control_testing', 'timing', 'icfr', 'PCR-002', 1],
      ['it_expertise', 'resource', 'icfr', 'PCR-009', 1],
    ]);
  });

  it('CFS prompts component dependency and group-audit experience', () => {
    expect(keys([sig({ ruleKey: 'cfs_required' })])).toEqual([
      'component_reporting_dependency',
      'group_audit_experience',
    ]);
  });

  it('current-year changes prompt specialist resources', () => {
    expect(
      keys([
        sig({ id: 'a', changeCategory: 'acquisition_disposal' }),
        sig({ id: 'b', changeCategory: 'restructuring' }),
        sig({ id: 'c', changeCategory: 'erp_accounting_system' }),
      ]),
    ).toEqual(['it_expertise', 'valuation_expertise', 'tax_expertise']);
  });

  it('an Immediate Partner Attention signal prompts enhanced Partner involvement', () => {
    const out = derive([
      sig({ id: 'fraud', changeCategory: 'fraud', attention: 'immediate_partner' }),
    ]);
    expect(out.map((c) => c.key)).toEqual(['forensic_expertise', 'enhanced_partner_involvement']);
    expect(out.every((c) => c.signalId === 'fraud')).toBe(true);
  });

  it('ignores closed signals', () => {
    expect(keys([sig({ ruleKey: 'initial_audit', status: 'closed' })])).toEqual([]);
  });

  it('links each consideration to the first matching signal only', () => {
    const out = derive([
      sig({ id: 'svc', ruleKey: 'service_organisation' }),
      sig({ id: 'icfr', ruleKey: 'icfr_applicable' }),
    ]);
    expect(out.filter((c) => c.key === 'it_expertise')).toEqual([
      expect.objectContaining({ signalId: 'svc' }),
    ]);
  });

  it('never proposes dates or named staff (labels are strategic only)', () => {
    const out = derive([
      sig({ ruleKey: 'initial_audit' }),
      sig({ ruleKey: 'joint_audit' }),
      sig({ changeCategory: 'going_concern', attention: 'immediate_partner' }),
    ]);
    for (const c of out) expect(c.label).not.toMatch(/\d{1,2}[-/ ]\w{3}|\d{4}-\d{2}/);
  });

  it('library rules from Sections 01/02 prompt their timing and resource considerations', () => {
    expect(keys([sig({ ruleKey: 'branch_auditors' })])).toEqual(['component_reporting_dependency']);
    expect(keys([sig({ ruleKey: 'first_time_ind_as' })])).toEqual([
      'transition_date_balances',
      'ind_as_transition_expertise',
    ]);
    expect(keys([sig({ ruleKey: 'listed_entity' })])).toEqual(['regulatory_reporting_deadlines']);
    expect(keys([sig({ ruleKey: 'audit_trail_reporting' })])).toEqual([
      'audit_trail_log_access',
      'it_expertise',
    ]);
    expect(keys([sig({ ruleKey: 'specialist_required' })])).toEqual(['specialist_involvement']);
    expect(keys([sig({ ruleKey: 'regulated_entity' })])).toEqual([
      'regulatory_reporting_deadlines',
      'industry_regulatory_expertise',
    ]);
  });

  describe('library versions (§21)', () => {
    const tax = RULES.find((r) => r.ruleCode === 'PCR-015')!;
    const restructuring = [sig({ changeCategory: 'restructuring' })];

    it('uses the version in force on the audit period end', () => {
      const v2 = {
        ...tax,
        version: 2,
        label: 'Tax and transfer-pricing expertise',
        effectiveFrom: '2025-04-01',
      };
      const rules = [...RULES, v2];
      expect(derive(restructuring, rules, '2025-03-31')[0]).toMatchObject({
        label: 'Tax expertise',
        ruleVersion: 1,
      });
      expect(derive(restructuring, rules, '2026-03-31')[0]).toMatchObject({
        key: 'tax_expertise',
        label: 'Tax and transfer-pricing expertise',
        ruleVersion: 2,
      });
    });

    it('a retired rule fires nothing; a widened rule fires on its new trigger', () => {
      expect(derive(restructuring, [...RULES, { ...tax, version: 2, active: false }])).toEqual([]);
      const widened = { ...tax, version: 2, matchRuleKeys: ['regulated_entity'] };
      expect(
        derive([sig({ ruleKey: 'regulated_entity' })], [...RULES, widened]).map((c) => c.key),
      ).toContain('tax_expertise');
    });

    it('two codes that share a key yield one consideration (the lower code)', () => {
      const dup = { ...tax, ruleCode: 'PCR-099', label: 'Duplicate' };
      expect(derive(restructuring, [...RULES, dup])).toEqual([
        expect.objectContaining({ ruleCode: 'PCR-015' }),
      ]);
    });
  });
});
