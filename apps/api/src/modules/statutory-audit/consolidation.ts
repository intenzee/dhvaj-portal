import {
  ASSESSMENT_ANSWER,
  CONDITION_RESULT,
  CONSOLIDATION_METHOD,
  CONSOLIDATION_OUTCOME,
  EMPTY_RULE6_EVIDENCE,
  FRAMEWORK_AREA_KEY,
  INVESTEE_RELATIONSHIP,
  LOCAL_FRAMEWORK,
  LOCAL_FRAMEWORK_LABEL,
  MEMBER_OBJECTION_STATUS,
  PERIMETER_INCLUSION,
  PERIOD_IMPACT,
  POLICY_ALIGNMENT,
  REPORTING_FRAMEWORK_OUTCOME,
  RELATIONSHIP_KIND,
  RULE6_CONDITION,
  RULE6_RESULT,
  RULE_CRITERION,
  ruleMeets,
  type AssessmentAnswer,
  type ConditionResult,
  type ConsolidationDetail,
  type ConsolidationFactUsed,
  type ConsolidationFacts,
  type ConsolidationMethod,
  type ConsolidationMissingFact,
  type ConsolidationResult,
  type ConsolidationRuleUsed,
  type FrameworkState,
  type InvesteeClassification,
  type InvesteeInput,
  type InvesteeRelationship,
  type LocalFramework,
  type PerimeterInclusion,
  type PeriodImpact,
  type PolicyAssessment,
  type ReportingDateAssessment,
  type ResolvedRule,
  type Rule6Assessment,
  type Rule6Condition,
  type RuleResolver,
} from '@hsdg/contracts';

/**
 * 02.6 Consolidation / Group Audit Framework — pure engine (spec v1.0, Part A).
 *
 * Classifies each related entity (spec §5, §9): percentages are rule inputs /
 * rebuttable presumptions, never the whole test —
 *   • AS 21: control = more than one-half of the VOTING POWER (rule) OR control of
 *     the composition of the board; a recorded conclusion always wins.
 *   • Ind AS 110: principle-based — a voting % or board right is only an
 *     INDICATOR; the control conclusion must be confirmed (judgementRequired).
 *   • Joint control only from a contractual arrangement (no % creates it).
 *   • Significant influence: the 20% presumption (rule), rebuttable both ways.
 * Then decides CFS-01 (§129(3) trigger), tests CFS-02 Rule 6 condition by
 * condition (cumulative; silence is never consent; a parent filing needs
 * evidence), proposes perimeter inclusion and the accounting method, and
 * assesses CFS-03 (reporting date vs the Rules Library maximum gap per
 * standard) and CFS-04 (local framework vs group framework).
 *
 * NO statutory number lives here: every threshold resolves through the injected
 * {@link RuleResolver}. No materiality % (spec §18). Mirrors caro.ts so it
 * unit-tests without a database.
 */

const AREA = FRAMEWORK_AREA_KEY.cfs;
const MATERIALITY_NOTE =
  'No fixed materiality % is set here — the consolidation perimeter passes to Section 03.3 for group, component and performance materiality.';
const CROSS_LINK_NOTE =
  'This one group structure feeds CARO clause 3(xxi) (02.4) and consolidated ICFR (02.5) — no duplicate component entry.';

/** Relationships that make the investee a §129(3) trigger (subsidiary / associate incl. JV). */
const TRIGGERS = new Set<InvesteeRelationship>([
  INVESTEE_RELATIONSHIP.subsidiary,
  INVESTEE_RELATIONSHIP.associate,
  INVESTEE_RELATIONSHIP.jointVenture,
]);
/** Relationships accounted for in the CFS. */
const ACCOUNTED = new Set<InvesteeRelationship>([
  ...TRIGGERS,
  INVESTEE_RELATIONSHIP.jointOperation,
]);

/** Optional context for {@link classifyInvestee} (period + rule usage capture). */
export interface ClassifyContext {
  periodStart?: string | null;
  periodEnd?: string | null;
  /** Called for every rule version the classification relied on. */
  onRule?: (r: ResolvedRule, label: string) => void;
}

function sum(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null && b == null) return null;
  return Math.round(((a ?? 0) + (b ?? 0)) * 100) / 100;
}

function fmt(n: number | null | undefined): string {
  return n == null ? '—' : String(n);
}

/** Legacy booleans → the Yes / No / Further assessment answer. */
function answer(
  explicit: AssessmentAnswer | null | undefined,
  legacy: boolean | null | undefined,
): AssessmentAnswer | null {
  if (explicit) return explicit;
  if (legacy === true) return ASSESSMENT_ANSWER.yes;
  if (legacy === false) return ASSESSMENT_ANSWER.no;
  return null;
}

/** A stable id for an investee captured before ids existed. */
export function investeeId(inv: Pick<InvesteeInput, 'id' | 'name'>): string {
  return inv.id ?? `name:${inv.name.trim().toLowerCase()}`;
}

