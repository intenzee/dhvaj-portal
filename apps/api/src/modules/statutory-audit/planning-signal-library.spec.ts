import {
  canonicalJson,
  conditionFacts,
  conditionProblem,
  deriveChangeSignal,
  deriveEngagementSignals,
  effectiveRules,
  evaluateCondition,
  factsFingerprint,
  isUsableRule,
  renderTemplate,
  type PlanningFacts,
  type PlanningSignalRule,
  type RuleCondition,
} from './planning-signal-library';

const rule = (over: Partial<PlanningSignalRule> = {}): PlanningSignalRule => ({
  ruleCode: 'PSR-001',
  version: 1,
  ruleKey: 'initial_audit',
  name: 'Initial audit',
  triggerSource: 'section_02',
  triggerSection: '02.1',
  condition: {
    any: [
      { fact: 'initial_audit', op: 'truthy' },
      { fact: 'sa510', op: 'truthy' },
    ],
  },
  conditionVersion: 1,
  observationTemplate: 'This is the first statutory audit of the entity by the firm.',
  whyMayMatter: 'Opening balances (SA 510).',
  potentialImplications: 'Opening balances.',
  guidanceAnchors: ['sa_510'],
  destinations: ['03.4', 'section_04'],
  suggestedAttention: 'enhanced',
  sourceLink: 'framework:02.1',
  effectiveFrom: '2000-01-01',
  effectiveTo: null,
  active: true,
  ...over,
});

/** The library shape the seed migration installs, reduced to what the tests read. */
const LIBRARY: PlanningSignalRule[] = [
  rule(),
  rule({
    ruleCode: 'PSR-002',
    ruleKey: 'specialist_required',
    triggerSource: 'section_01',
    triggerSection: '01.4',
    condition: { fact: 'specialists', op: 'truthy' },
    observationTemplate:
      'Acceptance identified that the engagement needs specialist input: {{specialists}}.',
    destinations: ['03.8', '03.4'],
    sourceLink: 'acceptance:question-acc_04',
  }),
  rule({
    ruleCode: 'PSR-003',
    ruleKey: 'service_organisation',
    condition: {
      any: [
        { fact: 'sa402', op: 'truthy' },
        {
          fact: 'accounting_environment',
          op: 'in',
          value: ['outsourced_service_organisation', 'hybrid'],
        },
      ],
    },
    observationTemplate:
      'A financially relevant process is handled by a service organisation[[ ({{service_org_provider}})]].',
    suggestedAttention: 'standard',
  }),
  rule({
    ruleCode: 'PSR-005',
    ruleKey: 'caro_applicable',
    triggerSection: '02.4',
    condition: { fact: 'caro', op: 'eq', value: 'applicable' },
    observationTemplate: 'CARO 2020 is applicable to this engagement.',
    suggestedAttention: 'standard',
  }),
  rule({
    ruleCode: 'PSR-007',
    ruleKey: 'cfs_required',
    triggerSection: '02.6',
    condition: { fact: 'cfs', op: 'eq', value: 'cfs_required' },
    observationTemplate: 'Consolidated financial statements are required.',
  }),
  rule({
    ruleCode: 'PSR-014',
    ruleKey: 'other_auditor_components',
    triggerSection: '02.6',
    condition: { fact: 'other_auditor_components', op: 'gt', value: 0 },
    observationTemplate:
      '{{other_auditor_components}} component(s) are audited by other auditors: {{other_auditor_component_names}}.',
    guidanceAnchors: ['sa_600'],
    destinations: ['03.9', '03.4', '03.11'],
  }),
  rule({
    ruleCode: 'PSR-019',
    ruleKey: 'integrity_concern',
    triggerSource: 'section_01',
    triggerSection: '01.4',
    condition: { fact: 'integrity_concern', op: 'truthy' },
    observationTemplate:
      'Acceptance recorded a concern over the integrity of management or TCWG[[: {{integrity_detail}}]].',
    suggestedAttention: 'immediate_partner',
  }),
  rule({
    ruleCode: 'PSR-026',
    ruleKey: 'erp_environment',
    condition: {
      all: [
        { fact: 'records_electronic', op: 'truthy' },
        { fact: 'erp_system', op: 'truthy' },
      ],
    },
    observationTemplate:
      'Books of account are maintained electronically on an ERP ({{accounting_software}}).',
    suggestedAttention: 'standard',
  }),
  rule({
    ruleCode: 'PSR-116',
    ruleKey: 'change_fraud',
    triggerSource: 'current_year_change',
    triggerSection: '03.1',
    condition: { fact: 'change_category', op: 'eq', value: 'fraud' },
    observationTemplate: 'Current-year change — {{change_label}}[[: {{change_description}}]].',
    guidanceAnchors: ['sa_240'],
    destinations: ['03.6', '03.8'],
    suggestedAttention: 'immediate_partner',
  }),
  rule({
    ruleCode: 'PSR-118',
    ruleKey: 'change_other',
    triggerSource: 'current_year_change',
    triggerSection: '03.1',
    condition: { fact: 'change_category', op: 'eq', value: 'other' },
    observationTemplate: 'Current-year change — {{change_label}}[[: {{change_description}}]].',
    suggestedAttention: 'standard',
  }),
];

