import type { PlanningCompletionCheck } from './statutory-audit-planning-strategy';

/**
 * Statutory Audit — Planning Signal Register + 03.1 Planning Intelligence
 * (DHVAJ Section 03.1 / 03.2 specs; see docs/section-03-planning-build-spec.md).
 *
 * The Planning Signal Register is the SPINE of Section 03. It is ONE
 * engagement-scoped register: 03.1 creates signals (from Section 01/02 facts,
 * prior year, current-year changes and professional judgment), 03.2 later
 * appends analytical signals to the SAME register, and 03.3–03.5 consume them.
 *
 * Non-negotiable design rule (repeated across every Section 03 spec): a Planning
 * Signal is NOT a risk of material misstatement. Its "attention level" is
 * Standard / Enhanced / Immediate Partner Attention — never Low/Medium/High or
 * Significant Risk. Formal RMM belongs to 03.6 / Section 04 (`audit_risks`).
 */

// ── Attention level (§10 — "do not call it audit risk") ──────────────────────

/** Planning attention level. NEVER a risk rating. */
export const PLANNING_ATTENTION = {
  standard: 'standard',
  enhanced: 'enhanced',
  immediatePartner: 'immediate_partner',
} as const;
export type PlanningAttention = (typeof PLANNING_ATTENTION)[keyof typeof PLANNING_ATTENTION];
export const PLANNING_ATTENTIONS: PlanningAttention[] = Object.values(PLANNING_ATTENTION);

/** Human labels for the attention levels. */
export const PLANNING_ATTENTION_LABEL: Record<PlanningAttention, string> = {
  standard: 'Standard Attention',
  enhanced: 'Enhanced Attention',
  immediate_partner: 'Immediate Partner Attention',
};

// ── Signal source (§7) ───────────────────────────────────────────────────────

/** Where a Planning Signal came from. */
export const PLANNING_SIGNAL_SOURCE = {
  section01: 'section_01',
  section02: 'section_02',
  priorYear: 'prior_year',
  currentYearChange: 'current_year_change',
  analytics: 'analytics',
  manager: 'manager',
  partner: 'partner',
} as const;
export type PlanningSignalSource =
  (typeof PLANNING_SIGNAL_SOURCE)[keyof typeof PLANNING_SIGNAL_SOURCE];
export const PLANNING_SIGNAL_SOURCES: PlanningSignalSource[] =
  Object.values(PLANNING_SIGNAL_SOURCE);

/** Sources a professional may create a signal from by hand (vs. auto-derived). */
export const PLANNING_SIGNAL_MANUAL_SOURCES: PlanningSignalSource[] = [
  PLANNING_SIGNAL_SOURCE.priorYear,
  PLANNING_SIGNAL_SOURCE.manager,
  PLANNING_SIGNAL_SOURCE.partner,
];

// ── Manager assessment (§9 signal card) ──────────────────────────────────────

/** How the Manager classifies a signal. NOT an RMM conclusion. */
export const PLANNING_SIGNAL_ASSESSMENT = {
  areaOfFocus: 'area_of_focus',
  potentialRiskAssessFurther: 'potential_risk_assess_further',
  normalPlanning: 'normal_planning',
  furtherInformationRequired: 'further_information_required',
  notRelevant: 'not_relevant',
} as const;
export type PlanningSignalAssessment =
  (typeof PLANNING_SIGNAL_ASSESSMENT)[keyof typeof PLANNING_SIGNAL_ASSESSMENT];
export const PLANNING_SIGNAL_ASSESSMENTS: PlanningSignalAssessment[] =
  Object.values(PLANNING_SIGNAL_ASSESSMENT);

// ── Signal lifecycle (§9) ────────────────────────────────────────────────────

export const PLANNING_SIGNAL_STATUS = {
  open: 'open',
  assessed: 'assessed',
  awaitingInformation: 'awaiting_information',
  carriedForward: 'carried_forward',
  closed: 'closed',
} as const;
export type PlanningSignalStatus =
  (typeof PLANNING_SIGNAL_STATUS)[keyof typeof PLANNING_SIGNAL_STATUS];
export const PLANNING_SIGNAL_STATUSES: PlanningSignalStatus[] =
  Object.values(PLANNING_SIGNAL_STATUS);