function periodImpactOf(
  inv: InvesteeInput,
  start: string | null | undefined,
  end: string | null | undefined,
): PeriodImpact | null {
  if (!start || !end) return null;
  const from = inv.effectiveFrom ?? null;
  const to = inv.effectiveTo ?? null;
  if ((to && to < start) || (from && from > end)) return PERIOD_IMPACT.outsidePeriod;
  if (to && to <= end) return PERIOD_IMPACT.disposedInPeriod;
  if (from && from > start) return PERIOD_IMPACT.acquiredInPeriod;
  return PERIOD_IMPACT.fullPeriod;
}

interface Classified {
  relationship: InvesteeRelationship;
  method: ConsolidationMethod;
  standard: string | null;
  basis: string;
  judgementRequired: boolean;
}

/**
 * Classify one investee (spec §5, §9). Returns the full perimeter entry; the
 * inclusion proposal, CFS-03 and CFS-04 are added by {@link assessConsolidation}.
 */
export function classifyInvestee(
  inv: InvesteeInput,
  indAs: boolean,
  resolve: RuleResolver,
  ctx: ClassifyContext = {},
): InvesteeClassification {
  const ownership = sum(inv.ownershipDirect, inv.ownershipIndirect) ?? inv.ownershipPercent;
  const voting = sum(inv.votingDirect, inv.votingIndirect);
  // Voting power is the statutory/AS indicator; ownership stands in only when no voting % is captured.
  const indicator = voting ?? ownership;
  const indicatorLabel = voting != null ? 'voting power' : 'ownership (no voting % captured)';
  const factors: string[] = [];
  if (ownership != null) factors.push(`Ownership interest ${ownership}%`);
  if (voting != null) factors.push(`Voting power ${voting}%`);
  if (inv.boardCompositionControl === true)
    factors.push(
      `Controls the board composition${inv.boardRightsDetails ? ` (${inv.boardRightsDetails})` : ''}`,
    );
  if (inv.contractualRights?.trim())
    factors.push(`Contractual rights: ${inv.contractualRights.trim()}`);

  const control = answer(inv.controlConclusion, inv.hasControl);
  const jointControl = inv.jointControl ?? (inv.isJointArrangement ? ASSESSMENT_ANSWER.yes : null);
  const si =
    inv.significantInfluence ??
    (inv.significantInfluenceRebutted === true
      ? ASSESSMENT_ANSWER.no
      : inv.significantInfluenceRebutted === false
        ? ASSESSMENT_ANSWER.yes
        : null);

  const controlRule = resolve(AREA, RULE_CRITERION.controlOwnership);
  const siRule = resolve(AREA, RULE_CRITERION.significantInfluenceOwnership);
  const sub = indAs ? 'Ind AS 110' : 'AS 21';
  const assoc = indAs ? 'Ind AS 28' : 'AS 23';

  const c = ((): Classified => {
    // 1. A recorded control conclusion always wins.
    if (control === ASSESSMENT_ANSWER.yes)
      return {
        relationship: INVESTEE_RELATIONSHIP.subsidiary,
        method: CONSOLIDATION_METHOD.fullConsolidation,
        standard: sub,
        basis: `Subsidiary — control concluded professionally (${indAs ? 'Ind AS 110 — power, exposure to variable returns, ability to use power' : 'AS 21 — voting power or board composition'}); full consolidation.`,
        judgementRequired: false,
      };
    // 2. Contractual joint control (never a percentage).
    if (jointControl === ASSESSMENT_ANSWER.yes) {
      if (inv.jointArrangementIsOperation)
        return {
          relationship: INVESTEE_RELATIONSHIP.jointOperation,
          method: CONSOLIDATION_METHOD.jointOperationLineByLine,
          standard: indAs ? 'Ind AS 111' : 'AS 27',
          basis: indAs
            ? 'Joint operation — Ind AS 111: recognise the share of assets, liabilities, income and expenses.'
            : 'Jointly controlled operation — AS 27: the venturer recognises its own assets, liabilities, income and expenses.',
          judgementRequired: false,
        };
      return {
        relationship: INVESTEE_RELATIONSHIP.jointVenture,
        method: indAs
          ? CONSOLIDATION_METHOD.equityMethod
          : CONSOLIDATION_METHOD.proportionateConsolidation,
        standard: indAs ? 'Ind AS 111 / Ind AS 28' : 'AS 27',
        basis: indAs
          ? 'Joint venture — contractual joint control (Ind AS 111): equity method (Ind AS 28).'
          : 'Jointly controlled entity — contractual joint control: proportionate consolidation (AS 27).',
        judgementRequired: false,
      };
    }
    if (
      control === ASSESSMENT_ANSWER.furtherAssessment ||
      jointControl === ASSESSMENT_ANSWER.furtherAssessment
    )
      return {
        relationship: INVESTEE_RELATIONSHIP.furtherAssessment,
        method: CONSOLIDATION_METHOD.none,
        standard: null,
        basis: `${control === ASSESSMENT_ANSWER.furtherAssessment ? 'Control' : 'Joint control'} is under further assessment — conclude it before the perimeter is final.`,
        judgementRequired: true,
      };

    // 3. No control conclusion — the presumptions / indicators.
    if (control == null) {
      const pctMeets =
        indicator != null && controlRule != null && ruleMeets(indicator, controlRule);
      if (pctMeets && controlRule) ctx.onRule?.(controlRule, 'Control — voting power');
      const board = inv.boardCompositionControl === true;
      if (pctMeets || board) {
        const via = [
          pctMeets
            ? `${indicatorLabel} ${fmt(indicator)}% > ${fmt(controlRule?.threshold)}%`
            : null,
          board ? 'control of the board composition' : null,
        ]
          .filter(Boolean)
          .join(' and ');
        if (indAs)
          return {
            relationship: INVESTEE_RELATIONSHIP.subsidiary,
            method: CONSOLIDATION_METHOD.fullConsolidation,
            standard: sub,
            basis: `Subsidiary indicated by ${via} — Ind AS 110 is principle-based, not a percentage test: confirm power, exposure to variable returns and the ability to use power.`,
            judgementRequired: true,
          };
        return {
          relationship: INVESTEE_RELATIONSHIP.subsidiary,
          method: CONSOLIDATION_METHOD.fullConsolidation,
          standard: sub,
          basis: `Subsidiary — AS 21 control via ${via}; full consolidation.`,
          judgementRequired: false,
        };
      }
      // Recorded as a subsidiary but no control indicator captured.
      if (inv.suggestedRelationship === RELATIONSHIP_KIND.subsidiary)
        return {
          relationship: INVESTEE_RELATIONSHIP.furtherAssessment,
          method: CONSOLIDATION_METHOD.none,
          standard: null,
          basis: `Recorded as a subsidiary, but no voting power above the ${sub} control presumption or board-composition control is captured — assess control.`,
          judgementRequired: true,
        };
    }

    // 4. Significant influence — 20% presumption, rebuttable both ways.
    if (si === ASSESSMENT_ANSWER.yes)
      return {
        relationship: INVESTEE_RELATIONSHIP.associate,
        method: CONSOLIDATION_METHOD.equityMethod,
        standard: assoc,
        basis: `Associate — significant influence concluded (${assoc}${indicator != null && siRule && !ruleMeets(indicator, siRule) ? `, despite ${indicatorLabel} below the ${fmt(siRule.threshold)}% presumption` : ''}); equity method.`,
        judgementRequired: false,
      };
    if (si === ASSESSMENT_ANSWER.furtherAssessment)
      return {
        relationship: INVESTEE_RELATIONSHIP.furtherAssessment,
        method: CONSOLIDATION_METHOD.none,
        standard: null,
        basis:
          'Significant influence is under further assessment — conclude it before the perimeter is final.',
        judgementRequired: true,
      };
    if (si == null) {
      const presumed = indicator != null && siRule != null && ruleMeets(indicator, siRule);
      if (presumed && siRule) {
        ctx.onRule?.(siRule, 'Significant influence — voting power');
        return {
          relationship: INVESTEE_RELATIONSHIP.associate,
          method: CONSOLIDATION_METHOD.equityMethod,
          standard: assoc,
          basis: `Associate — ${indicatorLabel} ${fmt(indicator)}% ≥ ${fmt(siRule.threshold)}% gives a rebuttable presumption of significant influence (${assoc}; §2(6)); equity method.`,
          judgementRequired: false,
        };
      }
      if (inv.suggestedRelationship === RELATIONSHIP_KIND.associate)
        return {
          relationship: INVESTEE_RELATIONSHIP.furtherAssessment,
          method: CONSOLIDATION_METHOD.none,
          standard: null,
          basis: `Recorded as an associate below the ${fmt(siRule?.threshold)}% presumption — significant influence can still arise (e.g. participation in business decisions under an agreement, §2(6)); assess it.`,
          judgementRequired: true,
        };
      if (inv.suggestedRelationship === RELATIONSHIP_KIND.jointVenture)
        return {
          relationship: INVESTEE_RELATIONSHIP.furtherAssessment,
          method: CONSOLIDATION_METHOD.none,
          standard: null,
          basis:
            'Recorded as a joint venture — confirm contractual joint control (no percentage creates it).',
          judgementRequired: true,
        };
    }
    return {
      relationship: INVESTEE_RELATIONSHIP.none,
      method: CONSOLIDATION_METHOD.none,
      standard: null,
      basis:
        'Neither control, significant influence nor joint control — outside the consolidation perimeter.',
      judgementRequired: false,
    };
  })();

  const periodImpact = periodImpactOf(inv, ctx.periodStart, ctx.periodEnd);
  const accounted = ACCOUNTED.has(c.relationship);
  let systemIncluded: PerimeterInclusion;
  let systemReason: string;
  if (periodImpact === PERIOD_IMPACT.outsidePeriod) {
    systemIncluded = PERIMETER_INCLUSION.no;
    systemReason =
      'The relationship is not effective in the audit period (history retained for roll-forward).';
  } else if (accounted) {
    systemIncluded = PERIMETER_INCLUSION.yes;
    systemReason =
      c.relationship === INVESTEE_RELATIONSHIP.subsidiary
        ? 'Control'
        : c.relationship === INVESTEE_RELATIONSHIP.associate
          ? 'Significant influence'
          : 'Joint control';
    if (periodImpact === PERIOD_IMPACT.disposedInPeriod)
      systemReason += ' — disposed in the period: include results up to the disposal date';
    if (periodImpact === PERIOD_IMPACT.acquiredInPeriod)
      systemReason += ' — acquired in the period: include from the acquisition date';
  } else if (c.relationship === INVESTEE_RELATIONSHIP.furtherAssessment) {
    systemIncluded = PERIMETER_INCLUSION.pending;
    systemReason = 'Pending the relationship assessment';
  } else {
    systemIncluded = PERIMETER_INCLUSION.no;
    systemReason = 'No control, significant influence or joint control';
  }

  return {
    id: investeeId(inv),
    name: inv.name,
    ownershipPercent: ownership,
    votingPercent: voting,
    relationship: c.relationship,
    method: c.method,
    standard: c.standard,
    auditedByOtherAuditor: inv.auditedByOtherAuditor,
    basis: c.basis,
    factors,
    judgementRequired: c.judgementRequired,
    systemIncluded,
    included: inv.included ?? systemIncluded,
    inclusionReason:
      inv.included && inv.inclusionReason?.trim() ? inv.inclusionReason.trim() : systemReason,
    periodImpact,
    effectiveFrom: inv.effectiveFrom ?? null,
    effectiveTo: inv.effectiveTo ?? null,
    country: inv.country ?? null,
    isIndianCompany: inv.isIndianCompany ?? null,
    reportingDate: null,
    policy: null,
  };
}

