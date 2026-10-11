import {
  PLANNING_ATTENTION,
  PLANNING_CHANGE_CATEGORY,
  PLANNING_CONSIDERATION_KIND,
  PLANNING_SIGNAL_STATUS,
  type PlanningAttention,
  type PlanningChangeCategory,
  type PlanningConsiderationKind,
  type PlanningSignalStatus,
} from '@hsdg/contracts';

/**
 * 03.1 §13.2–13.3 — pure, DB-free deriver of STRATEGIC timing and resource
 * considerations from the Planning Signal Register.
 *
 * Considerations only say WHY timing or resources may matter. They never carry
 * dates (03.11) or named people / specialist scope (03.8). Each points at the
 * signal that prompted it, so the strategy stays traceable (§22).
 */

/** The register facts the deriver reads. */
export interface ConsiderationSignalFact {
  id: string;
  ruleKey: string | null;
  /** Category of the PI-01 change that raised the signal, if any. */
  changeCategory: PlanningChangeCategory | null;
  attention: PlanningAttention;
  status: PlanningSignalStatus;
}

export interface DerivedConsideration {
  /** Stable idempotency key (upsert-by-key). */
  key: string;
  kind: PlanningConsiderationKind;
  label: string;
  basis: string;
  /** The prompting signal. */
  signalId: string;
}

interface Rule {
  key: string;
  kind: PlanningConsiderationKind;
  label: string;
  basis: string;
  /** Returns true for a signal that triggers the consideration. */
  match: (s: ConsiderationSignalFact) => boolean;
}

const byRule =
  (...keys: string[]) =>
  (s: ConsiderationSignalFact) =>
    s.ruleKey !== null && keys.includes(s.ruleKey);
const byChange =
  (...cats: PlanningChangeCategory[]) =>
  (s: ConsiderationSignalFact) =>
    s.changeCategory !== null && cats.includes(s.changeCategory);
const either =
  (...fns: Array<(s: ConsiderationSignalFact) => boolean>) =>
  (s: ConsiderationSignalFact) =>
    fns.some((f) => f(s));

const TIMING = PLANNING_CONSIDERATION_KIND.timing;
const RESOURCE = PLANNING_CONSIDERATION_KIND.resource;

