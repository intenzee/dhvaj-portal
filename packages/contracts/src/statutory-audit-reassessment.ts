/**
 * Statutory Audit — Change-Impact / Reassessment vocabulary (Audit Spec §29, §30).
 * SA-9 makes change-impact CONTROLLED: when an upstream professional input
 * changes, the affected downstream work is FLAGGED for reassessment — never
 * silently deleted (§30 "Never automatically delete completed downstream work.
 * Use controlled retire/revise/regenerate actions and retain the audit trail").
 *
 * A reassessment is one append-only event: a change of a known TYPE (the §30
 * table), a professional reason, and the controlled impact it applied. Raising
 * one re-opens the affected layers by moving their objects to first-class
 * "attention" states the earlier slices already model — framework areas →
 * `reassessment_required` (SA-2), work areas → `needs_attention` with the
 * conclusion reset to draft (SA-5), and the affected phases → `needs_attention`.
 * A file that was completion-approved or signed off is re-opened too (its
 * approval is cleared), so the §29 completion gate re-blocks until the work is
 * re-done. An archived (locked) file is immutable (§37) and rejects reassessment.
 *
 * All impact maths lives here as pure functions so it is unit-tested independent
 * of the database (§36).
 */

/**
 * The controlled change types (§30 "Change Impact Rules"). Each maps to the
 * downstream layers it re-opens via {@link reassessmentImpact}.
 */
export const REASSESSMENT_CHANGE_TYPE = {
  materialityRevised: 'materiality_revised',
  riskChanged: 'risk_changed',
  auditApproachChanged: 'audit_approach_changed',
  newSubsidiary: 'new_subsidiary',
  caroIfcApplicability: 'caro_ifc_applicability',
  reportingDateChanged: 'reporting_date_changed',
  specialistRequired: 'specialist_required',
  newSignificantTransaction: 'new_significant_transaction',
  frameworkRuleVersionChanged: 'framework_rule_version_changed',
} as const;
export type ReassessmentChangeType =
  (typeof REASSESSMENT_CHANGE_TYPE)[keyof typeof REASSESSMENT_CHANGE_TYPE];

/** Human labels for each change type (§30) — shared by the picker and the log. */
export const REASSESSMENT_CHANGE_LABEL: Record<ReassessmentChangeType, string> = {
  materiality_revised: 'Materiality revised',
  risk_changed: 'Risk changed',
  audit_approach_changed: 'Audit approach changed',
  new_subsidiary: 'New subsidiary',
  caro_ifc_applicability: 'CARO / IFC applicability changed',
  reporting_date_changed: 'Reporting date changed',
  specialist_required: 'Specialist required',
  new_significant_transaction: 'New significant transaction',
  framework_rule_version_changed: 'Framework rule version changed',
};

/** A reassessment's lifecycle. `open` — raised, work outstanding; `resolved` — addressed. */
export const REASSESSMENT_STATUS = {
  open: 'open',
  resolved: 'resolved',
} as const;
export type ReassessmentStatus =
  (typeof REASSESSMENT_STATUS)[keyof typeof REASSESSMENT_STATUS];

/**
 * The downstream layers a change re-opens. Each `true` layer is flagged for
 * reassessment when the event is raised. Pure data, no behaviour.
 */
export interface ReassessmentImpact {
  /** Framework applicability must be reconsidered (areas → reassessment_required). */
  framework: boolean;
  /** Planning must be reconsidered (planning phase re-opened for re-approval). */
  planning: boolean;
  /** Risk assessment must be reconsidered. */
  risk: boolean;
  /** Audit-area work must be reconsidered (active areas → needs_attention). */
  work: boolean;
  /** Reporting / completion must be reconsidered (a signed file is re-opened). */
  reporting: boolean;
}

const NONE: ReassessmentImpact = {
  framework: false,
  planning: false,
  risk: false,
  work: false,
  reporting: false,
};

/**
 * The controlled downstream impact of a change (§30). Pure and total — every
 * change type has an explicit mapping, so a new type cannot silently no-op.
 */
export function reassessmentImpact(changeType: ReassessmentChangeType): ReassessmentImpact {
  switch (changeType) {
    case 'materiality_revised':
      // "Flag affected sampling/testing/evaluation" (§30) — planning + work.
      return { ...NONE, planning: true, work: true };
    case 'risk_changed':
      // "Reassess response/procedures" (§30).
      return { ...NONE, risk: true, work: true };
    case 'audit_approach_changed':
      // "Reassess controls/substantive work" (§30).
      return { ...NONE, planning: true, work: true };
    case 'new_subsidiary':
      // "Reassess CFS/component work" (§30) — a framework applicability shift.
      return { ...NONE, framework: true, work: true };
    case 'caro_ifc_applicability':
      // "Controlled activation/reassessment" (§30) — framework + work + reporting.
      return { ...NONE, framework: true, work: true, reporting: true };
    case 'reporting_date_changed':
      // "Recalculate internal milestones; preserve original" (§30). Reporting only.
      return { ...NONE, reporting: true };
    case 'specialist_required':
      // "Create dependency" (§30) — surfaces on the affected work.
      return { ...NONE, work: true };
    case 'new_significant_transaction':
      // "Reassess affected areas/risks" (§30).
      return { ...NONE, risk: true, work: true };
    case 'framework_rule_version_changed':
      // "Flag affected assessments; do not rewrite history" (§30).
      return { ...NONE, framework: true, work: true };
    default: {
      // Exhaustiveness guard — a new change type must extend this switch.
      const _exhaustive: never = changeType;
      return _exhaustive;
    }
  }
}

/** Whether a change type re-opens planning for re-approval (§30). Pure. */
export function reassessmentReopensPlanning(changeType: ReassessmentChangeType): boolean {
  return reassessmentImpact(changeType).planning;
}

/** One change-impact / reassessment event (§30) — append-only. */
export interface AuditReassessment {
  id: string;
  changeType: ReassessmentChangeType;
  /** The layers this change re-opened. */
  impact: ReassessmentImpact;
  /** The professional reason for the change. */
  reason: string;
  status: ReassessmentStatus;
  /** A short human summary of what was flagged (areas / work / phases). */
  affectedSummary: string | null;
  raisedByName: string | null;
  createdAt: string;
  resolvedByName: string | null;
  resolvedAt: string | null;
  version: number;
}

/** The Reassessment dashboard for one statutory-audit shell (§30). */
export interface StatutoryAuditReassessment {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  /** True once the file is archived — no further reassessment is possible (§37). */
  locked: boolean;
  openCount: number;
  events: AuditReassessment[];
}

/** Count the still-open reassessments in a list. Pure. */
export function countOpenReassessments(
  events: readonly { status: ReassessmentStatus }[],
): number {
  return events.filter((e) => e.status === REASSESSMENT_STATUS.open).length;
}