// ── CFS-03 reporting date ──────────────────────────────────────────────────────

const STANDARD_LABEL: Record<string, string> = {
  as_21: 'AS 21',
  as_23: 'AS 23',
  as_27: 'AS 27',
  ind_as_110: 'Ind AS 110',
  ind_as_28: 'Ind AS 28',
};

/** The rules-library entity class holding the reporting-date gap for a method. */
function gapRuleClass(rel: InvesteeRelationship, indAs: boolean): string | null {
  if (rel === INVESTEE_RELATIONSHIP.subsidiary) return indAs ? 'ind_as_110' : 'as_21';
  if (rel === INVESTEE_RELATIONSHIP.associate) return indAs ? 'ind_as_28' : 'as_23';
  if (rel === INVESTEE_RELATIONSHIP.jointVenture) return indAs ? 'ind_as_28' : 'as_27';
  return null;
}

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Whole months between two ISO dates, rounded up (a part month counts). */
export function monthsBetween(a: string, b: string): number {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  let n = 0;
  while (addMonths(lo, n) < hi) n += 1;
  return n;
}

export function assessReportingDate(
  inv: InvesteeInput,
  relationship: InvesteeRelationship,
  indAs: boolean,
  groupDate: string | null,
  resolve: RuleResolver,
  onRule?: ClassifyContext['onRule'],
): ReportingDateAssessment {
  const cls = gapRuleClass(relationship, indAs);
  const rule = cls ? resolve(AREA, RULE_CRITERION.reportingDateGapMonths, cls) : null;
  const standard = cls ? (STANDARD_LABEL[cls] ?? cls) : null;
  const base = {
    componentDate: inv.reportingDate ?? null,
    groupDate,
    maxGapMonths: rule?.threshold ?? null,
    standard,
    ruleCode: rule?.ruleCode ?? null,
    ruleVersion: rule?.version ?? null,
  };
  if (!inv.reportingDate || !groupDate)
    return {
      ...base,
      sameAsGroup: null,
      gapMonths: null,
      withinLimit: null,
      missing: inv.reportingDate ? [] : ['Component reporting date'],
      basis: inv.reportingDate
        ? 'The group reporting date is not known yet.'
        : 'Capture the component reporting date (CFS-03).',
    };
  if (inv.reportingDate === groupDate)
    return {
      ...base,
      sameAsGroup: true,
      gapMonths: 0,
      withinLimit: rule ? true : null,
      missing: [],
      basis: 'Same reporting date as the group.',
    };
  if (rule) onRule?.(rule, `Reporting-date gap — ${standard}`);
  const gap = monthsBetween(inv.reportingDate, groupDate);
  const max = rule?.threshold ?? null;
  const within =
    max == null
      ? null
      : inv.reportingDate >= addMonths(groupDate, -max) &&
        inv.reportingDate <= addMonths(groupDate, max);
  const missing: string[] = [];
  if (!inv.reportingDateReason?.trim()) missing.push('Reason for the different reporting date');
  if (!inv.interimInformation?.trim()) missing.push('Interim financial information');
  if (!inv.interveningTransactions?.trim())
    missing.push('Significant transactions / events between the two dates');
  const limit =
    max == null
      ? `No maximum gap is configured for ${standard ?? 'this relationship'} in the Rules Library — apply the standard's requirements.`
      : within
        ? `Within the ${max}-month maximum under ${standard} (${rule!.ruleCode} v${rule!.version}).`
        : `EXCEEDS the ${max}-month maximum under ${standard} (${rule!.ruleCode} v${rule!.version}) — additional financial information as of the group date is needed.`;
  return {
    ...base,
    sameAsGroup: false,
    gapMonths: gap,
    withinLimit: within,
    missing,
    basis: `Reporting date ${inv.reportingDate} differs from the group's ${groupDate} by about ${gap} month(s). ${limit} Adjust for significant intervening transactions / events.`,
  };
}

