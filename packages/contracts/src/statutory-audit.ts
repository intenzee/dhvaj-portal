/**
 * Statutory Audit workflow vocabulary (Audit Spec §5–§8, §33) shared by the API
 * and web so the professional audit-file model is defined once.
 *
 * When Statutory Audit is added to an engagement the portal creates a VERSIONED
 * WORKFLOW SHELL — the ten-phase professional audit file — not hundreds of
 * detailed procedures (§5). Detailed work is generated progressively in later
 * phases once framework, planning and risk support it (§20).
 *
 * This module is the single source of truth for:
 *   • the service code that triggers provisioning,
 *   • the canonical ten phases and their order/titles,
 *   • the professional phase-state and workflow-status unions,
 * so the database seed (migration), the provisioning service and the Work-tab
 * left navigation all agree.
 */

/** The catalogue code (hsdg.services.code) that identifies Statutory Audit. */
export const STATUTORY_AUDIT_SERVICE_CODE = 'STAT_AUDIT' as const;

/** The machine key of the workflow this service instantiates. */
export const STATUTORY_AUDIT_WORKFLOW_KEY = 'statutory_audit' as const;

/**
 * The methodology/template version frozen onto a shell at creation (§7, §37).
 * Bump this when the phase model changes; existing files keep the version they
 * were created with, so historical audit files stay reproducible.
 */
export const STATUTORY_AUDIT_TEMPLATE_VERSION = 'v1.0' as const;

/**
 * Professional state of an audit-file phase (§8). NOT a task status: `locked`
 * (a downstream phase gated until its predecessor is approved) and
 * `needs_attention` (an actionable professional issue) are first-class states,
 * not merely "todo/done". A progress bar is informational and never replaces
 * these controls (§31).
 */
export const AUDIT_PHASE_STATE = {
  complete: 'complete',
  inProgress: 'in_progress',
  notStarted: 'not_started',
  needsAttention: 'needs_attention',
  locked: 'locked',
} as const;
export type AuditPhaseState = (typeof AUDIT_PHASE_STATE)[keyof typeof AUDIT_PHASE_STATE];

/** Lifecycle status of the workflow shell as a whole. */
export const AUDIT_WORKFLOW_STATUS = {
  active: 'active',
  onHold: 'on_hold',
  completed: 'completed',
  archived: 'archived',
  cancelled: 'cancelled',
} as const;
export type AuditWorkflowStatus =
  (typeof AUDIT_WORKFLOW_STATUS)[keyof typeof AUDIT_WORKFLOW_STATUS];

/** Stable machine keys for the ten phases (§8). */
export const AUDIT_PHASE_KEY = {
  acceptance: 'acceptance',
  framework: 'framework',
  planning: 'planning',
  risk: 'risk',
  controls: 'controls',
  auditAreas: 'audit_areas',
  completion: 'completion',
  reporting: 'reporting',
  signOff: 'sign_off',
  archiving: 'archiving',
} as const;
export type AuditPhaseKey = (typeof AUDIT_PHASE_KEY)[keyof typeof AUDIT_PHASE_KEY];

/** A phase in the canonical catalogue: its number, key, title and initial state. */
export interface AuditPhaseDefinition {
  phaseNo: number;
  phaseKey: AuditPhaseKey;
  title: string;
  /** State a freshly provisioned shell starts this phase in (§5, §7). */
  initialState: AuditPhaseState;
}

/**
 * The canonical ten audit-file phases, in order (§8). Provisioning seeds exactly
 * these rows; the Work-tab left panel renders them.
 *
 * Initial states follow the DHVAJ Implementation Guide §8.2: Section 01
 * (Acceptance) is a real workflow, so it opens `in_progress`, and Framework is
 * `locked` until the Engagement Partner approves acceptance (which unlocks it).
 * Planning is available-but-not-started, and everything downstream is locked
 * until its predecessor is approved (progressive unlock in later SA phases).
 * Locks are never a permission statement — RLS is (§35). (Shells provisioned
 * before this change keep their seeded states; the gate is backward-compatible
 * because it only blocks a Framework whose phase is still `locked`.)
 */
export const AUDIT_PHASES: readonly AuditPhaseDefinition[] = [
  { phaseNo: 1, phaseKey: 'acceptance', title: 'Engagement & Acceptance', initialState: 'in_progress' },
  { phaseNo: 2, phaseKey: 'framework', title: 'Audit Framework', initialState: 'locked' },
  { phaseNo: 3, phaseKey: 'planning', title: 'Planning', initialState: 'not_started' },
  { phaseNo: 4, phaseKey: 'risk', title: 'Risk Assessment', initialState: 'locked' },
  { phaseNo: 5, phaseKey: 'controls', title: 'Internal Controls / IFC', initialState: 'locked' },
  { phaseNo: 6, phaseKey: 'audit_areas', title: 'Audit Areas', initialState: 'locked' },
  { phaseNo: 7, phaseKey: 'completion', title: 'Completion', initialState: 'locked' },
  { phaseNo: 8, phaseKey: 'reporting', title: 'Reporting', initialState: 'locked' },
  { phaseNo: 9, phaseKey: 'sign_off', title: 'Partner Sign-off', initialState: 'locked' },
  { phaseNo: 10, phaseKey: 'archiving', title: 'Archiving', initialState: 'locked' },
] as const;

/** One phase of a live audit-file shell. */
export interface AuditWorkflowPhase {
  id: string;
  phaseNo: number;
  phaseKey: AuditPhaseKey;
  title: string;
  state: AuditPhaseState;
  sortOrder: number;
}

/**
 * A statutory-audit workflow shell for one service instance, with its phases —
 * the shape the Services readiness strip and the Work-tab left navigation read.
 */
export interface StatutoryAuditWorkflow {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  workflowKey: string;
  templateVersion: string;
  status: AuditWorkflowStatus;
  phases: AuditWorkflowPhase[];
}
