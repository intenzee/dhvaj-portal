import {
  deriveStrategicConsiderations,
  type ConsiderationSignalFact,
} from './planning-considerations-generation';

const sig = (over: Partial<ConsiderationSignalFact>): ConsiderationSignalFact => ({
  id: over.id ?? 'sig',
  ruleKey: null,
  changeCategory: null,
  attention: 'standard',
  status: 'open',
  ...over,
});

const keys = (signals: ConsiderationSignalFact[]) =>
  deriveStrategicConsiderations(signals).map((c) => c.key);

describe('deriveStrategicConsiderations (03.1 §13.2–13.3)', () => {
  it('derives nothing from an empty register', () => {
    expect(deriveStrategicConsiderations([])).toEqual([]);
  });

  it('ICFR prompts interim control testing (timing) and IT expertise (resource)', () => {
    const out = deriveStrategicConsiderations([sig({ id: 'icfr', ruleKey: 'icfr_applicable' })]);
    expect(out.map((c) => [c.key, c.kind, c.signalId])).toEqual([
      ['interim_control_testing', 'timing', 'icfr'],
      ['it_expertise', 'resource', 'icfr'],
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
    const out = deriveStrategicConsiderations([
      sig({ id: 'fraud', changeCategory: 'fraud', attention: 'immediate_partner' }),
    ]);
    expect(out.map((c) => c.key)).toEqual(['forensic_expertise', 'enhanced_partner_involvement']);
    expect(out.every((c) => c.signalId === 'fraud')).toBe(true);
  });

  it('ignores closed signals', () => {
    expect(keys([sig({ ruleKey: 'initial_audit', status: 'closed' })])).toEqual([]);
  });

  it('links each consideration to the first matching signal only', () => {
    const out = deriveStrategicConsiderations([
      sig({ id: 'svc', ruleKey: 'service_organisation' }),
      sig({ id: 'icfr', ruleKey: 'icfr_applicable' }),
    ]);
    expect(out.filter((c) => c.key === 'it_expertise')).toEqual([
      expect.objectContaining({ signalId: 'svc' }),
    ]);
  });

  it('never proposes dates or named staff (labels are strategic only)', () => {
    const out = deriveStrategicConsiderations([
      sig({ ruleKey: 'initial_audit' }),
      sig({ ruleKey: 'joint_audit' }),
      sig({ changeCategory: 'going_concern', attention: 'immediate_partner' }),
    ]);
    for (const c of out) expect(c.label).not.toMatch(/\d{1,2}[-/ ]\w{3}|\d{4}-\d{2}/);
  });
});