/** Ordered rule set; the first matching signal (by register order) is the prompt. */
const RULES: Rule[] = [
  // ── §13.2 Strategic timing ────────────────────────────────────────────────
  {
    key: 'opening_balance_access',
    kind: TIMING,
    label: 'Early access to predecessor auditor / opening-balance evidence',
    basis: 'Initial audit — opening balances need evidence before year-end fieldwork.',
    match: byRule('initial_audit'),
  },
  {
    key: 'interim_control_testing',
    kind: TIMING,
    label: 'Interim control-testing window',
    basis: 'ICFR reporting applies — controls work is usually phased before year end.',
    match: byRule('icfr_applicable'),
  },
  {
    key: 'component_reporting_dependency',
    kind: TIMING,
    label: 'Component / joint-auditor reporting dependency',
    basis: 'Group, joint-audit or branch reporting depends on other auditors delivering on time.',
    match: byRule('cfs_required', 'joint_audit', 'other_auditor_components', 'branch_auditors'),
  },
  {
    key: 'transition_date_balances',
    kind: TIMING,
    label: 'Ind AS transition-date balances and comparatives — early',
    basis: 'First-time Ind AS adoption — the transition balance sheet is audited before year end.',
    match: byRule('first_time_ind_as'),
  },
  {
    key: 'regulatory_reporting_deadlines',
    kind: TIMING,
    label: 'Regulatory / listing reporting deadlines',
    basis:
      'A listed or regulated entity has external filing deadlines that drive the audit timetable.',
    match: byRule('listed_entity', 'regulated_entity'),
  },
  {
    key: 'audit_trail_log_access',
    kind: TIMING,
    label: 'Audit-trail (edit log) access through the year',
    basis:
      'Rule 11(g) reporting applies — log configuration and retention are checked across the year.',
    match: byRule('audit_trail_reporting'),
  },
  {
    key: 'service_org_report_timing',
    kind: TIMING,
    label: 'Service-organisation assurance report — availability and period coverage',
    basis: 'A service organisation handles a financially relevant process.',
    match: byRule('service_organisation'),
  },
  {
    key: 'going_concern_timing',
    kind: TIMING,
    label: 'Going-concern assessment relative to the reporting deadline',
    basis: 'A going-concern / liquidity change was reported for the current year.',
    match: byChange(PLANNING_CHANGE_CATEGORY.goingConcern),
  },
  // ── §13.3 Strategic resources ─────────────────────────────────────────────
  {
    key: 'it_expertise',
    kind: RESOURCE,
    label: 'IT audit expertise',
    basis:
      'ICFR or audit-trail reporting, an ERP environment or change, or a service organisation points to IT involvement.',
    match: either(
      byRule('icfr_applicable', 'service_organisation', 'audit_trail_reporting', 'erp_environment'),
      byChange(PLANNING_CHANGE_CATEGORY.erpAccountingSystem),
    ),
  },
  {
    key: 'specialist_involvement',
    kind: RESOURCE,
    label: 'Auditor’s expert / specialist involvement',
    basis: 'Section 01 identified specialist areas — scope and the individuals are set in 03.8.',
    match: byRule('specialist_required'),
  },
  {
    key: 'ind_as_transition_expertise',
    kind: RESOURCE,
    label: 'Ind AS transition expertise',
    basis: 'First-time Ind AS adoption (Ind AS 101).',
    match: byRule('first_time_ind_as'),
  },
  {
    key: 'industry_regulatory_expertise',
    kind: RESOURCE,
    label: 'Industry / regulatory expertise',
    basis: 'The entity is regulated or specialised (e.g. NBFC, insurer, bank).',
    match: byRule('regulated_entity', 'schedule_iii_specialised'),
  },
  {
    key: 'group_audit_experience',
    kind: RESOURCE,
    label: 'Group-audit / consolidation experience',
    basis: 'Consolidated financial statements are required.',
    match: byRule('cfs_required'),
  },
  {
    key: 'valuation_expertise',
    kind: RESOURCE,
    label: 'Valuation expertise',
    basis: 'An acquisition, disposal or new investee was reported for the current year.',
    match: byChange(
      PLANNING_CHANGE_CATEGORY.acquisitionDisposal,
      PLANNING_CHANGE_CATEGORY.subsidiaryJvAssociate,
    ),
  },
  {
    key: 'tax_expertise',
    kind: RESOURCE,
    label: 'Tax expertise',
    basis: 'A restructuring was reported for the current year.',
    match: byChange(PLANNING_CHANGE_CATEGORY.restructuring),
  },
  {
    key: 'forensic_expertise',
    kind: RESOURCE,
    label: 'Forensic expertise',
    basis: 'Fraud or suspected fraud was reported for the current year.',
    match: byChange(PLANNING_CHANGE_CATEGORY.fraud),
  },
  {
    key: 'enhanced_partner_involvement',
    kind: RESOURCE,
    label: 'Enhanced Partner / Manager involvement',
    basis: 'At least one signal carries Immediate Partner Attention.',
    match: (s) => s.attention === PLANNING_ATTENTION.immediatePartner,
  },
];

/**
 * Derive the strategic timing/resource considerations prompted by the active
 * (non-closed) signals. One consideration per rule, linked to the first
 * matching signal in register order.
 */
export function deriveStrategicConsiderations(
  signals: readonly ConsiderationSignalFact[],
): DerivedConsideration[] {
  const active = signals.filter((s) => s.status !== PLANNING_SIGNAL_STATUS.closed);
  const out: DerivedConsideration[] = [];
  for (const rule of RULES) {
    const prompt = active.find(rule.match);
    if (!prompt) continue;
    out.push({
      key: rule.key,
      kind: rule.kind,
      label: rule.label,
      basis: rule.basis,
      signalId: prompt.id,
    });
  }
  return out;
}
