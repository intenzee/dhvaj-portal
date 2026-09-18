/**
 * Statutory Audit — Audit-Area Execution vocabulary (Audit Spec §9–§14).
 *
 * SA-3 generated the applicable work areas (the top of the §20 cascade). SA-5 is
 * the execution layer WITHIN each area: the professional procedures, the evidence
 * that supports them, and the exceptions they surface — plus the two reuse rules
 * that make an audit file coherent (§14, §22):
 *
 *   • A procedure is ONE source record that may support several areas
 *     ("Link Existing Procedure" → linked areas). Cross-referencing never
 *     duplicates the procedure.
 *   • Evidence is ONE source record that may support several procedures
 *     ("Link Evidence"). "Do the work once; use the evidence many times" (§9).
 *
 * A procedure also carries its own workpaper documentation (objective, assertions,
 * population/sampling, expected evidence, conclusion) — the §12 model collapses
 * the workpaper into the procedure it documents, matching the §11 area screen
 * that lists procedures directly under the area. Risk ↔ procedure two-way
 * navigation (§22) is realised by the optional `riskId` link.
 *
 * This module is the single source of truth for the SA-5 vocabulary and the
 * shapes the Audit-Area screen reads — shared by the pure engine, the services
 * and the screen.
 */

import type { RiskAssertion } from './statutory-audit-risk';

/**
 * Professional state of a procedure (§8/§31 state model, not a percentage). A
 * fresh procedure is `not_started`; `returned` is a reviewer bouncing it back.
 */
export const PROCEDURE_STATE = {
  notStarted: 'not_started',
  inProgress: 'in_progress',
  readyForReview: 'ready_for_review',
  returned: 'returned',
  complete: 'complete',
} as const;
export type ProcedureState = (typeof PROCEDURE_STATE)[keyof typeof PROCEDURE_STATE];

/** States in which a procedure carries real work (never silently discarded). */
export const PROCEDURE_PROGRESSED_STATES: readonly ProcedureState[] = [
  'in_progress',
  'ready_for_review',
  'returned',
  'complete',
];

/**
 * The assertion vocabulary a procedure addresses (§13, multi-select) — the same
 * canonical set as the risk register, so a risk's assertion maps 1:1 onto the
 * procedure that responds to it.
 */
export type ProcedureAssertion = RiskAssertion;

/** Sampling method for a testing procedure (§13 — "no universal sample size"). */
export const SAMPLING_METHOD = {
  random: 'random',
  systematic: 'systematic',
  judgemental: 'judgemental',
  monetaryUnit: 'monetary_unit',
  haphazard: 'haphazard',
  other: 'other',
} as const;
export type SamplingMethod = (typeof SAMPLING_METHOD)[keyof typeof SAMPLING_METHOD];

/** Kind of evidence supporting a procedure/result (§12). */
export const EVIDENCE_KIND = {
  document: 'document',
  confirmation: 'confirmation',
  analysis: 'analysis',
  external: 'external',
  recalculation: 'recalculation',
  observation: 'observation',
  inquiry: 'inquiry',
  other: 'other',
} as const;
export type EvidenceKind = (typeof EVIDENCE_KIND)[keyof typeof EVIDENCE_KIND];

/** Exception severity (§12 — deviation, error, unresolved matter or finding). */
export const EXCEPTION_SEVERITY = {
  low: 'low',
  medium: 'medium',
  high: 'high',
} as const;
export type ExceptionSeverity = (typeof EXCEPTION_SEVERITY)[keyof typeof EXCEPTION_SEVERITY];

/** Exception disposition (§12; `carried_forward` feeds Completion / SA-8). */
export const EXCEPTION_STATUS = {
  open: 'open',
  resolved: 'resolved',
  carriedForward: 'carried_forward',
} as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUS)[keyof typeof EXCEPTION_STATUS];

/** Whether an area conclusion is a working draft or submitted for review (§11). */
export const AREA_CONCLUSION_STATE = {
  draft: 'draft',
  submitted: 'submitted',
} as const;
export type AreaConclusionState =
  (typeof AREA_CONCLUSION_STATE)[keyof typeof AREA_CONCLUSION_STATE];

