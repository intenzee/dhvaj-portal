import {
  AREA_INDICATOR_LABEL,
  ASSERTION_IDS,
  AREA_VALIDATION_LABEL,
  FINANCIAL_UNIT_FACTOR,
  FINANCIAL_UNIT_LABEL,
  REMOVAL_REASON_NEEDS_TEXT,
  type AreaAmountSource,
  type AreaAttention,
  type AreaCategory,
  type AreaCompletenessSummary,
  type AreaConditionKey,
  type AreaDisplayAttention,
  type AreaImpact,
  type AreaIndicator,
  type AreaLibraryProfile,
  type AreaMatrixRow,
  type AreaReviewTiles,
  type AreaSectionStatus,
  type AreaSignalRef,
  type AreaSpecificMatter,
  type AreaType,
  type AreaValidation,
  type AreaValidationId,
  type AreaWarning,
  type AssertionGroup,
  type AssertionId,
  type EngagementAuditArea,
  type FinancialUnit,
  type PlanningAttention,
  type StoredAreaReviewStatus,
} from '@hsdg/contracts';

/**
 * 03.5 Audit Areas & Assertions engine (pure). Library selection, indicators,
 * removal warnings, attention suggestions, VAL-01…VAL-10, the matrix and the
 * §25 impact rules. It never removes an area, never changes a Manager decision
 * and never produces a risk rating.
 */

// ── Library ─────────────────────────────────────────────────────────────────

export interface AttentionRule {
  scenario: string;
  tags: string[];
  assertions: AssertionId[];
}

export interface LibraryRow {
  id: string;
  libraryVersion: string;
  areaCode: string;
  areaName: string;
  areaType: AreaType;
  category: AreaCategory;
  frameworkProfile: 'both' | 'as' | 'ind_as';
  industryProfile: string;
  conditionKey: AreaConditionKey | null;
  defaultAssertions: AssertionId[];
  nonAssertionWorkstream: boolean;
  defaultAttention: AreaAttention;
  relatedAuthorities: string[];
  signalMappingTags: string[];
  metricKeys: string[];
  indicatorTags: string[];
  assertionAttentionRules: AttentionRule[];
  aliases: string[];
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  sortOrder: number;
}

/**
 * §4 — the areas of the library applicable to this engagement profile. Library
 * selection decides the population shown, never final applicability.
 */
