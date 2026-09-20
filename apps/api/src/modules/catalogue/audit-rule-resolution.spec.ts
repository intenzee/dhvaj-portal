import {
  buildResolver,
  selectRuleVersion,
  type ResolvableRuleVersion,
} from './audit-rule-resolution';

describe('selectRuleVersion (Rules Library effective-date resolution, guide §4.3)', () => {
  const v = (version: number, effectiveFrom: string, effectiveTo: string | null) => ({
    version,
    effectiveFrom,
    effectiveTo,
  });

  it('returns the version in force at the audit-period start', () => {
    const versions = [v(1, '2016-04-01', '2020-03-31'), v(2, '2020-04-01', null)];
    expect(selectRuleVersion(versions, '2019-04-01')?.version).toBe(1);
    expect(selectRuleVersion(versions, '2022-04-01')?.version).toBe(2);
  });

  it('is inclusive of effective_from and exclusive of effective_to', () => {
    const versions = [v(1, '2020-04-01', '2023-04-01')];
    expect(selectRuleVersion(versions, '2020-04-01')?.version).toBe(1); // start day covered
    expect(selectRuleVersion(versions, '2023-04-01')).toBeNull(); // superseded on the boundary
  });

  it('returns null when no version covers the period (Information Insufficient, never a guess)', () => {
    const versions = [v(1, '2020-04-01', null)];
    expect(selectRuleVersion(versions, '2018-04-01')).toBeNull();
  });

  it('historical freeze: a future version change never rewrites an earlier period', () => {
    // A new threshold added for 2025-04-01 must not affect a 2022 audit.
    const before = [v(1, '2016-04-01', null)];
    const chosenBefore = selectRuleVersion(before, '2022-04-01');
    const after = [v(1, '2016-04-01', '2025-03-31'), v(2, '2025-04-01', null)];
    const chosenAfter = selectRuleVersion(after, '2022-04-01');
    expect(chosenAfter?.version).toBe(1);
    expect(chosenAfter?.effectiveFrom).toBe(chosenBefore?.effectiveFrom);
    // ...and the future period picks up the new version.
    expect(selectRuleVersion(after, '2025-04-01')?.version).toBe(2);
  });
});

describe('buildResolver (class-aware lookup)', () => {
  const row = (over: Partial<ResolvableRuleVersion>): ResolvableRuleVersion => ({
    ruleId: 'r',
    ruleCode: 'INDAS_NETWORTH',
    areaKey: 'ind_as_as',
    entityClass: null,
    criterion: 'net_worth',
    operator: '>=',
    unit: 'inr',
    measurementBasis: 'standalone_audited_fs',
    ruleVersionId: 'rv',
    version: 1,
    effectiveFrom: '2016-04-01',
    effectiveTo: null,
    threshold: 2_500_000_000,
    thresholdHigh: null,
    outcome: 'ind_as',
    authorityProvisionId: 'prov',
    guidanceReference: null,
    bands: [],
    ...over,
  });

  it('resolves a class-agnostic rule and returns the actual threshold + provision', () => {
    const resolve = buildResolver([row({})]);
    const r = resolve('ind_as_as', 'net_worth');
    expect(r?.threshold).toBe(2_500_000_000);
    expect(r?.outcome).toBe('ind_as');
    expect(r?.authorityProvisionId).toBe('prov');
  });

  it('prefers an entity-class-specific rule over the class-agnostic fallback', () => {
    const resolve = buildResolver([
      row({ threshold: 2_500_000_000, entityClass: null }),
      row({ ruleCode: 'INDAS_NETWORTH_NBFC', threshold: 5_000_000_000, entityClass: 'nbfc' }),
    ]);
    expect(resolve('ind_as_as', 'net_worth', 'nbfc')?.threshold).toBe(5_000_000_000);
    expect(resolve('ind_as_as', 'net_worth', 'private')?.threshold).toBe(2_500_000_000); // falls back
  });

  it('returns null for a criterion the library does not hold', () => {
    const resolve = buildResolver([row({})]);
    expect(resolve('ind_as_as', 'turnover')).toBeNull();
  });
});