const ON = '2025-03-31';
const keys = (facts: PlanningFacts) =>
  deriveEngagementSignals(LIBRARY, facts, ON).map((s) => s.ruleKey);

describe('evaluateCondition', () => {
  const facts: PlanningFacts = {
    yes: true,
    no: false,
    zero: 0,
    three: 3,
    blank: '  ',
    word: 'applicable',
    list: ['a', 'b'],
    empty: [],
    nil: null,
  };
  it.each<[RuleCondition, boolean]>([
    [{ fact: 'yes', op: 'truthy' }, true],
    [{ fact: 'no', op: 'truthy' }, false],
    [{ fact: 'zero', op: 'truthy' }, false],
    [{ fact: 'three', op: 'truthy' }, true],
    [{ fact: 'blank', op: 'truthy' }, false],
    [{ fact: 'list', op: 'truthy' }, true],
    [{ fact: 'empty', op: 'truthy' }, false],
    [{ fact: 'nil', op: 'truthy' }, false],
    [{ fact: 'missing', op: 'truthy' }, false],
    [{ fact: 'word', op: 'eq', value: 'applicable' }, true],
    [{ fact: 'word', op: 'eq', value: 'exempt' }, false],
    [{ fact: 'word', op: 'in', value: ['x', 'applicable'] }, true],
    [{ fact: 'list', op: 'in', value: ['b'] }, true],
    [{ fact: 'list', op: 'in', value: ['z'] }, false],
    [{ fact: 'three', op: 'gt', value: 2 }, true],
    [{ fact: 'three', op: 'gt', value: 3 }, false],
    [{ fact: 'word', op: 'gt', value: 0 }, false],
    [
      {
        all: [
          { fact: 'yes', op: 'truthy' },
          { fact: 'three', op: 'gt', value: 0 },
        ],
      },
      true,
    ],
    [
      {
        all: [
          { fact: 'yes', op: 'truthy' },
          { fact: 'no', op: 'truthy' },
        ],
      },
      false,
    ],
    [
      {
        any: [
          { fact: 'no', op: 'truthy' },
          { fact: 'yes', op: 'truthy' },
        ],
      },
      true,
    ],
    [{ not: { fact: 'no', op: 'truthy' } }, true],
  ])('%j ⇒ %s', (cond, expected) => {
    expect(evaluateCondition(cond, facts)).toBe(expected);
  });
});

describe('conditionProblem (admin validation)', () => {
  it('accepts every seeded condition shape', () => {
    for (const r of LIBRARY) expect(conditionProblem(r.condition)).toBeNull();
  });
  it.each<[unknown, RegExp]>([
    [null, /object/],
    [[], /object/],
    [{ all: [] }, /non-empty list/],
    [{ any: [{ fact: 'x', op: 'truthy' }], extra: 1 }, /non-empty list/],
    [{ not: { fact: 'x', op: 'truthy' }, x: 1 }, /one condition/],
    [{ fact: 'Bad Name', op: 'truthy' }, /lower_snake_case/],
    [{ fact: 'x', op: 'like' }, /one of/],
    [{ fact: 'x', op: 'truthy', value: 1 }, /no value/],
    [{ fact: 'x', op: 'eq', value: { a: 1 } }, /string, number or boolean/],
    [{ fact: 'x', op: 'in', value: [] }, /non-empty list of strings/],
    [{ fact: 'x', op: 'gt', value: 'one' }, /number/],
  ])('rejects %j', (cond, msg) => {
    expect(conditionProblem(cond)).toMatch(msg);
  });
  it('rejects runaway nesting', () => {
    let c: unknown = { fact: 'x', op: 'truthy' };
    for (let i = 0; i < 10; i++) c = { not: c };
    expect(conditionProblem(c)).toMatch(/deeply/);
  });
  it('lists the facts a condition reads', () => {
    expect(conditionFacts(LIBRARY[2]!.condition)).toEqual(['sa402', 'accounting_environment']);
  });
});

