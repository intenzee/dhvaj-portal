/**
 * Statutory Audit — Framework → Dynamic Work Generation vocabulary (Audit Spec §20).
 *
 * Once the Framework Memo is approved (§18), the approved applicability
 * conclusions drive WHAT work exists: "APPROVED FRAMEWORK → APPLICABLE WORK
 * AREAS" (§20). This module is the single source of truth for the generated
 * work-area layer — the deterministic blueprint that maps an approved framework
 * area to its workstream, the work-area state model, and the shapes the Work-tab
 * reads — shared by the generation engine, the service and the screen.
 *
 * Generation is IDEMPOTENT (§20 "Generation must be idempotent"): re-running it
 * never creates a duplicate work area and never silently deletes existing work.
 * An area that a later framework change makes not-applicable is DEACTIVATED
 * (is_active = false), never dropped, so completed work is preserved (§20, §30).
 *
 * SCOPE: SA-3 generates the top of the §20 cascade — the applicable work areas
 * driven by the framework applicability conclusions that exist today. The
 * workpaper / procedure / evidence detail inside each area (§9–§14) is SA-5, and
 * the SA-6xx / SA-5xx trigger sources that flow from the planning SA-relevance
 * matrix arrive with Planning (SA-4); the blueprint is shaped to absorb them.
 */

/**
 * Professional state of a generated work area — the same first-class model as an
 * audit-file phase (§8, §31): `locked` and `needs_attention` are states, not a
 * progress percentage. A freshly generated area starts `not_started`.
 */
export const WORK_AREA_STATE = {
  notStarted: 'not_started',
  inProgress: 'in_progress',
  complete: 'complete',
  needsAttention: 'needs_attention',
  locked: 'locked',
} as const;
export type WorkAreaState = (typeof WORK_AREA_STATE)[keyof typeof WORK_AREA_STATE];

/** States in which a work area carries real progress (never silently removed). */
export const WORK_AREA_PROGRESSED_STATES: readonly WorkAreaState[] = [
  'in_progress',
  'complete',
  'needs_attention',
];

/** Stable machine keys for the generated work areas (§20). */
export const WORK_AREA_KEY = {
  indAsReview: 'ind_as_review',
  scheduleIiiWork: 'schedule_iii_work',
  caro: 'caro',
  ifc: 'ifc',
  cfs: 'cfs',
  internalAuditReliance: 'internal_audit_reliance',
  auditorReporting: 'auditor_reporting',
} as const;
export type WorkAreaKey = (typeof WORK_AREA_KEY)[keyof typeof WORK_AREA_KEY];

/**
 * One entry of the deterministic generation blueprint (§20 activation table).
 * A work area is generated when its trigger framework area concludes `applicable`.
 */
export interface WorkAreaBlueprintEntry {
  workAreaKey: WorkAreaKey;
  title: string;
  /** The framework area (by machine key) whose `applicable` conclusion triggers this. */
  triggerAreaKey: string;
  /** A short description of the workstream this area represents (§20). */
  scope: string;
  sortOrder: number;
}

/**
 * The canonical Framework → Work-Area blueprint (§20 activation table), in order.
 * Deterministic and pure data: the same approved conclusions always generate the
 * same work areas. `rule_11` and `section_143` both drive the single auditor's
 * reporting workstream (deduplicated by workAreaKey during generation).
 */
export const WORK_AREA_BLUEPRINT: readonly WorkAreaBlueprintEntry[] = [
  {
    workAreaKey: 'ind_as_review',
    title: 'Ind AS Financial Statement / Disclosure Review',
    triggerAreaKey: 'ind_as_as',
    scope: 'Ind AS recognition, measurement, presentation and disclosure review.',
    sortOrder: 1,
  },
  {
    workAreaKey: 'schedule_iii_work',
    title: 'Applicable AS / Schedule III Work',
    triggerAreaKey: 'schedule_iii',
    scope: 'Schedule III presentation and applicable Accounting Standards work.',
    sortOrder: 2,
  },
  {
    workAreaKey: 'caro',
    title: 'CARO 2020 (21-clause) Workstream',
    triggerAreaKey: 'caro',
    scope: 'The CARO 2020 clause-by-clause reporting workstream.',
    sortOrder: 3,
  },
  {
    workAreaKey: 'ifc',
    title: 'Internal Financial Controls (IFC) Workstream',
    triggerAreaKey: 'ifc',
    scope: 'Process understanding, RCM, walkthroughs, design/OE, deficiencies, conclusion.',
    sortOrder: 4,
  },
  {
    workAreaKey: 'cfs',
    title: 'Consolidation / CFS Workstream',
    triggerAreaKey: 'cfs',
    scope: 'Group structure, components, consolidation and CFS work.',
    sortOrder: 5,
  },
  {
    workAreaKey: 'internal_audit_reliance',
    title: 'Reliance on Internal Audit (SA 610)',
    triggerAreaKey: 'internal_audit',
    scope: 'Evaluate and, where relevant, use the work of the internal audit function.',
    sortOrder: 6,
  },
  {
    workAreaKey: 'auditor_reporting',
    title: "Auditor's Report — Section 143 / Rule 11",
    triggerAreaKey: 'rule_11',
    scope: "Auditor's report, Rule 11 matters and Section 143 reporting.",
    sortOrder: 7,
  },
  {
    // section_143 also drives the single reporting workstream (deduplicated).
    workAreaKey: 'auditor_reporting',
    title: "Auditor's Report — Section 143 / Rule 11",
    triggerAreaKey: 'section_143',
    scope: "Auditor's report, Rule 11 matters and Section 143 reporting.",
    sortOrder: 7,
  },
] as const;

/** One generated work area on a live audit file (§20). */
export interface AuditWorkArea {
  id: string;
  workAreaKey: string;
  title: string;
  scope: string | null;
  /** What triggered generation, e.g. `framework:caro` (§20 provenance). */
  source: string;
  /** The framework area key that drove this area, when framework-driven. */
  originAreaKey: string | null;
  state: WorkAreaState;
  /** False when a later framework change made the area not-applicable (§20 — never deleted). */
  isActive: boolean;
  /** The framework approval version this area's generation reflects (§30 provenance). */
  generatedFromVersion: number | null;
  sortOrder: number;
  /**
   * The §11 professional detail overlaid on the area (ownership, risk,
   * materiality, timing, financial data, conclusion). Added in SA-5 and
   * preserved across framework regeneration. See `AuditAreaDetail`.
   */
  detail: import('./statutory-audit-procedures').AuditAreaDetail;
  createdAt: string;
  updatedAt: string;
}

/**
 * The generated work-area layer for one statutory-audit workflow instance — the
 * shape the Work-tab Audit Areas screen reads (§20).
 */
export interface StatutoryAuditWorkGeneration {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  /** Whether the Framework Memo is approved — the gate for generation (§20). */
  frameworkApproved: boolean;
  /** The framework approval version the current work areas were generated from. */
  generatedFromVersion: number | null;
  areas: AuditWorkArea[];
  /** How many work areas are currently active (applicable). */
  activeCount: number;
}