// ── CFS-04 accounting policy / GAAP ─────────────────────────────────────────────

export function assessPolicy(
  inv: InvesteeInput,
  groupFramework: LocalFramework | null,
): PolicyAssessment {
  const local = inv.localFramework ?? null;
  let systemResult: PolicyAssessment['systemResult'];
  let basis: string;
  if (!local || !groupFramework) {
    systemResult = POLICY_ALIGNMENT.furtherAssessment;
    basis = !local
      ? "Capture the component's local accounting framework (CFS-04)."
      : 'The group reporting framework (02.2) is not concluded.';
  } else if (local === groupFramework) {
    systemResult = POLICY_ALIGNMENT.aligned;
    basis = `Same framework as the group (${LOCAL_FRAMEWORK_LABEL[local]}); confirm uniform accounting policies.`;
  } else {
    systemResult = POLICY_ALIGNMENT.conversionRequired;
    basis = `${LOCAL_FRAMEWORK_LABEL[local]} differs from the group's ${LOCAL_FRAMEWORK_LABEL[groupFramework]} — a GAAP / policy conversion work item is created; the component's statutory accounts are preserved separately.`;
  }
  const result = inv.policyAlignment ?? systemResult;
  if (inv.policyAlignment && inv.policyAlignment !== systemResult)
    basis += ` Recorded as ${inv.policyAlignment.replace(/_/g, ' ')} by the team.`;
  return { localFramework: local, groupFramework, systemResult, result, basis };
}