describe('renderTemplate', () => {
  it('fills placeholders and joins lists', () => {
    expect(renderTemplate('Needs: {{s}}.', { s: ['IT', 'Valuation'] })).toBe(
      'Needs: IT, Valuation.',
    );
  });
  it('drops an optional segment whose placeholder is empty — never "()"', () => {
    const t = 'Handled by a service organisation[[ ({{p}})]].';
    expect(renderTemplate(t, { p: 'Acme Payroll' })).toBe(
      'Handled by a service organisation (Acme Payroll).',
    );
    expect(renderTemplate(t, { p: null })).toBe('Handled by a service organisation.');
    expect(renderTemplate(t, {})).toBe('Handled by a service organisation.');
  });
  it('tidies spacing left by an empty mandatory placeholder', () => {
    expect(renderTemplate('Changes in: {{x}} .', { x: [] })).toBe('Changes in:.');
  });
});

describe('effectiveRules (versions + periods)', () => {
  it('the highest in-window active version wins', () => {
    const v2 = rule({ version: 2, observationTemplate: 'v2' });
    expect(effectiveRules([rule(), v2], ON).map((r) => r.version)).toEqual([2]);
  });
  it('a version effective after the period end is not used for this period', () => {
    const v2 = rule({ version: 2, effectiveFrom: '2026-04-01' });
    expect(effectiveRules([rule(), v2], ON)[0]!.version).toBe(1);
    expect(effectiveRules([rule(), v2], '2026-06-30')[0]!.version).toBe(2);
  });
  it('an expired version falls away', () => {
    expect(effectiveRules([rule({ effectiveTo: '2024-03-31' })], ON)).toEqual([]);
  });
  it('a retired (inactive) latest version switches the rule off', () => {
    expect(effectiveRules([rule(), rule({ version: 2, active: false })], ON)).toEqual([]);
  });
});