export function applicableLibrary(
  rows: LibraryRow[],
  profile: AreaLibraryProfile,
  asOf: string | null,
): LibraryRow[] {
  const day = asOf ?? new Date().toISOString().slice(0, 10);
  return rows
    .filter((r) => r.active)
    .filter((r) => r.effectiveFrom <= day && (!r.effectiveTo || r.effectiveTo >= day))
    .filter(
      (r) =>
        r.frameworkProfile === 'both' ||
        (profile.frf !== 'unknown' && r.frameworkProfile === profile.frf),
    )
    .filter(
      (r) => r.industryProfile === 'general_corporate' || r.industryProfile === profile.industry,
    )
    .filter(
      (r) =>
        !r.conditionKey ||
        (r.conditionKey === 'cfs_applicable' && profile.cfsApplicable) ||
        (r.conditionKey === 'initial_audit' && profile.initialAudit),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

// ── Facts ───────────────────────────────────────────────────────────────────

export interface AreaSignalFact {
  id: string;
  code: string;
  observation: string;
  potentialImplications: string | null;
  ruleKey: string | null;
  attention: PlanningAttention;
  status: string;
}

export interface SpecificFact {
  key: string;
  label: string;
  scopeType: string;
  amount: number | null;
  affectedAreas: string[];
}

export interface AreaFacts {
  profile: AreaLibraryProfile;
  caroApplicable: boolean;
  /** 03.2 dataset, in dataset units. */
  metrics: Record<string, { cy: number | null; py: number | null }>;
  datasetUnit: FinancialUnit | null;
  currency: string | null;
  /** Overall materiality in rupees (latest completed 03.3). */
  om: number | null;
  specific: SpecificFact[];
  signals: AreaSignalFact[];
}

export const specificKeyOf = (scope: string): string =>
  scope.trim().toLowerCase().replace(/\s+/g, ' ');

/** Unresolved Enhanced / Immediate signals — the VAL-05 population. */
export const requiresMapping = (s: AreaSignalFact): boolean =>
  s.attention !== 'standard' && s.status !== 'closed';

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A tag matches a signal's rule key or its text (word-prefix match). */
export function tagMatches(
  tag: string,
  s: Pick<AreaSignalFact, 'ruleKey' | 'observation' | 'potentialImplications'>,
): boolean {
  const t = tag.toLowerCase();
  const key = (s.ruleKey ?? '').toLowerCase();
  if (t.includes('_')) return key.includes(t);
  const hay =
    `${key.replace(/_/g, ' ')} ${s.observation} ${s.potentialImplications ?? ''}`.toLowerCase();
  return new RegExp(`(^|[^a-z0-9])${esc(t)}`).test(hay);
}

/** §18 — signals suggested for a library area via its mapping tags. */
export function suggestSignals(
  lib: Pick<LibraryRow, 'signalMappingTags'>,
  signals: AreaSignalFact[],
): string[] {
  return signals
    .filter((s) => lib.signalMappingTags.some((t) => tagMatches(t, s)))
    .map((s) => s.id);
}

const norm = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** VAL-04 — suggest the area(s) a specific-materiality matter belongs to. */
export function specificMatchesArea(
  sp: SpecificFact,
  area: { areaName: string; areaCode: string | null; aliases: string[] },
): boolean {
  const names = [area.areaName, ...area.aliases].map(norm).filter((x) => x.length >= 3);
  const texts = [sp.label, ...sp.affectedAreas].map(norm);
  return texts.some(
    (t) =>
      (area.areaCode && t === area.areaCode.toLowerCase()) ||
      names.some((n) => t === n || ` ${t} `.includes(` ${n} `) || ` ${n} `.includes(` ${t} `)),
  );
}

/** §17 — assertions a linked signal suggests for Enhanced Attention. */
export function assertionSuggestions(
  rules: AttentionRule[],
  linked: AreaSignalFact[],
): Map<AssertionId, string> {
  const out = new Map<AssertionId, string>();
  for (const r of rules) {
    const hit = linked.filter((s) => r.tags.some((t) => tagMatches(t, s)));
    if (!hit.length) continue;
    for (const a of r.assertions) {
      if (!out.has(a)) out.set(a, `${r.scenario} (${hit.map((h) => h.code).join(', ')})`);
    }
  }
  return out;
}

// ── Stored area → derived area ─────────────────────────────────────────────

export interface StoredAssertion {
  id: string;
  assertionId: AssertionId;
  origin: 'suggested' | 'user_added';
  active: boolean;
  removalReason: string | null;
  attention: AreaAttention;
  suggestedAttention: AreaAttention | null;
  suggestionBasis: string | null;
  attentionReason: string | null;
  version: number;
}

export interface StoredArea {
  id: string;
  seq: number;
  source: 'library' | 'custom';
  origin: EngagementAuditArea['origin'];
  sourceAuditAreaId: string | null;
  areaCode: string | null;
  libraryVersion: string | null;
  areaName: string;
  areaType: AreaType;
  additionReason: string | null;
  disposition: 'retained' | 'removed';
  attention: AreaAttention;
  attentionSource: 'default' | 'portal' | 'manager';
  attentionReason: string | null;
  removalReasonCode: EngagementAuditArea['removalReasonCode'];
  removalReasonText: string | null;
  coveredUnderAreaId: string | null;
  removedAt: string | null;
  removedByName: string | null;
  manualCy: number | null;
  manualPy: number | null;
  manualCurrency: string | null;
  manualUnit: FinancialUnit | null;
  amountSource: 'manual' | 'other' | null;
  amountNote: string | null;
  planningOwnerEmployeeId: string | null;
  planningOwnerName: string | null;
  reviewFlag: string | null;
  reviewFlagSource: string | null;
  inconsistencyResolution: string | null;
  version: number;
  assertions: StoredAssertion[];
  signalLinks: { signalId: string; origin: 'auto' | 'manual'; active: boolean }[];
  specificLinks: { specificKey: string; origin: 'auto' | 'manual'; active: boolean }[];
}

export const isConsolidation = (a: {
  areaCode: string | null;
  conditionKey: AreaConditionKey | null;
}) => a.conditionKey === 'cfs_applicable' || a.areaCode === 'CONSOL';
export const isOpeningBalances = (a: {
  areaCode: string | null;
  conditionKey: AreaConditionKey | null;
}) => a.conditionKey === 'initial_audit' || a.areaCode === 'OB';

const toRupees = (v: number | null, unit: FinancialUnit | null): number | null => {
  if (v === null || !unit) return null;
  const f = FINANCIAL_UNIT_FACTOR[unit];
  return f === null ? null : v * f;
};

export function amountsFor(
  area: Pick<
    StoredArea,
    'manualCy' | 'manualPy' | 'manualCurrency' | 'manualUnit' | 'amountSource'
  >,
  lib: Pick<LibraryRow, 'metricKeys'> | null,
  facts: Pick<AreaFacts, 'metrics' | 'datasetUnit' | 'currency'>,
): {
  cy: number | null;
  py: number | null;
  unit: FinancialUnit | null;
  currency: string | null;
  source: AreaAmountSource | null;
} {
  if (area.amountSource) {
    return {
      cy: area.manualCy,
      py: area.manualPy,
      unit: area.manualUnit,
      currency: area.manualCurrency,
      source: area.amountSource,
    };
  }
  for (const k of lib?.metricKeys ?? []) {
    const m = facts.metrics[k];
    if (m && (m.cy !== null || m.py !== null)) {
      return {
        cy: m.cy,
        py: m.py,
        unit: facts.datasetUnit,
        currency: facts.currency,
        source: '03.2',
      };
    }
  }
  return { cy: null, py: null, unit: null, currency: null, source: null };
}

const fmt = (v: number | null, unit: FinancialUnit | null) =>
  v === null ? '—' : `${v.toLocaleString('en-IN')}${unit ? ` ${FINANCIAL_UNIT_LABEL[unit]}` : ''}`;

export interface DeriveContext {
  facts: AreaFacts;
  lib: LibraryRow | null;
  signalById: Map<string, AreaSignalFact>;
  specificByKey: Map<string, SpecificFact>;
  areaName: Map<string, string>;
  priorYear: EngagementAuditArea['priorYear'];
  authorities: EngagementAuditArea['authorities'];
  assertionMaster: Map<string, { group: AssertionGroup; label: string }>;
}

/** Everything the landing row / detail screen shows for one area. */
export function deriveArea(a: StoredArea, c: DeriveContext): EngagementAuditArea {
  const { facts, lib } = c;
  const amt = amountsFor(a, lib, facts);
  const cyRupees = toRupees(amt.cy, amt.unit);
  const pyRupees = toRupees(amt.py, amt.unit);
  const biggest =
    cyRupees === null && pyRupees === null
      ? null
      : Math.max(Math.abs(cyRupees ?? 0), Math.abs(pyRupees ?? 0));
  const omComparison =
    facts.om && biggest !== null ? (biggest > facts.om ? 'above_om' : 'below_om') : null;

  const activeSignals = a.signalLinks
    .filter((l) => l.active)
    .map((l) => c.signalById.get(l.signalId))
    .filter((s): s is AreaSignalFact => !!s);
  const activeSpecific = a.specificLinks.filter(
    (l) => l.active && c.specificByKey.has(l.specificKey),
  );
  const conditionKey = lib?.conditionKey ?? null;
  const tags = lib?.indicatorTags ?? [];

  const indicators: AreaIndicator[] = [];
  const ind = (key: AreaIndicator['key'], detail: string) =>
    indicators.push({ key, label: AREA_INDICATOR_LABEL[key], detail });
  if (amt.cy !== null || amt.py !== null) {
    ind('financial_data', `CY ${fmt(amt.cy, amt.unit)} · PY ${fmt(amt.py, amt.unit)}`);
  }
  if (activeSignals.length) ind('planning_signal', activeSignals.map((s) => s.code).join(', '));
  if (activeSpecific.length) {
    ind(
      'specific_materiality',
      activeSpecific.map((l) => c.specificByKey.get(l.specificKey)!.label).join('; '),
    );
  }
  if (tags.includes('statutory'))
    ind('statutory', 'Companies Act / Schedule III reporting relevance');
  if (tags.includes('cfs') && facts.profile.cfsApplicable)
    ind('cfs', 'Consolidated financial statements applicable (Section 02)');
  if (tags.includes('caro') && facts.caroApplicable)
    ind('caro', 'CARO 2020 applicable (Section 02)');
  if (c.priorYear)
    ind('prior_year', c.priorYear.retained ? 'Retained last year' : 'Removed last year');

  const highSignals = activeSignals.filter((s) => s.attention !== 'standard');
  const strong: string[] = [];
  if (omComparison === 'above_om') strong.push('Amount exceeds Overall Materiality');
  if (highSignals.length)
    strong.push(
      `Enhanced/Immediate Planning Signal linked (${highSignals.map((s) => s.code).join(', ')})`,
    );
  if (activeSpecific.length) strong.push('Specific materiality linked');
  const cfsConsol =
    facts.profile.cfsApplicable && isConsolidation({ areaCode: a.areaCode, conditionKey });
  const initialOb =
    facts.profile.initialAudit && isOpeningBalances({ areaCode: a.areaCode, conditionKey });
  if (cfsConsol) strong.push('CFS applicable');
  if (initialOb) strong.push('Initial audit');

  const warnings: AreaWarning[] = [];
  if (amt.cy !== null || amt.py !== null) {
    warnings.push({
      key: 'financial_data',
      severity: 'normal',
      text: `Financial information exists: CY ${fmt(amt.cy, amt.unit)}, PY ${fmt(amt.py, amt.unit)}.`,
    });
  }
  if (omComparison === 'above_om') {
    warnings.push({
      key: 'above_om',
      severity: 'normal',
      text: 'Amount exceeds Overall Materiality',
    });
  }
  for (const l of activeSpecific) {
    warnings.push({
      key: `specific:${l.specificKey}`,
      severity: 'high',
      text: `Specific materiality "${c.specificByKey.get(l.specificKey)!.label}" is linked — completion cannot pass if the specific-materiality matter is left unmapped.`,
    });
  }
  for (const s of activeSignals) {
    warnings.push({
      key: `signal:${s.id}`,
      severity: 'normal',
      text: `${s.code} · ${s.observation} (${s.attention === 'immediate_partner' ? 'Immediate Partner Attention' : s.attention === 'enhanced' ? 'Enhanced Attention' : 'Standard'})`,
    });
  }
  for (const i of indicators.filter((x) => ['statutory', 'cfs', 'caro'].includes(x.key))) {
    warnings.push({
      key: `indicator:${i.key}`,
      severity: 'normal',
      text: `${i.label}: ${i.detail}`,
    });
  }
  if (cfsConsol) {
    warnings.push({
      key: 'cfs_consolidation',
      severity: 'high',
      text: 'CFS is applicable — removing Consolidation sets Requires Review until the framework inconsistency is resolved.',
    });
  }
  if (initialOb) {
    warnings.push({
      key: 'initial_opening_balances',
      severity: 'high',
      text: 'This is an initial audit — removing Opening Balances sets Requires Review until resolved.',
    });
  }

  const reasons: string[] = [];
  if (a.reviewFlag) reasons.push(a.reviewFlag);
  if (a.disposition === 'removed' && cfsConsol && !a.inconsistencyResolution) {
    reasons.push(
      'CFS is applicable but Consolidation is removed — resolve the framework inconsistency.',
    );
  }
  if (a.disposition === 'removed' && initialOb && !a.inconsistencyResolution) {
    reasons.push(
      'Initial audit but Opening Balances is removed — document the resolved rationale.',
    );
  }
  const displayAttention: AreaDisplayAttention = reasons.length ? 'requires_review' : a.attention;

  const suggested: AreaAttention =
    highSignals.length || activeSpecific.length
      ? 'enhanced'
      : (lib?.defaultAttention ?? 'standard');
  const suggestionBasis = highSignals.length
    ? `Linked ${highSignals.map((s) => s.code).join(', ')} (${highSignals.some((s) => s.attention === 'immediate_partner') ? 'Immediate Partner Attention' : 'Enhanced'})`
    : activeSpecific.length
      ? 'Specific materiality linked (03.3)'
      : null;

  return {
    id: a.id,
    seq: a.seq,
    source: a.source,
    origin: a.origin,
    sourceAuditAreaId: a.sourceAuditAreaId,
    areaCode: a.areaCode,
    libraryVersion: a.libraryVersion,
    areaName: a.areaName,
    areaType: a.areaType,
    category: lib?.category ?? null,
    aliases: lib?.aliases ?? [],
    conditionKey,
    additionReason: a.additionReason,
    disposition: a.disposition,
    attention: a.attention,
    displayAttention,
    attentionSource: a.attentionSource,
    attentionReason: a.attentionReason,
    suggestedAttention: suggested,
    suggestionBasis,
    removalReasonCode: a.removalReasonCode,
    removalReasonText: a.removalReasonText,
    coveredUnderAreaId: a.coveredUnderAreaId,
    coveredUnderName: a.coveredUnderAreaId ? (c.areaName.get(a.coveredUnderAreaId) ?? null) : null,
    removedAt: a.removedAt,
    removedByName: a.removedByName,
    cyAmount: amt.cy,
    pyAmount: amt.py,
    currency: amt.currency,
    unit: amt.unit,
    amountSource: amt.source,
    amountNote: a.amountNote,
    manualAmount:
      a.amountSource && a.manualCurrency && a.manualUnit
        ? { cy: a.manualCy, py: a.manualPy, currency: a.manualCurrency, unit: a.manualUnit }
        : null,
    omComparison,
    planningOwnerEmployeeId: a.planningOwnerEmployeeId,
    planningOwnerName: a.planningOwnerName,
    reviewFlag: a.reviewFlag,
    reviewFlagSource: a.reviewFlagSource,
    inconsistencyResolution: a.inconsistencyResolution,
    requiresReviewReasons: reasons,
    indicators,
    warnings,
    strongIndicators: strong,
    assertions: a.assertions
      .filter((x) => c.assertionMaster.has(x.assertionId))
      .map((x) => ({ ...x, ...c.assertionMaster.get(x.assertionId)! }))
      .sort((x, y) => ASSERTION_IDS.indexOf(x.assertionId) - ASSERTION_IDS.indexOf(y.assertionId)),
    signals: a.signalLinks
      .map((l) => {
        const s = c.signalById.get(l.signalId);
        return s
          ? {
              signalId: s.id,
              code: s.code,
              observation: s.observation,
              attention: s.attention,
              origin: l.origin,
              active: l.active,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x),
    specific: a.specificLinks.map((l) => ({
      specificKey: l.specificKey,
      label: c.specificByKey.get(l.specificKey)?.label ?? l.specificKey,
      origin: l.origin,
      active: l.active,
      current: c.specificByKey.has(l.specificKey),
    })),
    suggestedSignals: [],
    suggestedSpecific: [],
    authorities: c.authorities,
    priorYear: c.priorYear,
    downstreamWork: 0,
    version: a.version,
  };
}

// ── Signals / specific overview ─────────────────────────────────────────────

export function signalRefs(
  facts: AreaFacts,
  areas: EngagementAuditArea[],
  resolutions: Map<string, string>,
): AreaSignalRef[] {
  return facts.signals.map((s) => ({
    id: s.id,
    code: s.code,
    observation: s.observation,
    attention: s.attention,
    status: s.status,
    requiresMapping: requiresMapping(s),
    mappedAreaIds: areas
      .filter(
        (a) =>
          a.disposition === 'retained' && a.signals.some((l) => l.active && l.signalId === s.id),
      )
      .map((a) => a.id),
    resolution: resolutions.get(s.id) ?? null,
  }));
}

export function specificMatters(
  facts: AreaFacts,
  areas: EngagementAuditArea[],
): AreaSpecificMatter[] {
  return facts.specific.map((sp) => ({
    key: sp.key,
    label: sp.label,
    scopeType: sp.scopeType,
    amount: sp.amount,
    mappedAreaIds: areas
      .filter(
        (a) =>
          a.disposition === 'retained' &&
          a.specific.some((l) => l.active && l.specificKey === sp.key),
      )
      .map((a) => a.id),
  }));
}

// ── §21 Validations ─────────────────────────────────────────────────────────

export interface ValidationState {
  profile: AreaLibraryProfile;
  areas: EngagementAuditArea[];
  specific: AreaSpecificMatter[];
  signals: AreaSignalRef[];
}

export function validations(s: ValidationState): AreaValidation[] {
  const v = (
    id: AreaValidationId,
    bad: EngagementAuditArea[],
    detail: (b: EngagementAuditArea[]) => string,
    met = !bad.length,
  ): AreaValidation => ({
    id,
    label: AREA_VALIDATION_LABEL[id],
    met,
    detail: met ? null : detail(bad),
    areaIds: bad.map((b) => b.id),
  });
  const names = (b: EngagementAuditArea[]) => b.map((x) => x.areaName).join(', ');
  const retained = s.areas.filter((a) => a.disposition === 'retained');
  const removed = s.areas.filter((a) => a.disposition === 'removed');
  const byId = new Map(s.areas.map((a) => [a.id, a]));

  const unresolved = s.areas.filter(
    (a) => a.disposition !== 'retained' && a.disposition !== 'removed',
  );
  const badRemoval = removed.filter(
    (a) =>
      !a.removalReasonCode ||
      (REMOVAL_REASON_NEEDS_TEXT.includes(a.removalReasonCode) && !a.removalReasonText) ||
      (a.removalReasonCode === 'COVERED_ELSEWHERE' && !a.coveredUnderAreaId),
  );
  const noAssertions = retained.filter((a) => !a.assertions.some((x) => x.active));
  const unmappedSpecific = s.specific.filter((m) => !m.mappedAreaIds.length);
  const unmappedSignals = s.signals.filter(
    (x) => x.requiresMapping && !x.mappedAreaIds.length && !x.resolution,
  );

  const consol = s.areas.filter((a) => isConsolidation(a));
  const cfsBad = s.profile.cfsApplicable
    ? consol.filter((a) => a.disposition === 'removed' && !a.inconsistencyResolution)
    : [];
  const cfsMissing = s.profile.cfsApplicable && !consol.length;
  const ob = s.areas.filter((a) => isOpeningBalances(a));
  const obBad = s.profile.initialAudit
    ? ob.filter((a) => a.disposition === 'removed' && !a.inconsistencyResolution)
    : [];
  const obMissing = s.profile.initialAudit && !ob.length;
  const undocumented = removed.filter((a) => a.strongIndicators.length && !a.removalReasonText);
  const review = s.areas.filter((a) => a.displayAttention === 'requires_review');
  const broken = removed.filter(
    (a) =>
      a.removalReasonCode === 'COVERED_ELSEWHERE' &&
      (!a.coveredUnderAreaId ||
        a.coveredUnderAreaId === a.id ||
        byId.get(a.coveredUnderAreaId)?.disposition !== 'retained'),
  );

  return [
    v('VAL-01', unresolved, (b) => `No disposition: ${names(b)}.`),
    v('VAL-02', badRemoval, (b) => `Removal reason incomplete: ${names(b)}.`),
    v('VAL-03', noAssertions, (b) => `Retained with no active assertion: ${names(b)}.`),
    {
      id: 'VAL-04',
      label: AREA_VALIDATION_LABEL['VAL-04'],
      met: !unmappedSpecific.length,
      detail: unmappedSpecific.length
        ? `Specific materiality not mapped to a retained area: ${unmappedSpecific.map((m) => m.label).join(', ')}.`
        : null,
      areaIds: [],
    },
    {
      id: 'VAL-05',
      label: AREA_VALIDATION_LABEL['VAL-05'],
      met: !unmappedSignals.length,
      detail: unmappedSignals.length
        ? `Enhanced/Immediate Planning Signals not mapped and not resolved: ${unmappedSignals.map((x) => x.code).join(', ')}.`
        : null,
      areaIds: [],
    },
    v(
      'VAL-06',
      cfsBad,
      (b) =>
        cfsMissing
          ? 'CFS is applicable but Consolidation is not in the population — add it from the library.'
          : `CFS is applicable and Consolidation is removed without a resolved framework inconsistency: ${names(b)}.`,
      !cfsBad.length && !cfsMissing,
    ),
    v(
      'VAL-07',
      obBad,
      (b) =>
        obMissing
          ? 'Initial audit but Opening Balances is not in the population — add it from the library.'
          : `Initial audit and Opening Balances is removed without resolved rationale: ${names(b)}.`,
      !obBad.length && !obMissing,
    ),
    v(
      'VAL-08',
      undocumented,
      (b) =>
        `Removed despite strong applicability indicators without documented rationale: ${names(b)}.`,
    ),
    v('VAL-09', review, (b) => `Requires Review: ${names(b)}.`),
    v(
      'VAL-10',
      broken,
      (b) => `"Covered under another Audit Area" does not point to a retained area: ${names(b)}.`,
    ),
  ];
}

// ── Output ──────────────────────────────────────────────────────────────────

/** §23 — only retained areas and active assertions (AT-20). */
export function buildMatrix(areas: EngagementAuditArea[]): AreaMatrixRow[] {
  return areas
    .filter((a) => a.disposition === 'retained')
    .map((a) => ({
      areaId: a.id,
      areaCode: a.areaCode,
      areaName: a.areaName,
      source: a.source,
      areaType: a.areaType,
      cy: a.cyAmount,
      py: a.pyAmount,
      unit: a.unit,
      currency: a.currency,
      attention: a.attention,
      assertions: a.assertions
        .filter((x) => x.active)
        .map((x) => ({
          assertionId: x.assertionId,
          label: x.label,
          group: x.group,
          attention: x.attention,
        })),
      signals: a.signals
        .filter((l) => l.active)
        .map((l) => ({ id: l.signalId, code: l.code, observation: l.observation })),
    }));
}

export function completenessSummary(
  initialPopulation: number,
  areas: EngagementAuditArea[],
  signals: AreaSignalRef[],
): AreaCompletenessSummary {
  const retained = areas.filter((a) => a.disposition === 'retained');
  return {
    libraryAreasReviewed: initialPopulation,
    retained: retained.length,
    removed: areas.length - retained.length,
    customRetained: retained.filter((a) => a.source === 'custom').length,
    customRemoved: areas.filter((a) => a.source === 'custom' && a.disposition === 'removed').length,
    enhanced: retained.filter((a) => a.attention === 'enhanced').length,
    requiresReview: areas.filter((a) => a.displayAttention === 'requires_review').length,
    unresolvedSignals: signals.filter(
      (x) => x.requiresMapping && !x.mappedAreaIds.length && !x.resolution,
    ).length,
  };
}

export function tiles(initialPopulation: number, areas: EngagementAuditArea[]): AreaReviewTiles {
  const retained = areas.filter((a) => a.disposition === 'retained');
  return {
    applicableLibraryAreas: initialPopulation,
    retained: retained.length,
    removed: areas.length - retained.length,
    enhanced: retained.filter(
      (a) => a.attention === 'enhanced' && a.displayAttention !== 'requires_review',
    ).length,
    requiresReview: areas.filter((a) => a.displayAttention === 'requires_review').length,
  };
}

export function sectionStatus(
  stored: StoredAreaReviewStatus | null,
  checks: AreaValidation[],
  impacts: AreaImpact[],
): AreaSectionStatus {
  if (!stored) return 'not_started';
  if (stored === 'update_required') return 'update_required';
  if (stored === 'complete') return impacts.length ? 'update_required' : 'complete';
  const reviewIds: AreaValidationId[] = ['VAL-06', 'VAL-07', 'VAL-09'];
  return checks.some((c) => reviewIds.includes(c.id) && !c.met) ? 'requires_review' : 'in_progress';
}

// ── §25 Impact rules ────────────────────────────────────────────────────────

/** Facts captured at completion; later changes are compared against these. */
export interface CompletionBasis {
  om: number | null;
  specificKeys: string[];
  signalIds: string[];
  cfsApplicable: boolean;
  initialAudit: boolean;
  metricKeys: string[];
}

export function completionBasis(facts: AreaFacts): CompletionBasis {
  return {
    om: facts.om,
    specificKeys: facts.specific.map((x) => x.key),
    signalIds: facts.signals.filter(requiresMapping).map((x) => x.id),
    cfsApplicable: facts.profile.cfsApplicable,
    initialAudit: facts.profile.initialAudit,
    metricKeys: Object.entries(facts.metrics)
      .filter(([, m]) => m.cy !== null || m.py !== null)
      .map(([k]) => k),
  };
}

/**
 * Upstream changes since the last completion that can affect area / assertion
 * completeness. Never changes a decision — the section shows Update Required.
 */
export function assessImpacts(
  basis: CompletionBasis | null,
  facts: AreaFacts,
  areas: EngagementAuditArea[],
  library: LibraryRow[],
): AreaImpact[] {
  if (!basis) return [];
  const out: AreaImpact[] = [];
  const rupees = (a: EngagementAuditArea) => {
    const f = a.unit ? FINANCIAL_UNIT_FACTOR[a.unit] : null;
    if (f === null) return null;
    const vals = [a.cyAmount, a.pyAmount]
      .filter((x): x is number => x !== null)
      .map((x) => Math.abs(x * f));
    return vals.length ? Math.max(...vals) : null;
  };
  if (basis.om !== null && facts.om !== null && facts.om < basis.om) {
    const hit = areas.filter((a) => {
      const r = rupees(a);
      return a.disposition === 'removed' && r !== null && r >= facts.om! && r < basis.om!;
    });
    if (hit.length) {
      out.push({
        key: 'materiality_decrease',
        kind: 'materiality_decrease',
        message: `Overall materiality decreased (₹${basis.om.toLocaleString('en-IN')} → ₹${facts.om.toLocaleString('en-IN')}); recheck removed areas now at or above the new threshold: ${hit.map((a) => a.areaName).join(', ')}.`,
        areaIds: hit.map((a) => a.id),
      });
    }
  }
  for (const sp of facts.specific.filter((x) => !basis.specificKeys.includes(x.key))) {
    out.push({
      key: `specific:${sp.key}`,
      kind: 'new_specific_materiality',
      message: `New specific materiality "${sp.label}" — map it to a retained Audit Area.`,
      areaIds: [],
    });
  }
  for (const s of facts.signals.filter(
    (x) => requiresMapping(x) && !basis.signalIds.includes(x.id),
  )) {
    const mapped = areas.some(
      (a) => a.disposition === 'retained' && a.signals.some((l) => l.active && l.signalId === s.id),
    );
    if (!mapped) {
      out.push({
        key: `signal:${s.id}`,
        kind: 'new_signal',
        message: `${s.code} (${s.attention === 'immediate_partner' ? 'Immediate Partner Attention' : 'Enhanced'}) is not mapped to a retained Audit Area.`,
        areaIds: [],
      });
    }
  }
  if (basis.cfsApplicable !== facts.profile.cfsApplicable) {
    const hit = areas.filter((a) => isConsolidation(a));
    out.push({
      key: 'cfs_change',
      kind: 'cfs_change',
      message: `CFS status changed (${basis.cfsApplicable ? 'applicable' : 'not applicable'} → ${facts.profile.cfsApplicable ? 'applicable' : 'not applicable'}) — reassess Consolidation and related areas.`,
      areaIds: hit.map((a) => a.id),
    });
  }
  if (basis.initialAudit !== facts.profile.initialAudit) {
    const hit = areas.filter((a) => isOpeningBalances(a));
    out.push({
      key: 'initial_audit_change',
      kind: 'initial_audit_change',
      message: `Initial-audit status corrected (${basis.initialAudit ? 'initial' : 'continuing'} → ${facts.profile.initialAudit ? 'initial' : 'continuing'}) — reassess Opening Balances.`,
      areaIds: hit.map((a) => a.id),
    });
  }
  const newKeys = Object.entries(facts.metrics)
    .filter(([k, m]) => (m.cy !== null || m.py !== null) && !basis.metricKeys.includes(k))
    .map(([k]) => k);
  for (const k of newKeys) {
    const libs = library.filter((l) => l.metricKeys.includes(k));
    if (!libs.length) continue;
    const present = areas.filter((a) => libs.some((l) => l.areaCode === a.areaCode));
    if (present.some((a) => a.disposition === 'retained')) continue;
    out.push({
      key: `metric:${k}`,
      kind: 'new_financial_area',
      message: present.length
        ? `New financial data for ${libs[0]!.areaName} — the area is removed; reassess.`
        : `New financial data for ${libs[0]!.areaName} — add the matching library area.`,
      areaIds: present.map((a) => a.id),
    });
  }
  return out;
}