// ── CFS-02 Rule 6 ───────────────────────────────────────────────────────────────

function rule6Of(f: ConsolidationFacts): Rule6Assessment {
  const ev = { ...EMPTY_RULE6_EVIDENCE, ...(f.rule6Evidence ?? {}) };
  const conditions: Rule6Condition[] = [];
  const isSub = f.isWhollyOwnedSubsidiary || f.isPartiallyOwnedSubsidiary;

  conditions.push({
    key: RULE6_CONDITION.ownership,
    label: 'Ownership status',
    requirement:
      'The company is a wholly-owned subsidiary, or a partially-owned subsidiary, of another company.',
    result: isSub ? CONDITION_RESULT.satisfied : CONDITION_RESULT.failed,
    evidence: f.isWhollyOwnedSubsidiary
      ? `Wholly-owned subsidiary${ev.parentName ? ` of ${ev.parentName}` : ''}.`
      : f.isPartiallyOwnedSubsidiary
        ? `Partially-owned subsidiary${ev.parentName ? ` of ${ev.parentName}` : ''}.`
        : 'Not a subsidiary of another company on the relationship records.',
  });

  // Other members — partially-owned only; silence is never consent.
  let members: ConditionResult = CONDITION_RESULT.notApplicable;
  let membersEvidence = 'Not applicable — wholly-owned subsidiary.';
  if (f.isPartiallyOwnedSubsidiary && !f.isWhollyOwnedSubsidiary) {
    const captured =
      ev.otherMembersIntimatedInWriting != null ||
      ev.proofOfDeliveryRetained != null ||
      ev.objectionStatus != null;
    if (!captured) {
      members = f.otherMembersIntimatedNoObjection
        ? CONDITION_RESULT.pending
        : CONDITION_RESULT.failed;
      membersEvidence = f.otherMembersIntimatedNoObjection
        ? 'Recorded as intimated with no objection — capture the written intimation and proof of delivery.'
        : 'No written intimation to the other members is recorded.';
    } else if (
      ev.otherMembersIntimatedInWriting === false ||
      ev.objectionStatus === MEMBER_OBJECTION_STATUS.objectionReceived
    ) {
      members = CONDITION_RESULT.failed;
      membersEvidence =
        ev.objectionStatus === MEMBER_OBJECTION_STATUS.objectionReceived
          ? 'A member objected to not presenting CFS.'
          : 'The other members have not all been intimated in writing.';
    } else if (
      ev.otherMembersIntimatedInWriting === true &&
      ev.proofOfDeliveryRetained === true &&
      ev.objectionStatus === MEMBER_OBJECTION_STATUS.noObjection
    ) {
      members = CONDITION_RESULT.satisfied;
      membersEvidence = `All other members intimated in writing${ev.intimationDate ? ` on ${ev.intimationDate}` : ''}; proof of delivery retained; no objection.`;
    } else {
      members = CONDITION_RESULT.pending;
      const gaps = [
        ev.otherMembersIntimatedInWriting !== true ? 'written intimation' : null,
        ev.proofOfDeliveryRetained !== true ? 'proof of delivery' : null,
        ev.objectionStatus !== MEMBER_OBJECTION_STATUS.noObjection
          ? 'objection status (silence is not consent)'
          : null,
      ].filter(Boolean);
      membersEvidence = `Pending: ${gaps.join(', ')}.`;
    }
  }
  conditions.push({
    key: RULE6_CONDITION.otherMembers,
    label: 'Other members — partially-owned case',
    requirement:
      'All other members, including those not otherwise entitled to vote, are intimated in writing and do not object to not presenting CFS.',
    result: members,
    evidence: membersEvidence,
  });

  conditions.push({
    key: RULE6_CONDITION.listing,
    label: 'Listing condition',
    requirement:
      'Securities are neither listed nor in the process of listing on any stock exchange in India or outside India.',
    result: f.securitiesListedOrInProcess ? CONDITION_RESULT.failed : CONDITION_RESULT.satisfied,
    evidence: f.securitiesListedOrInProcess
      ? 'Securities are listed or in the process of listing (02.1 / client master listings).'
      : 'No listing or listing in process on the 02.1 / client master listings.',
  });

  let parent: ConditionResult;
  let parentEvidence: string;
  const filingEvidence = ev.parentFilingSrn?.trim() || ev.parentFilingDate;
  if (f.parentFilesCompliantCfs === false) {
    parent = CONDITION_RESULT.failed;
    parentEvidence =
      'No ultimate or intermediate holding company files compliant CFS with the Registrar.';
  } else if (f.parentFilesCompliantCfs === true && filingEvidence) {
    parent = CONDITION_RESULT.satisfied;
    parentEvidence = `${ev.parentName ?? 'The holding company'} files compliant CFS with the Registrar${ev.parentFilingSrn ? ` (SRN ${ev.parentFilingSrn})` : ''}${ev.parentFilingDate ? `, filed ${ev.parentFilingDate}` : ''}.`;
  } else {
    parent = CONDITION_RESULT.pending;
    parentEvidence =
      f.parentFilesCompliantCfs === true
        ? 'Recorded as filed — capture the parent CFS filing evidence (SRN / filing date).'
        : 'Whether an ultimate or intermediate holding company files compliant CFS is not yet confirmed.';
  }
  conditions.push({
    key: RULE6_CONDITION.parentFiling,
    label: 'Parent CFS filing',
    requirement:
      'The ultimate or any intermediate holding company files CFS with the Registrar in compliance with the applicable Accounting Standards.',
    result: parent,
    evidence: parentEvidence,
  });

  const failed = conditions.filter((c) => c.result === CONDITION_RESULT.failed);
  const pending = conditions.filter((c) => c.result === CONDITION_RESULT.pending);
  const result = failed.length
    ? RULE6_RESULT.notAvailable
    : pending.length
      ? RULE6_RESULT.pending
      : RULE6_RESULT.available;
  const asBool = (r: ConditionResult) =>
    r === CONDITION_RESULT.failed ? false : r === CONDITION_RESULT.pending ? null : true;
  return {
    applies:
      result === RULE6_RESULT.available
        ? true
        : result === RULE6_RESULT.notAvailable
          ? false
          : null,
    ownershipCondition:
      conditions[0]!.result === CONDITION_RESULT.failed
        ? false
        : members === CONDITION_RESULT.failed
          ? false
          : members === CONDITION_RESULT.pending
            ? null
            : true,
    notListedCondition: asBool(conditions[2]!.result),
    parentFilesCfsCondition: asBool(parent),
    basis:
      result === RULE6_RESULT.available
        ? 'Rule 6 exemption available — every cumulative condition is satisfied.'
        : result === RULE6_RESULT.notAvailable
          ? `Rule 6 exemption not available — failed: ${failed.map((c) => c.label.toLowerCase()).join('; ')}.`
          : `Rule 6 exemption pending — ${pending.map((c) => c.label.toLowerCase()).join('; ')}.`,
    result,
    conditions,
  };
}