/** Professional risk level of an audit area (mirrors the risk-register ratings). */
export const AREA_RISK_LEVEL = {
  low: 'low',
  moderate: 'moderate',
  high: 'high',
  significant: 'significant',
} as const;
export type AreaRiskLevel = (typeof AREA_RISK_LEVEL)[keyof typeof AREA_RISK_LEVEL];

/** A lightweight reference to an audit area a procedure is linked to (§14). */
export interface ProcedureAreaLink {
  workAreaId: string;
  workAreaKey: string;
  title: string;
  /** True for the procedure's home (originating) area; linked reuse otherwise. */
  isPrimary: boolean;
}

/** A piece of evidence, reusable across procedures (§9, §12). */
export interface AuditEvidence {
  id: string;
  title: string;
  kind: EvidenceKind;
  /** The linked DHVAJ document (M365/SharePoint metadata), when the source is a file. */
  documentId: string | null;
  note: string | null;
  addedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An exception raised while performing a procedure (§12). */
export interface AuditException {
  id: string;
  description: string;
  severity: ExceptionSeverity;
  status: ExceptionStatus;
  resolution: string | null;
  raisedByName: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** A professional procedure with its workpaper documentation (§11–§14). */
export interface AuditProcedure {
  id: string;
  procedureRef: string;
  /** The home area this procedure was created under. */
  workAreaId: string;
  title: string;
  objective: string | null;
  assertions: ProcedureAssertion[];
  /** The risk this procedure responds to, when it is a risk response (§22). */
  riskId: string | null;
  riskRef: string | null;
  population: string | null;
  samplingMethod: SamplingMethod | null;
  sampleSize: number | null;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  reviewerEmployeeId: string | null;
  reviewerName: string | null;
  dueDate: string | null;
  expectedEvidence: string | null;
  conclusion: string | null;
  state: ProcedureState;
  /** Every area this procedure supports — home first, then linked reuse (§14). */
  linkedAreas: ProcedureAreaLink[];
  evidence: AuditEvidence[];
  exceptions: AuditException[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The professional detail overlaid on a generated work area for the §11 area
 * screen — ownership, risk, materiality, timing, financial data and conclusion.
 * These live on the work-area row and are preserved across framework
 * regeneration (the SA-3 upsert never touches them).
 */
export interface AuditAreaDetail {
  ownerEmployeeId: string | null;
  ownerName: string | null;
  reviewerEmployeeId: string | null;
  reviewerName: string | null;
  riskLevel: AreaRiskLevel | null;
  materiality: number | null;
  dueDate: string | null;
  financialCurrent: number | null;
  financialPrior: number | null;
  /** (current − prior) / |prior| as a fraction, when both are present (§11). */
  financialMovement: number | null;
  financialSource: string | null;
  conclusion: string | null;
  conclusionState: AreaConclusionState;
  /** Optimistic-concurrency version for the area-detail edit. */
  detailVersion: number;
}

/**
 * The execution layer of one statutory-audit shell — the procedures (with their
 * linked areas, evidence and exceptions) the Audit-Area screen reads (§11–§14).
 */
export interface StatutoryAuditProcedures {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  procedures: AuditProcedure[];
}

/**
 * The next human-facing procedure reference ("P1", "P2", …) for an engagement,
 * one past the highest existing P<n>. Pure so the ref numbering is unit-tested.
 */
export function nextProcedureRef(existingRefs: readonly string[]): string {
  let max = 0;
  for (const ref of existingRefs) {
    const m = /^P(\d+)$/.exec(ref.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `P${max + 1}`;
}

/** The financial movement fraction between current and prior (§11), or null. */
export function financialMovement(
  current: number | null,
  prior: number | null,
): number | null {
  if (current == null || prior == null || prior === 0) return null;
  return (current - prior) / Math.abs(prior);
}

/**
 * Whether a procedure may be marked `complete` (§13 — a conclusion is required
 * before completion). Returns the blocking reason, or null when it may complete.
 */
export function procedureCompletionBlock(input: {
  objective: string | null;
  conclusion: string | null;
  openExceptions: number;
}): string | null {
  if (!input.objective || input.objective.trim().length === 0) {
    return 'An objective is required before completing a procedure.';
  }
  if (!input.conclusion || input.conclusion.trim().length === 0) {
    return 'A conclusion is required before completing a procedure.';
  }
  if (input.openExceptions > 0) {
    return `Resolve or carry forward ${input.openExceptions} open exception(s) before completing.`;
  }
  return null;
}
