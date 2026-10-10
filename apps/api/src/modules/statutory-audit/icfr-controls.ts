import {
  ICFR_CONSOLIDATED_STATE,
  ICFR_CONTEXT_STATUS,
  ICFR_CONTROL_OVERALL,
  ICFR_DEFICIENCY_CLASS_LABEL,
  ICFR_OUTCOME_LABEL,
  ICFR_SCOPING,
  ICFR_WORKSTREAM_STATE,
  type IcfrActivation,
  type IcfrConsolidatedState,
  type IcfrControlOverall,
  type IcfrControlReviewState,
  type IcfrDeficiencyClass,
  type IcfrDeficiencyMethodology,
  type IcfrDeficiencySummary,
  type IcfrDesign,
  type IcfrFollowUpStatus,
  type IcfrImplementation,
  type IcfrLibraryArea,
  type IcfrLikelihood,
  type IcfrMagnitude,
  type IcfrOperating,
  type IcfrParentConclusion,
  type IcfrProcedureTemplate,
  type IcfrRemediationStatus,
  type IcfrReportingImpact,
  type IcfrScoping,
  type IcfrWorkstreamConclusion,
  type IcfrWorkstreamLevel1,
  type IcfrWorkstreamState,
  type IcfrWorkstreamSummary,
} from '@hsdg/contracts';

/**
 * 02.5 ICFR workstream — pure planning (DHVAJ 02.5 spec §13–§17, §19, §22).
 * The service reads the 02.5 result, the framework library and the stored
 * records, and writes what this plans; nothing here touches a database.
 *
 *   • What the 02.5 result asks of the workstream: instantiate, withdraw, or wait.
 *   • Which process areas the facts put in scope (significant 03.5 accounts,
 *     Section 04 risks, IT dependency) — a suggestion with its basis, never a
 *     mandate; the team's decision always wins.
 *   • The overall control conclusion derived from design, implementation and
 *     operating effectiveness (§15) — the three are never collapsed.
 *   • The DHVAJ deficiency methodology (§16), the review blockers, the
 *     workstream conclusion and the consolidated consideration (§17).
 */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const blank = (s: string | null | undefined) => !s || !s.trim();

// ── Library ──────────────────────────────────────────────────────────────────

const inForce = (a: { effectiveFrom: string; effectiveTo: string | null }, on: string) =>
  a.effectiveFrom <= on && (a.effectiveTo == null || a.effectiveTo >= on);