describe('deriveEngagementSignals (03.1 Engagement Intelligence)', () => {
  it('a plain continuing, in-house engagement with nothing triggered produces no signal', () => {
    expect(keys({ accounting_environment: 'in_house', caro: 'not_applicable_exempt' })).toEqual([]);
  });

  it('initial audit ⇒ Enhanced signal carrying rule code, version, guidance and source link', () => {
    const [s] = deriveEngagementSignals(LIBRARY, { initial_audit: true }, ON);
    expect(s).toEqual(
      expect.objectContaining({
        ruleKey: 'initial_audit',
        ruleCode: 'PSR-001',
        ruleVersion: 1,
        source: 'section_02',
        sourceSection: '02.1',
        suggestedAttention: 'enhanced',
        guidanceAnchors: ['sa_510'],
        sourceLink: 'framework:02.1',
      }),
    );
  });

  it('the SA 510 flag alone also triggers the initial-audit rule (one signal)', () => {
    expect(keys({ sa510: true })).toEqual(['initial_audit']);
  });

  it('names the specialists and the service-organisation provider in the observation', () => {
    const out = deriveEngagementSignals(
      LIBRARY,
      {
        specialists: ['IT', 'Valuation'],
        accounting_environment: 'hybrid',
        service_org_provider: 'Acme',
      },
      ON,
    );
    expect(out.map((s) => s.observation)).toEqual([
      'Acceptance identified that the engagement needs specialist input: IT, Valuation.',
      'A financially relevant process is handled by a service organisation (Acme).',
    ]);
  });

  it('only APPLICABLE outcomes fire (CARO exempt / CFS exempt stay silent)', () => {
    expect(keys({ caro: 'not_applicable_exempt', cfs: 'cfs_exempt' })).toEqual([]);
    expect(keys({ caro: 'applicable', cfs: 'cfs_required' })).toEqual([
      'caro_applicable',
      'cfs_required',
    ]);
  });

  it('other-auditor components are counted and named', () => {
    const [s] = deriveEngagementSignals(
      LIBRARY,
      { other_auditor_components: 2, other_auditor_component_names: ['Sub A (X & Co)', 'Sub B'] },
      ON,
    );
    expect(s!.observation).toBe(
      '2 component(s) are audited by other auditors: Sub A (X & Co), Sub B.',
    );
    expect(s!.destinations).toEqual(['03.9', '03.4', '03.11']);
  });

  it('an acceptance integrity concern goes straight to Immediate Partner Attention', () => {
    const [s] = deriveEngagementSignals(
      LIBRARY,
      { integrity_concern: true, integrity_detail: 'Promoter under investigation' },
      ON,
    );
    expect(s!.suggestedAttention).toBe('immediate_partner');
    expect(s!.observation).toMatch(/: Promoter under investigation\.$/);
  });

  it('"all" needs every part: electronic records alone do not raise the ERP signal', () => {
    expect(keys({ records_electronic: true })).toEqual([]);
    expect(keys({ records_electronic: true, erp_system: true })).toEqual(['erp_environment']);
  });

  it('change rules never fire from Section 01/02 facts', () => {
    expect(keys({ change_category: 'fraud' })).toEqual([]);
  });

  it('rule keys are unique so the upsert-by-rule generator stays idempotent', () => {
    const all = LIBRARY.map((r) => r.ruleKey);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('deriveChangeSignal (PI-01 → category-specific signal)', () => {
  it('fraud ⇒ Immediate Partner Attention with SA 240 guidance and the description', () => {
    const s = deriveChangeSignal(
      LIBRARY,
      {
        category: 'fraud',
        label: 'Fraud / Suspected Fraud',
        description: 'Whistle-blower complaint',
      },
      ON,
    );
    expect(s).toEqual(
      expect.objectContaining({
        ruleCode: 'PSR-116',
        source: 'current_year_change',
        observation: 'Current-year change — Fraud / Suspected Fraud: Whistle-blower complaint.',
        suggestedAttention: 'immediate_partner',
        guidanceAnchors: ['sa_240'],
        destinations: ['03.6', '03.8'],
      }),
    );
  });
  it('a description that ends its own sentence ⇒ one full stop', () => {
    const at = (description: string) =>
      deriveChangeSignal(LIBRARY, { category: 'other', label: 'Other', description }, ON)!
        .observation;
    expect(at('Opening balances converted.')).toBe(
      'Current-year change — Other: Opening balances converted.',
    );
    expect(at('Was the ERP changed?')).toBe('Current-year change — Other: Was the ERP changed?');
    expect(at('Migration pending...')).toBe('Current-year change — Other: Migration pending...');
  });
  it('no description ⇒ just the category', () => {
    expect(
      deriveChangeSignal(LIBRARY, { category: 'other', label: 'Other', description: null }, ON)!
        .observation,
    ).toBe('Current-year change — Other.');
  });
  it('a category with no rule in force ⇒ null (caller falls back)', () => {
    expect(
      deriveChangeSignal(
        LIBRARY,
        { category: 'litigation', label: 'Litigation', description: null },
        ON,
      ),
    ).toBeNull();
  });
});

describe('factsFingerprint / isUsableRule', () => {
  it('is order-independent and changes when a fact changes', () => {
    expect(factsFingerprint({ a: 1, b: true })).toBe(factsFingerprint({ b: true, a: 1 }));
    expect(factsFingerprint({ a: 1 })).not.toBe(factsFingerprint({ a: 2 }));
  });
  it('rejects a rule with an unknown destination or attention', () => {
    expect(isUsableRule(rule())).toBe(true);
    expect(isUsableRule(rule({ destinations: ['09.9' as never] }))).toBe(false);
    expect(isUsableRule(rule({ suggestedAttention: 'high' as never }))).toBe(false);
  });
});

describe('canonicalJson', () => {
  it('ignores key order at every depth (jsonb reorders keys)', () => {
    expect(canonicalJson({ op: 'eq', fact: 'caro', value: 'applicable' })).toBe(
      canonicalJson({ fact: 'caro', value: 'applicable', op: 'eq' }),
    );
    expect(canonicalJson({ all: [{ op: 'truthy', fact: 'a' }] })).toBe(
      '{"all":[{"fact":"a","op":"truthy"}]}',
    );
    expect(canonicalJson({ fact: 'a', op: 'truthy' })).not.toBe(
      canonicalJson({ fact: 'b', op: 'truthy' }),
    );
  });
});