// ── CFS-01 ─────────────────────────────────────────────────────────────────────

function stateOf(outcome: ConsolidationResult['outcome']): FrameworkState {
  switch (outcome) {
    case CONSOLIDATION_OUTCOME.cfsRequired:
      return 'system_suggested_applicable';
    case CONSOLIDATION_OUTCOME.cfsExempt:
    case CONSOLIDATION_OUTCOME.notApplicable:
      return 'system_suggested_not_applicable';
    case CONSOLIDATION_OUTCOME.furtherAssessment:
      return 'professional_judgement_required';
    default:
      return 'pending_information';
  }
}

function groupFrameworkOf(f: ConsolidationFacts): 'ind_as' | 'as' | null {
  if (f.reportingFramework === REPORTING_FRAMEWORK_OUTCOME.indAs) return 'ind_as';
  if (
    f.reportingFramework === REPORTING_FRAMEWORK_OUTCOME.accountingStandards ||
    f.reportingFramework === REPORTING_FRAMEWORK_OUTCOME.specialised
  )
    return 'as';
  return null;
}

const yn = (b: boolean) => (b ? 'Yes' : 'No');

/**
 * The 02.6 decision sequence (spec §6–§11): classify the perimeter, test the
 * §129(3) trigger, then the cumulative Rule 6 exemption condition-by-condition,
 * and assess every included component's reporting date and framework.
 */