/** The framework areas in force on `on`, one per area key (latest version wins). */
export function areasInForce(library: readonly IcfrLibraryArea[], on: string): IcfrLibraryArea[] {
  const byKey = new Map<string, IcfrLibraryArea>();
  for (const a of library) {
    if (!inForce(a, on)) continue;
    const seen = byKey.get(a.areaKey);
    if (!seen || seen.effectiveFrom < a.effectiveFrom) byKey.set(a.areaKey, a);
  }
  return [...byKey.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

// ── What 02.5 asks of the workstream ────────────────────────────────────────

export interface WorkstreamPlan {
  state: IcfrWorkstreamState;
  action: 'ensure' | 'withdraw' | 'none';
  reason: string;
}

/**
 * Section 143(3)(i) reporting applies (decided, or the standing suggestion) →
 * instantiate. Exempt → withdraw what exists; normal Section 05 control work is
 * never part of this workstream. Pending → leave what exists as it is.
 */
export function planWorkstream(
  level1: IcfrWorkstreamLevel1 | null,
  existing: { status: 'active' | 'withdrawn' } | null,
  frameworkInForce: boolean,
): WorkstreamPlan {
  if (!level1 || level1.outcome == null || level1.reportingApplies == null) {
    return {
      state: existing ? existing.status : ICFR_WORKSTREAM_STATE.awaitingConclusion,
      action: 'none',
      reason: !level1
        ? '02.5 has not been opened yet — the ICFR workstream is configured from its result.'
        : `02.5 is ${level1.outcome ? ICFR_OUTCOME_LABEL[level1.outcome] : 'not yet assessed'} — the ICFR workstream waits for a decisive result.`,
    };
  }
  if (level1.reportingApplies) {
    if (!frameworkInForce) {
      return {
        state: existing ? existing.status : ICFR_WORKSTREAM_STATE.awaitingConclusion,
        action: 'none',
        reason:
          'No ICFR process-area framework is in force for the audit period — ask the methodology owner to publish one.',
      };
    }
    return {
      state: ICFR_WORKSTREAM_STATE.active,
      action: 'ensure',
      reason: level1.decided
        ? 'Section 143(3)(i) reporting applies (02.5 concluded) — the ICFR audit workstream is configured in Section 05.'
        : 'Section 143(3)(i) reporting applies on the 02.5 assessment — the workstream is configured now and follows the final conclusion.',
    };
  }
  return {
    state: existing ? ICFR_WORKSTREAM_STATE.withdrawn : ICFR_WORKSTREAM_STATE.notRequired,
    action: existing?.status === 'active' ? 'withdraw' : 'none',
    reason:
      'Statutory ICFR reporting is exempt — no separate section 143(3)(i) workstream or annexure. Section 05 internal controls remain active for the financial-statement audit.',
  };
}

// ── Scoping (§13) ────────────────────────────────────────────────────────────

export interface ScopingFacts {
  /** Retained 03.5 audit areas (library code + name). */
  areas: ReadonlyArray<{ code: string | null; name: string; attention: 'standard' | 'enhanced' }>;
  /** Live Section 04 risks. */
  risks: ReadonlyArray<{
    ref: string;
    fsArea: string | null;
    description: string;
    isSignificant: boolean;
  }>;
  /** 02.1 IT facts: accounting software / electronic records (null = not recorded). */
  accountingSoftware: string | null;
  recordsElectronic: 'yes' | 'no' | null;
}

export interface ScopingSuggestion {
  scoping: IcfrScoping;
  basis: string;
}

/**
 * What the facts say about one framework area. Always-areas are in scope;
 * fact / risk areas are in scope when a significant account (retained 03.5
 * area) or a Section 04 risk points to them, otherwise not in scope with the
 * reason; ITGC follows the IT dependency (unknown → to be scoped); other
 * significant processes come only from scoping.
 */
export function suggestScoping(
  area: {
    activation: IcfrActivation;
    triggerAreaCodes: readonly string[];
    triggerKeywords: readonly string[];
  },
  facts: ScopingFacts,
): ScopingSuggestion {
  if (area.activation === 'always')
    return {
      scoping: ICFR_SCOPING.inScope,
      basis: 'Always part of the ICFR framework — scope the controls within it.',
    };
  if (area.activation === 'scoping')
    return {
      scoping: ICFR_SCOPING.toBeScoped,
      basis: 'Added only where risk / scoping identifies a further significant process.',
    };
  const codes = new Set(area.triggerAreaCodes);
  const accounts = facts.areas.filter((a) => a.code && codes.has(a.code));
  const kw = area.triggerKeywords.map((k) => k.toLowerCase());
  const hits = (s: string | null) => !!s && kw.some((k) => s.toLowerCase().includes(k));
  const risks = facts.risks.filter((r) => hits(r.fsArea) || hits(r.description));
  if (area.activation === 'it_dependency') {
    const it =
      facts.accountingSoftware != null || facts.recordsElectronic === 'yes'
        ? `Financial data is processed in ${facts.accountingSoftware ? `${facts.accountingSoftware} (02.1)` : 'electronic records (02.1)'}`
        : null;
    if (it || risks.length)
      return {
        scoping: ICFR_SCOPING.inScope,
        basis:
          [it, risks.length ? `Section 04 risk ${risks.map((r) => r.ref).join(', ')}` : null]
            .filter(Boolean)
            .join('; ') +
          ' — the IT general controls the automated controls and reports depend on are in scope.',
      };
    if (facts.recordsElectronic === 'no')
      return {
        scoping: ICFR_SCOPING.notInScope,
        basis: 'Books are not kept electronically (02.1) — no IT dependency identified.',
      };
    return {
      scoping: ICFR_SCOPING.toBeScoped,
      basis: 'The IT environment is not recorded in 02.1 yet — scope the IT general controls.',
    };
  }
  if (accounts.length || risks.length) {
    const parts: string[] = [];
    if (accounts.length)
      parts.push(
        `significant account${accounts.length === 1 ? '' : 's'} ${accounts
          .map((a) => `${a.name}${a.attention === 'enhanced' ? ' (Enhanced attention)' : ''}`)
          .join(', ')} (03.5)`,
      );
    if (risks.length)
      parts.push(
        `Section 04 risk${risks.length === 1 ? '' : 's'} ${risks
          .map((r) => `${r.ref}${r.isSignificant ? ' (significant)' : ''}`)
          .join(', ')}`,
      );
    return { scoping: ICFR_SCOPING.inScope, basis: clip(`In scope — ${parts.join('; ')}.`, 1000) };
  }
  return {
    scoping: ICFR_SCOPING.notInScope,
    basis: 'No significant account (03.5) or Section 04 risk points to this process.',
  };
}

// ── Section 06 procedures (§13) ──────────────────────────────────────────────

/** The framework workstream the ICFR procedures live in. */
export const ICFR_WORK_AREA_KEY = 'ifc';

export const icfrProcedureSourceKey = (areaKey: string, procKey: string) =>
  `icfr:${areaKey}:${procKey}`;
export const ICFR_CONCLUSION_SOURCE_KEY = 'icfr:workstream:conclusion';

export interface PlannedIcfrProcedure {
  sourceKey: string;
  sourceNote: string;
  title: string;
  objective: string;
  expectedEvidence: string | null;
}

/**
 * One procedure per methodology step of each in-scope process area, plus the
 * deficiency evaluation and ICFR conclusion — replaces a generic programme.
 */
export function planIcfrProcedures(
  areas: ReadonlyArray<{
    areaKey: string;
    title: string;
    scoping: IcfrScoping;
    withdrawn: boolean;
    procedures: readonly IcfrProcedureTemplate[];
  }>,
): PlannedIcfrProcedure[] {
  const live = areas.filter((a) => !a.withdrawn && a.scoping === ICFR_SCOPING.inScope);
  if (!live.length) return [];
  const out: PlannedIcfrProcedure[] = [];
  for (const a of live) {
    for (const p of a.procedures) {
      out.push({
        sourceKey: icfrProcedureSourceKey(a.areaKey, p.key),
        sourceNote: `02.5 ICFR — ${a.title}`,
        title: clip(p.title, 160),
        objective: clip(p.objective, 4000),
        expectedEvidence: p.evidence || null,
      });
    }
  }
  out.push({
    sourceKey: ICFR_CONCLUSION_SOURCE_KEY,
    sourceNote: '02.5 ICFR — workstream conclusion',
    title: 'Evaluate control deficiencies and conclude on ICFR (section 143(3)(i))',
    objective:
      'Evaluate the deficiencies identified (control deficiency / significant deficiency / material weakness) individually and in aggregate, communicate significant deficiencies in writing to those charged with governance (SA 265), and conclude on the adequacy and operating effectiveness of internal financial controls with reference to financial statements.',
    expectedEvidence:
      'Deficiency register with Manager review and Partner conclusion; SA 265 communication.',
  });
  return out;
}

// ── Controls (§14, §15) ──────────────────────────────────────────────────────

/** The overall control conclusion — derived, never a single Yes / No. */
export function controlOverall(c: {
  design: IcfrDesign | null;
  implementation: IcfrImplementation | null;
  operatingEffectiveness: IcfrOperating | null;
}): IcfrControlOverall {
  if (c.design === 'deficiency') return ICFR_CONTROL_OVERALL.designDeficiency;
  if (c.implementation === 'not_implemented') return ICFR_CONTROL_OVERALL.notImplemented;
  if (c.operatingEffectiveness === 'exception_identified')
    return ICFR_CONTROL_OVERALL.operatingException;
  if (c.design == null && c.implementation == null && c.operatingEffectiveness == null)
    return ICFR_CONTROL_OVERALL.notAssessed;
  if (c.design === 'adequate' && c.implementation === 'implemented') {
    if (c.operatingEffectiveness === 'effective') return ICFR_CONTROL_OVERALL.effective;
    if (c.operatingEffectiveness === 'not_tested')
      return ICFR_CONTROL_OVERALL.designImplementationOnly;
  }
  return ICFR_CONTROL_OVERALL.inProgress;
}

export const isDeficientOverall = (o: IcfrControlOverall) =>
  o === ICFR_CONTROL_OVERALL.designDeficiency ||
  o === ICFR_CONTROL_OVERALL.notImplemented ||
  o === ICFR_CONTROL_OVERALL.operatingException;

export interface ControlForReview {
  purposeIcfr: boolean;
  design: IcfrDesign | null;
  implementation: IcfrImplementation | null;
  operatingEffectiveness: IcfrOperating | null;
  testNote: string | null;
  evidence: number;
  /** Live deficiencies raised on the control. */
  deficiencies: number;
}

/**
 * What stops a control's submit for review. Design and implementation are
 * always concluded; an ICFR control also concludes operating effectiveness
 * ("Not Tested" needs the reason); a deficient control carries its deficiency.
 */
export function controlBlockers(c: ControlForReview): string[] {
  const out: string[] = [];
  if (!c.design) out.push('Conclude on the design (Adequate / Deficiency).');
  if (!c.implementation)
    out.push('Conclude on the implementation (Implemented / Not Implemented).');
  if (c.purposeIcfr && !c.operatingEffectiveness)
    out.push('An ICFR control needs an operating-effectiveness conclusion.');
  if (c.operatingEffectiveness === 'not_tested' && c.purposeIcfr && blank(c.testNote))
    out.push('Say why operating effectiveness was not tested.');
  if (c.evidence === 0) out.push('Link the evidence the conclusion rests on.');
  const overall = controlOverall(c);
  if (isDeficientOverall(overall) && c.deficiencies === 0)
    out.push('Raise the deficiency this conclusion identifies in the deficiency register.');
  return out;
}

// ── Deficiencies (§16) ───────────────────────────────────────────────────────

/**
 * The DHVAJ methodology (aligned with the ICAI Guidance Note on Audit of ICFR):
 * severity follows the potential magnitude of a misstatement and the
 * likelihood that the control fails to prevent or detect it. The classification
 * is the professional's — this is the suggestion and its basis.
 */
const MATRIX: Record<IcfrMagnitude, Record<IcfrLikelihood, IcfrDeficiencyClass>> = {
  inconsequential: {
    remote: 'control_deficiency',
    reasonably_possible: 'control_deficiency',
    probable: 'control_deficiency',
  },
  more_than_inconsequential: {
    remote: 'control_deficiency',
    reasonably_possible: 'significant_deficiency',
    probable: 'significant_deficiency',
  },
  material: {
    remote: 'significant_deficiency',
    reasonably_possible: 'material_weakness',
    probable: 'material_weakness',
  },
};

export const ICFR_DEFICIENCY_METHODOLOGY: IcfrDeficiencyMethodology = {
  basis:
    'DHVAJ ICFR methodology (ICAI Guidance Note on Audit of Internal Financial Controls Over Financial Reporting): a material weakness is a deficiency, or combination of deficiencies, such that there is a reasonable possibility that a material misstatement will not be prevented or detected on a timely basis; a significant deficiency is less severe but merits the attention of those charged with governance. Compensating controls are considered before concluding.',
  matrix: (Object.keys(MATRIX) as IcfrMagnitude[]).flatMap((m) =>
    (Object.keys(MATRIX[m]) as IcfrLikelihood[]).map((l) => ({
      magnitude: m,
      likelihood: l,
      classification: MATRIX[m][l],
    })),
  ),
  partnerConclusionFor: ['significant_deficiency', 'material_weakness'],
};

export function suggestDeficiencyClass(
  magnitude: IcfrMagnitude | null,
  likelihood: IcfrLikelihood | null,
): IcfrDeficiencyClass | null {
  return magnitude && likelihood ? MATRIX[magnitude][likelihood] : null;
}

const SEVERITY: Record<IcfrDeficiencyClass, number> = {
  control_deficiency: 0,
  significant_deficiency: 1,
  material_weakness: 2,
};

export const partnerRequiredFor = (c: IcfrDeficiencyClass) =>
  ICFR_DEFICIENCY_METHODOLOGY.partnerConclusionFor.includes(c);

export interface DeficiencyForReview {
  classification: IcfrDeficiencyClass;
  magnitude: IcfrMagnitude | null;
  likelihood: IcfrLikelihood | null;
  assertions: readonly string[];
  affected: boolean;
  compensatingControls: number;
  compensatingNote: string | null;
  remediationAction: string | null;
  remediationStatus: IcfrRemediationStatus;
  auditImpact: string | null;
  reportingImpact: IcfrReportingImpact | null;
  reviewed: boolean;
}

/**
 * What stops the Manager review (`manager_review`) or the Partner conclusion
 * (`partner_conclude`) of a deficiency.
 */
export function deficiencyBlockers(
  d: DeficiencyForReview,
  step: 'manager_review' | 'partner_conclude',
): string[] {
  const out: string[] = [];
  if (step === 'partner_conclude') {
    if (!partnerRequiredFor(d.classification))
      out.push('A control deficiency is concluded at the Manager review — no Partner conclusion.');
    if (!d.reviewed) out.push('The Manager reviews the deficiency first.');
    return out;
  }
  if (!d.affected) out.push('Name the affected account / disclosure or process.');
  if (!d.assertions.length) out.push('Select the assertion(s) affected.');
  if (!d.magnitude) out.push('Assess the potential magnitude.');
  if (!d.likelihood) out.push('Assess the likelihood.');
  if (blank(d.auditImpact)) out.push('Record the audit impact (substantive / risk / reporting).');
  if (!d.reportingImpact) out.push('Record the reporting impact.');
  const suggested = suggestDeficiencyClass(d.magnitude, d.likelihood);
  if (
    suggested &&
    SEVERITY[d.classification] < SEVERITY[suggested] &&
    d.compensatingControls === 0 &&
    blank(d.compensatingNote)
  )
    out.push(
      `The methodology points to a ${ICFR_DEFICIENCY_CLASS_LABEL[suggested]} — document the compensating controls that support a lower classification.`,
    );
  if (d.classification === 'material_weakness' && d.reportingImpact !== 'icfr_opinion_modified')
    out.push('A material weakness modifies the ICFR opinion — set the reporting impact.');
  if (blank(d.remediationAction) && d.remediationStatus !== 'remediated')
    out.push("Record management's remediation action.");
  return out;
}

export function summariseDeficiencies(
  ds: ReadonlyArray<{
    classification: IcfrDeficiencyClass;
    status: 'open' | 'closed';
    reviewed: boolean;
    partnerConcluded: boolean;
    withdrawn: boolean;
  }>,
): IcfrDeficiencySummary {
  const live = ds.filter((d) => !d.withdrawn);
  return {
    total: live.length,
    open: live.filter((d) => d.status === 'open').length,
    controlDeficiencies: live.filter((d) => d.classification === 'control_deficiency').length,
    significantDeficiencies: live.filter((d) => d.classification === 'significant_deficiency')
      .length,
    materialWeaknesses: live.filter((d) => d.classification === 'material_weakness').length,
    awaitingReview: live.filter((d) => !d.reviewed).length,
    awaitingPartner: live.filter(
      (d) => d.reviewed && partnerRequiredFor(d.classification) && !d.partnerConcluded,
    ).length,
  };
}

// ── Prior year (§19) ─────────────────────────────────────────────────────────

/**
 * A prior-year deficiency becomes a current-year follow-up consideration when it
 * was a significant deficiency or material weakness, or its remediation was
 * left unresolved. Prior control effectiveness is never rolled forward.
 */
export function needsFollowUp(d: {
  classification: IcfrDeficiencyClass;
  remediationStatus: string;
  withdrawn: boolean;
}): boolean {
  if (d.withdrawn) return false;
  return d.classification !== 'control_deficiency' || d.remediationStatus !== 'remediated';
}

// ── Workstream summary & conclusion ─────────────────────────────────────────

export interface WorkstreamForConclusion {
  areas: ReadonlyArray<{
    title: string;
    scoping: IcfrScoping;
    keyIcfrControls: number;
    withdrawn: boolean;
  }>;
  controls: ReadonlyArray<{
    ref: string;
    purposeIcfr: boolean;
    reviewState: IcfrControlReviewState;
    withdrawn: boolean;
  }>;
  deficiencies: ReadonlyArray<{
    ref: string;
    classification: IcfrDeficiencyClass;
    reviewed: boolean;
    partnerConcluded: boolean;
    withdrawn: boolean;
  }>;
  followUps: ReadonlyArray<{ priorRef: string; status: IcfrFollowUpStatus }>;
}

/** What stops the ICFR conclusion; `conclusion` adds its consistency checks. */
export function workstreamConclusionBlockers(
  w: WorkstreamForConclusion,
  conclusion: IcfrWorkstreamConclusion | null,
): string[] {
  const out: string[] = [];
  const areas = w.areas.filter((a) => !a.withdrawn);
  const toScope = areas.filter((a) => a.scoping === ICFR_SCOPING.toBeScoped);
  if (toScope.length) out.push(`Scope ${toScope.map((a) => a.title).join(', ')}.`);
  for (const a of areas.filter(
    (x) => x.scoping === ICFR_SCOPING.inScope && x.keyIcfrControls === 0,
  ))
    out.push(`${a.title} is in scope but has no key ICFR control.`);
  const unreviewed = w.controls.filter(
    (c) => !c.withdrawn && c.purposeIcfr && c.reviewState !== 'reviewed',
  );
  if (unreviewed.length)
    out.push(
      `Review ${unreviewed.length} ICFR control${unreviewed.length === 1 ? '' : 's'} (${clip(
        unreviewed.map((c) => c.ref).join(', '),
        120,
      )}).`,
    );
  const live = w.deficiencies.filter((d) => !d.withdrawn);
  const notReviewed = live.filter((d) => !d.reviewed);
  if (notReviewed.length)
    out.push(`Manager review of ${notReviewed.map((d) => d.ref).join(', ')}.`);
  const notPartner = live.filter(
    (d) => d.reviewed && partnerRequiredFor(d.classification) && !d.partnerConcluded,
  );
  if (notPartner.length)
    out.push(`Partner conclusion on ${notPartner.map((d) => d.ref).join(', ')}.`);
  const openFollow = w.followUps.filter((f) => f.status === 'open');
  if (openFollow.length)
    out.push(
      `Conclude the prior-year follow-up on ${openFollow.map((f) => f.priorRef).join(', ')}.`,
    );
  const mw = live.some((d) => d.classification === 'material_weakness');
  if (conclusion === 'unmodified' && mw)
    out.push('A material weakness is recorded — the ICFR opinion cannot be unmodified.');
  if (conclusion === 'modified_material_weakness' && !mw)
    out.push(
      'Record the material weakness in the deficiency register before modifying the opinion.',
    );
  return out;
}

export function summariseWorkstream(input: {
  areas: ReadonlyArray<{ scoping: IcfrScoping; withdrawn: boolean }>;
  controls: ReadonlyArray<{
    purposeFsAudit: boolean;
    purposeIcfr: boolean;
    overall: IcfrControlOverall;
    reviewState: IcfrControlReviewState;
    withdrawn: boolean;
  }>;
  deficiencies: IcfrDeficiencySummary;
  followUps: ReadonlyArray<{ status: IcfrFollowUpStatus }>;
}): IcfrWorkstreamSummary {
  const areas = input.areas.filter((a) => !a.withdrawn);
  const cs = input.controls.filter((c) => !c.withdrawn);
  return {
    processAreas: {
      inScope: areas.filter((a) => a.scoping === 'in_scope').length,
      notInScope: areas.filter((a) => a.scoping === 'not_in_scope').length,
      toBeScoped: areas.filter((a) => a.scoping === 'to_be_scoped').length,
    },
    controls: {
      total: cs.length,
      icfr: cs.filter((c) => c.purposeIcfr).length,
      fsAuditOnly: cs.filter((c) => c.purposeFsAudit && !c.purposeIcfr).length,
      both: cs.filter((c) => c.purposeFsAudit && c.purposeIcfr).length,
      effective: cs.filter((c) => c.overall === 'effective').length,
      deficient: cs.filter((c) => isDeficientOverall(c.overall)).length,
      notAssessed: cs.filter((c) => c.overall === 'not_assessed').length,
      awaitingReview: cs.filter((c) => c.reviewState === 'submitted').length,
    },
    deficiencies: input.deficiencies,
    followUps: {
      total: input.followUps.length,
      open: input.followUps.filter((f) => f.status === 'open').length,
    },
  };
}

// ── Consolidated consideration (§17) ────────────────────────────────────────

export function planConsolidated(
  level1: IcfrWorkstreamLevel1 | null,
  existing: { status: 'active' | 'withdrawn' } | null,
): { state: IcfrConsolidatedState; action: 'ensure' | 'withdraw' | 'none'; reason: string } {
  const status = level1?.consolidatedStatus ?? ICFR_CONTEXT_STATUS.pending;
  if (status === ICFR_CONTEXT_STATUS.applicable)
    return {
      state: ICFR_CONSOLIDATED_STATE.active,
      action: 'ensure',
      reason:
        'Consolidated financial statements are in scope (02.6) — one consolidated ICFR consideration covers the components; the parent’s standalone workstream is not duplicated.',
    };
  if (status === ICFR_CONTEXT_STATUS.pending)
    return {
      state: existing ? existing.status : ICFR_CONSOLIDATED_STATE.pending,
      action: 'none',
      reason:
        'Pending 02.6 — the consolidated ICFR consideration is configured once 02.6 concludes. The standalone conclusion is not blocked.',
    };
  return {
    state: existing ? ICFR_CONSOLIDATED_STATE.withdrawn : ICFR_CONSOLIDATED_STATE.notRequired,
    action: existing?.status === 'active' ? 'withdraw' : 'none',
    reason:
      'No consolidated financial statements in scope (02.6) — no consolidated ICFR consideration.',
  };
}

export interface ComponentForConclusion {
  indianCompany: 'yes' | 'no' | null;
  componentIcfr: 'applicable' | 'exempt' | 'pending';
  auditor: 'dhvaj' | 'other' | null;
  reportLinked: boolean;
  materiality: 'significant' | 'not_significant' | null;
  materialWeakness: boolean | null;
  withdrawn: boolean;
}

/** What a component still needs before the parent auditor concludes. */
export function componentMissing(c: ComponentForConclusion): string[] {
  const out: string[] = [];
  if (!c.indianCompany) out.push('Indian company under the Companies Act?');
  if (c.indianCompany === 'no') return out;
  if (c.componentIcfr === 'pending') out.push('Component ICFR reporting: applicable or exempt?');
  if (c.componentIcfr === 'exempt') return out;
  if (!c.auditor) out.push('Component auditor (DHVAJ / other)');
  if (c.auditor === 'other' && !c.reportLinked)
    out.push("Link the component auditor's section 143(3)(i) report");
  if (!c.materiality) out.push('Materiality / relevance to the CFS');
  if (c.materialWeakness == null) out.push('Qualification / material weakness: yes or no?');
  return out;
}

export function suggestParentConclusion(
  components: readonly ComponentForConclusion[],
  parentMaterialWeakness: boolean,
): IcfrParentConclusion | null {
  const live = components.filter((c) => !c.withdrawn);
  if (live.some((c) => componentMissing(c).length)) return null;
  if (parentMaterialWeakness) return 'modified_parent_material_weakness';
  const reporting = live.filter(
    (c) => c.indianCompany === 'yes' && c.componentIcfr === 'applicable',
  );
  if (reporting.some((c) => c.materialWeakness)) return 'modified_component_material_weakness';
  return 'unmodified';
}

export function consolidatedConclusionBlockers(
  components: readonly ComponentForConclusion[],
  names: readonly string[],
  conclusion: IcfrParentConclusion | null,
  parentMaterialWeakness: boolean,
): string[] {
  const out: string[] = [];
  components.forEach((c, i) => {
    if (c.withdrawn) return;
    const m = componentMissing(c);
    if (m.length) out.push(`${names[i]}: ${m.join('; ')}.`);
  });
  const live = components.filter((c) => !c.withdrawn);
  const componentMw = live.some(
    (c) => c.indianCompany === 'yes' && c.componentIcfr === 'applicable' && c.materialWeakness,
  );
  if (conclusion === 'unmodified' && (componentMw || parentMaterialWeakness))
    out.push(
      'A material weakness is recorded — the consolidated ICFR conclusion cannot be unmodified.',
    );
  if (conclusion === 'modified_component_material_weakness' && !componentMw)
    out.push('No component reports a material weakness.');
  if (conclusion === 'modified_parent_material_weakness' && !parentMaterialWeakness)
    out.push('The parent’s deficiency register records no material weakness.');
  return out;
}