// ── Carry-forward destinations (§8 suggested destination) ────────────────────

/** Downstream planning modules / Section 04 a signal or focus area carries to. */
export const PLANNING_DESTINATION = {
  scope0304: '03.4',
  areas0305: '03.5',
  risks0306: '03.6',
  team0308: '03.8',
  component0309: '03.9',
  timeline0311: '03.11',
  section04: 'section_04',
} as const;
export type PlanningDestination =
  (typeof PLANNING_DESTINATION)[keyof typeof PLANNING_DESTINATION];
export const PLANNING_DESTINATIONS: PlanningDestination[] =
  Object.values(PLANNING_DESTINATION);

// ── Planning Signal record ───────────────────────────────────────────────────

/** A single Planning Signal, as read by the 03.1 control room. */
export interface PlanningSignalRecord {
  id: string;
  workflowInstanceId: string;
  engagementId: string;
  /** Human display code, e.g. `PS-001`, stable per workflow instance. */
  signalCode: string;
  /** Idempotency back-link key to the originating fact (never a copy). */
  source: PlanningSignalSource;
  /** Stable rule key when auto-derived (e.g. `initial_audit`); null for manual. */
  ruleKey: string | null;
  sourceRef: string | null;
  /** Deep-link hint to the source assessment/section for "view source". */
  sourceLink: string | null;
  /** Factual, neutral statement of the fact/change. */
  observation: string;
  /** Methodology explanation — why the matter may deserve planning attention. */
  whyMayMatter: string | null;
  /** Suggested audit considerations (NOT conclusions). */
  potentialImplications: string | null;
  /** System-suggested attention level. */
  suggestedAttention: PlanningAttention;
  /** Effective attention (Manager-adjustable). */
  attention: PlanningAttention;
  /** Required when downgrading from Immediate Partner Attention (§10). */
  attentionRationale: string | null;
  /** The Manager's classification, once assessed. */
  managerAssessment: PlanningSignalAssessment | null;
  /** Required for `not_relevant`; mandatory when downgrading IPA (§9). */
  assessmentRationale: string | null;
  ownerName: string | null;
  destinations: PlanningDestination[];
  status: PlanningSignalStatus;
  /** True when auto-derived by the intelligence generator (vs. professionally raised). */
  isAuto: boolean;
  documentId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Create a manual Planning Signal (Manager / Partner / prior-year). */
export interface CreatePlanningSignalInput {
  source: PlanningSignalSource;
  observation: string;
  whyMayMatter?: string | null;
  potentialImplications?: string | null;
  suggestedAttention?: PlanningAttention;
  sourceLink?: string | null;
  documentId?: string | null;
}

/** Assess / update a Planning Signal in place. Optimistic-locked. */
export interface AssessPlanningSignalInput {
  attention?: PlanningAttention;
  attentionRationale?: string | null;
  managerAssessment?: PlanningSignalAssessment | null;
  assessmentRationale?: string | null;
  ownerEmployeeId?: string | null;
  destinations?: PlanningDestination[];
  status?: PlanningSignalStatus;
  documentId?: string | null;
  version: number;
}

// ── Area of Focus (§11 — Manager groups signals) ─────────────────────────────

export const AREA_OF_FOCUS_STATUS = {
  open: 'open',
  established: 'established',
  superseded: 'superseded',
} as const;
export type AreaOfFocusStatus =
  (typeof AREA_OF_FOCUS_STATUS)[keyof typeof AREA_OF_FOCUS_STATUS];
export const AREA_OF_FOCUS_STATUSES: AreaOfFocusStatus[] = Object.values(AREA_OF_FOCUS_STATUS);

export interface AreaOfFocusRecord {
  id: string;
  workflowInstanceId: string;
  engagementId: string;
  /** Human display code, e.g. `FA-001`, stable per workflow instance. */
  focusCode: string;
  name: string;
  whyRequiresAttention: string | null;
  /** Potential FS areas (free text tags); not a final audit-area determination. */
  potentialFsAreas: string[];
  expectedStrategicImplication: string | null;
  partnerAttention: boolean;
  destinations: PlanningDestination[];
  status: AreaOfFocusStatus;
  /** Ids of the Planning Signals grouped under this focus area. */
  signalIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAreaOfFocusInput {
  name: string;
  whyRequiresAttention?: string | null;
  potentialFsAreas?: string[];
  expectedStrategicImplication?: string | null;
  partnerAttention?: boolean;
  destinations?: PlanningDestination[];
  signalIds?: string[];
}

export interface UpdateAreaOfFocusInput {
  name?: string;
  whyRequiresAttention?: string | null;
  potentialFsAreas?: string[];
  expectedStrategicImplication?: string | null;
  partnerAttention?: boolean;
  destinations?: PlanningDestination[];
  status?: AreaOfFocusStatus;
  /** Full replacement set of linked signal ids, when provided. */
  signalIds?: string[];
  version: number;
}

// ── 03.1.2 Significant Changes Since Prior Year (PI-01) ───────────────────────

/** Selectable current-year change categories (§6, PI-01). */
export const PLANNING_CHANGE_CATEGORY = {
  ownershipPromoters: 'ownership_promoters',
  keyManagement: 'key_management',
  businessModel: 'business_model',
  majorCustomersSuppliers: 'major_customers_suppliers',
  geographyLocations: 'geography_locations',
  acquisitionDisposal: 'acquisition_disposal',
  subsidiaryJvAssociate: 'subsidiary_jv_associate',
  borrowingsFinancing: 'borrowings_financing',
  restructuring: 'restructuring',
  erpAccountingSystem: 'erp_accounting_system',
  accountingPolicies: 'accounting_policies',
  majorContracts: 'major_contracts',
  regulatoryEnvironment: 'regulatory_environment',
  litigation: 'litigation',
  relatedParties: 'related_parties',
  fraud: 'fraud',
  goingConcern: 'going_concern',
  other: 'other',
  noSignificantChange: 'no_significant_change',
} as const;
export type PlanningChangeCategory =
  (typeof PLANNING_CHANGE_CATEGORY)[keyof typeof PLANNING_CHANGE_CATEGORY];
export const PLANNING_CHANGE_CATEGORIES: PlanningChangeCategory[] =
  Object.values(PLANNING_CHANGE_CATEGORY);

export const PLANNING_CHANGE_CATEGORY_LABEL: Record<PlanningChangeCategory, string> = {
  ownership_promoters: 'Ownership / Promoters',
  key_management: 'Key Management',
  business_model: 'Business Model / Products / Services',
  major_customers_suppliers: 'Major Customers / Suppliers',
  geography_locations: 'Geography / Locations',
  acquisition_disposal: 'Acquisition / Disposal',
  subsidiary_jv_associate: 'Subsidiary / JV / Associate',
  borrowings_financing: 'Borrowings / Financing',
  restructuring: 'Restructuring',
  erp_accounting_system: 'ERP / Accounting System',
  accounting_policies: 'Accounting Policies / Estimates',
  major_contracts: 'Major Contracts',
  regulatory_environment: 'Regulatory Environment',
  litigation: 'Litigation',
  related_parties: 'Related Parties',
  fraud: 'Fraud / Suspected Fraud',
  going_concern: 'Going Concern / Liquidity',
  other: 'Other',
  no_significant_change: 'No significant change',
};

/** Whether the FR impact of a change is known (§6). NOT an audit-risk question. */
export const PLANNING_CHANGE_FR_IMPACT = {
  yes: 'yes',
  no: 'no',
  underAssessment: 'under_assessment',
} as const;
export type PlanningChangeFrImpact =
  (typeof PLANNING_CHANGE_FR_IMPACT)[keyof typeof PLANNING_CHANGE_FR_IMPACT];
export const PLANNING_CHANGE_FR_IMPACTS: PlanningChangeFrImpact[] =
  Object.values(PLANNING_CHANGE_FR_IMPACT);

export interface PlanningChangeRecord {
  id: string;
  workflowInstanceId: string;
  engagementId: string;
  category: PlanningChangeCategory;
  /** What changed. */
  description: string | null;
  effectiveDate: string | null;
  sourceEvidence: string | null;
  frImpactKnown: PlanningChangeFrImpact | null;
  /** The signal this change generated, if any (one change → at most one signal). */
  signalId: string | null;
  documentId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlanningChangeInput {
  category: PlanningChangeCategory;
  description?: string | null;
  effectiveDate?: string | null;
  sourceEvidence?: string | null;
  frImpactKnown?: PlanningChangeFrImpact | null;
  documentId?: string | null;
  /** When true, generate a linked Planning Signal from this change. */
  createSignal?: boolean;
}

export interface UpdatePlanningChangeInput {
  description?: string | null;
  effectiveDate?: string | null;
  sourceEvidence?: string | null;
  frImpactKnown?: PlanningChangeFrImpact | null;
  documentId?: string | null;
  createSignal?: boolean;
  version: number;
}

// ── 03.1.5 Overall Audit Direction (AS-01) + 03.1 record ─────────────────────

/** AS-01 preliminary overall audit orientation (§12). "Not yet determinable"
 * must remain available — control reliance is only decided after Section 05. */
export const AUDIT_ORIENTATION = {
  predominantlySubstantive: 'predominantly_substantive',
  combined: 'combined',
  controlsRelianceSelected: 'controls_reliance_selected',
  notYetDeterminable: 'not_yet_determinable',
} as const;
export type AuditOrientation = (typeof AUDIT_ORIENTATION)[keyof typeof AUDIT_ORIENTATION];
export const AUDIT_ORIENTATIONS: AuditOrientation[] = Object.values(AUDIT_ORIENTATION);

export const AUDIT_ORIENTATION_LABEL: Record<AuditOrientation, string> = {
  predominantly_substantive: 'Predominantly substantive',
  combined: 'Combined controls and substantive',
  controls_reliance_selected: 'Controls reliance expected in selected areas',
  not_yet_determinable: 'Not yet determinable',
};

/** 03.1 module status flow (§4). Formal EP approval is NOT here (that is 03.12). */
export const PLANNING_INTELLIGENCE_STATUS = {
  notStarted: 'not_started',
  intelligenceGenerated: 'intelligence_generated',
  managerAssessment: 'manager_assessment',
  strategyEstablished: 'strategy_established',
  complete: 'complete',
} as const;
export type PlanningIntelligenceStatus =
  (typeof PLANNING_INTELLIGENCE_STATUS)[keyof typeof PLANNING_INTELLIGENCE_STATUS];
export const PLANNING_INTELLIGENCE_STATUSES: PlanningIntelligenceStatus[] =
  Object.values(PLANNING_INTELLIGENCE_STATUS);

/** The one-per-shell 03.1 record: orientation, additional scope, strategy summary. */
export interface PlanningIntelligenceRecord {
  id: string;
  workflowInstanceId: string;
  engagementId: string;
  status: PlanningIntelligenceStatus;
  /** AS-01 preliminary overall audit orientation. */
  orientation: AuditOrientation | null;
  orientationNote: string | null;
  /** AS-02 answered: false = No, true = Yes (see `additionalScope`); null = not answered. */
  additionalScopeRequired: boolean | null;
  /** AS-02 additional scope considerations directing engagement-team effort. */
  additionalScope: string | null;
  /** Continuing audit: Manager confirmed prior-year matters were reviewed (§14). */
  priorYearReviewed: boolean;
  /** Manager-editable narrative generated from the structured strategy data. */
  strategySummary: string | null;
  /** Timestamp Engagement Intelligence was last generated. */
  intelligenceGeneratedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpdatePlanningIntelligenceInput {
  status?: PlanningIntelligenceStatus;
  orientation?: AuditOrientation | null;
  orientationNote?: string | null;
  additionalScopeRequired?: boolean | null;
  additionalScope?: string | null;
  priorYearReviewed?: boolean;
  strategySummary?: string | null;
  version: number;
}

// ── Control-room summary (§4 landing tiles) ──────────────────────────────────

/** The 03.1 landing "control room" roll-up. */
export interface PlanningIntelligenceSummary {
  record: PlanningIntelligenceRecord;
  totalSignals: number;
  openSignals: number;
  managerFocusAreas: number;
  furtherInformationRequired: number;
  partnerAttention: number;
  /** Planning Matters not yet resolved (§18). */
  openPlanningMatters: number;
  /** True when Section 02 records an initial audit (prior-year intelligence N/A). */
  initialAudit: boolean;
  /** §20 completion checklist; 03.1 completes only when every check is met. */
  completion: PlanningCompletionCheck[];
}