export function assessConsolidation(
  f: ConsolidationFacts,
  resolve: RuleResolver,
): ConsolidationResult {
  const groupFramework = groupFrameworkOf(f);
  const factsUsed: ConsolidationFactUsed[] = [
    {
      key: 'group_framework',
      label: 'Group reporting framework',
      value:
        groupFramework === 'ind_as'
          ? 'Ind AS'
          : groupFramework === 'as'
            ? 'AS (Companies (Accounting Standards) Rules)'
            : 'Not concluded',
      source: '02.2 Financial Reporting Framework',
    },
    {
      key: 'parent',
      label: 'Subsidiary of another company',
      value: f.isWhollyOwnedSubsidiary
        ? 'Wholly owned'
        : f.isPartiallyOwnedSubsidiary
          ? 'Partially owned'
          : 'No',
      source: '02.1 / client master — group relationships',
    },
    {
      key: 'listing',
      label: 'Securities listed or in process',
      value: yn(f.securitiesListedOrInProcess),
      source: '02.1 / client master — listings',
    },
    {
      key: 'related_entities',
      label: 'Related entities assessed',
      value: String(f.investees.length),
      source: '02.6 relationship assessment',
    },
  ];
  const rulesUsed = new Map<string, ConsolidationRuleUsed>();
  const onRule = (r: ResolvedRule, label: string) =>
    rulesUsed.set(r.ruleVersionId, {
      code: r.ruleCode,
      version: r.version,
      label,
      value: `${r.operator} ${fmt(r.threshold)}${r.unit === 'percent' ? '%' : r.criterion === RULE_CRITERION.reportingDateGapMonths ? ' months' : ''}`,
      effectiveFrom: r.effectiveFrom,
    });

  const empty = (overrides: Partial<ConsolidationDetail>): ConsolidationDetail => ({
    cfsTriggered: false,
    rule6: null,
    perimeter: [],
    usesOtherAuditors: false,
    saFramework: null,
    hasBranches: f.hasBranches,
    materialityNote: MATERIALITY_NOTE,
    crossLinkNote: CROSS_LINK_NOTE,
    groupFramework,
    groupReportingDate: f.periodEnd ?? null,
    factsUsed,
    rulesUsed: [...rulesUsed.values()],
    missingFacts: [],
    counts: {},
    reportingDateDifferences: 0,
    conversionsRequired: 0,
    ...overrides,
  });
  const result = (
    outcome: ConsolidationResult['outcome'],
    basis: string,
    d: ConsolidationDetail,
  ): ConsolidationResult => ({
    outcome,
    state: stateOf(outcome),
    basis,
    ruleVersionId: null,
    authorityProvisionId: null,
    detail: d,
  });

  if (groupFramework == null)
    return result(
      CONSOLIDATION_OUTCOME.informationInsufficient,
      'The 02.2 reporting framework is not concluded — conclude it before selecting the consolidation standards.',
      empty({
        missingFacts: [
          {
            key: 'group_framework',
            label: 'Conclude the 02.2 Financial Reporting Framework',
            componentId: null,
            blocking: true,
          },
        ],
      }),
    );

  const indAs = groupFramework === 'ind_as';
  const ctx: ClassifyContext = { periodStart: f.periodStart, periodEnd: f.periodEnd, onRule };
  const missing: ConsolidationMissingFact[] = [];
  const perimeter = f.investees.map((inv) => {
    const p = classifyInvestee(inv, indAs, resolve, ctx);
    // CFS-03 / CFS-04 apply to every component in (or possibly in) the CFS
    // except a joint operation, which is not a separate reporting component.
    if (
      p.included !== PERIMETER_INCLUSION.no &&
      p.relationship !== INVESTEE_RELATIONSHIP.jointOperation
    ) {
      p.reportingDate = assessReportingDate(
        inv,
        p.relationship,
        indAs,
        f.periodEnd ?? null,
        resolve,
        onRule,
      );
      p.policy = assessPolicy(
        inv,
        groupFramework === 'ind_as' ? LOCAL_FRAMEWORK.indAs : LOCAL_FRAMEWORK.as,
      );
    }
    if (p.judgementRequired)
      missing.push({
        key: 'relationship_conclusion',
        label: `${p.name}: record the control / significant influence / joint control conclusion`,
        componentId: p.id,
        blocking: p.relationship === INVESTEE_RELATIONSHIP.furtherAssessment,
      });
    if (ACCOUNTED.has(p.relationship) && p.votingPercent == null && p.ownershipPercent != null)
      missing.push({
        key: 'voting_power',
        label: `${p.name}: voting power % (ownership is used as the indicator meanwhile)`,
        componentId: p.id,
        blocking: false,
      });
    if (p.included === PERIMETER_INCLUSION.yes && !p.country)
      missing.push({
        key: 'country',
        label: `${p.name}: country of incorporation`,
        componentId: p.id,
        blocking: false,
      });
    for (const m of p.reportingDate?.missing ?? [])
      missing.push({
        key: 'reporting_date',
        label: `${p.name}: ${m}`,
        componentId: p.id,
        blocking: false,
      });
    if (p.policy && !p.policy.localFramework)
      missing.push({
        key: 'local_framework',
        label: `${p.name}: local accounting framework`,
        componentId: p.id,
        blocking: false,
      });
    return p;
  });

  const included = perimeter.filter((p) => p.included === PERIMETER_INCLUSION.yes);
  const triggers = included.filter((p) => TRIGGERS.has(p.relationship));
  const pendingComponents = perimeter.filter((p) => p.included === PERIMETER_INCLUSION.pending);
  const counts: Partial<Record<InvesteeRelationship, number>> = {};
  for (const p of included) counts[p.relationship] = (counts[p.relationship] ?? 0) + 1;
  const usesOtherAuditors = f.investees.some((i) => i.auditedByOtherAuditor);
  const common = {
    perimeter,
    usesOtherAuditors,
    saFramework: usesOtherAuditors ? ('SA 600' as const) : null,
    counts,
    reportingDateDifferences: perimeter.filter((p) => p.reportingDate?.sameAsGroup === false)
      .length,
    conversionsRequired: perimeter.filter(
      (p) => p.policy?.result === POLICY_ALIGNMENT.conversionRequired,
    ).length,
  };
  const detail = (overrides: Partial<ConsolidationDetail>) =>
    empty({ ...common, missingFacts: missing, rulesUsed: [...rulesUsed.values()], ...overrides });

  if (triggers.length === 0) {
    if (pendingComponents.length > 0)
      return result(
        CONSOLIDATION_OUTCOME.furtherAssessment,
        `Further assessment required — ${pendingComponents.map((p) => p.name).join(', ')} may be a subsidiary, associate or joint venture; conclude the relationship(s) to decide whether §129(3) requires CFS.`,
        detail({}),
      );
    return result(
      CONSOLIDATION_OUTCOME.notApplicable,
      'No subsidiary, associate or joint venture in the perimeter — §129(3) does not require CFS.',
      detail({}),
    );
  }

  const summary = `${triggers.length} subsidiary / associate / joint venture component(s) in the perimeter`;
  const rule6 = rule6Of(f);
  const isSubsidiary = f.isWhollyOwnedSubsidiary || f.isPartiallyOwnedSubsidiary;
  if (!isSubsidiary)
    return result(
      CONSOLIDATION_OUTCOME.cfsRequired,
      `CFS required under §129(3) (${summary}). Rule 6 exemption unavailable — the company is not a subsidiary of another company.`,
      detail({ cfsTriggered: true, rule6 }),
    );
  if (rule6.result === RULE6_RESULT.notAvailable)
    return result(
      CONSOLIDATION_OUTCOME.cfsRequired,
      `CFS required under §129(3) (${summary}) — ${rule6.basis}`,
      detail({ cfsTriggered: true, rule6 }),
    );
  if (rule6.result === RULE6_RESULT.pending) {
    for (const c of rule6.conditions ?? [])
      if (c.result === CONDITION_RESULT.pending)
        missing.push({
          key: `rule6_${c.key}`,
          label: `Rule 6 — ${c.label}: ${c.evidence}`,
          componentId: null,
          blocking: true,
        });
    return result(
      CONSOLIDATION_OUTCOME.informationInsufficient,
      `§129(3) triggers (${summary}); the Rule 6 exemption cannot be confirmed — ${rule6.basis}`,
      detail({ cfsTriggered: true, rule6, missingFacts: missing }),
    );
  }
  return result(
    CONSOLIDATION_OUTCOME.cfsExempt,
    `CFS is not required — §129(3) triggers (${summary}) but every cumulative Rule 6 exemption condition is satisfied.`,
    detail({ cfsTriggered: true, rule6 }),
  );
}
