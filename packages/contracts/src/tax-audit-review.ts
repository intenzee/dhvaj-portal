/**
 * Tax Audit review and observations register (Phase 5, F-7).
 *
 * The 3CD is reviewed Senior, then Manager, then the signing Partner. Each
 * level signs off once its own review points are cleared. Anything that may
 * need reporting is flagged into the observations register; the signing
 * Partner decides which become qualifications or observations in the report.
 * Open review points, unconfirmed portal drafts, unsettled clauses and
 * undecided flags block signing.
 */
import { compareClauseNo } from './tax-audit-clauses';
import type { TaxAuditStage } from './tax-audits';

export const TAX_AUDIT_REVIEW_LEVELS = ['senior', 'manager', 'partner'] as const;
export type TaxAuditReviewLevel = (typeof TAX_AUDIT_REVIEW_LEVELS)[number];

export const TAX_AUDIT_REVIEW_LEVEL_LABEL: Record<TaxAuditReviewLevel, string> = {
  senior: 'Senior review',
  manager: 'Manager review',
  partner: 'Signing Partner review',
};

export const TAX_AUDIT_REVIEW_POINT_STATUSES = ['open', 'responded', 'cleared'] as const;
export type TaxAuditReviewPointStatus = (typeof TAX_AUDIT_REVIEW_POINT_STATUSES)[number];

export const TAX_AUDIT_REVIEW_POINT_STATUS_LABEL: Record<TaxAuditReviewPointStatus, string> = {
  open: 'Open',
  responded: 'Responded',
  cleared: 'Cleared',
};

export const TAX_AUDIT_OBSERVATION_STATUSES = ['proposed', 'accepted', 'dropped'] as const;
export type TaxAuditObservationStatus = (typeof TAX_AUDIT_OBSERVATION_STATUSES)[number];

export const TAX_AUDIT_OBSERVATION_KINDS = ['qualification', 'observation'] as const;
export type TaxAuditObservationKind = (typeof TAX_AUDIT_OBSERVATION_KINDS)[number];

export const TAX_AUDIT_OBSERVATION_KIND_LABEL: Record<TaxAuditObservationKind, string> = {
  qualification: 'Qualification',
  observation: 'Observation',
};

/** Lower levels first: a level ranks above every level before it. */
export const reviewLevelRank = (l: TaxAuditReviewLevel): number =>
  TAX_AUDIT_REVIEW_LEVELS.indexOf(l);

/** The first level in the chain not yet signed off; null when the chain is complete. */
export function nextReviewLevel(
  signedOff: readonly TaxAuditReviewLevel[],
): TaxAuditReviewLevel | null {
  return TAX_AUDIT_REVIEW_LEVELS.find((l) => !signedOff.includes(l)) ?? null;
}

const clauses = (list: readonly string[]): string => [...list].sort(compareClauseNo).join(', ');
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** What stops the 3CD going for review: every clause done or Not applicable. */
export function startReviewBlockers(unsettled: readonly string[]): string[] {
  return unsettled.length ? [`Finish clause ${clauses(unsettled)} first.`] : [];
}

/** What stops the signing Partner signing the report; empty when it may be signed. */
export function signingBlockers(p: {
  unsettled: readonly string[];
  unconfirmedDrafts: readonly string[];
  openPoints: number;
  undecided: number;
  partnerSignedOff: boolean;
}): string[] {
  const out = startReviewBlockers(p.unsettled);
  if (p.unconfirmedDrafts.length) {
    out.push(`Confirm the portal draft on clause ${clauses(p.unconfirmedDrafts)}.`);
  }
  if (p.openPoints) {
    out.push(`Clear ${plural(p.openPoints, 'open review point', 'open review points')}.`);
  }
  if (p.undecided) {
    out.push(`Decide ${plural(p.undecided, 'flagged matter', 'flagged matters')} for the report.`);
  }
  if (!p.partnerSignedOff) out.push('The signing Partner has not signed off the review.');
  return out;
}

/**
 * The accepted entries as the report lists them: qualifications first, then
 * observations, each in clause order (matters on the report as a whole first).
 */
export function reportObservations<
  T extends {
    status: TaxAuditObservationStatus;
    kind: TaxAuditObservationKind | null;
    clauseNo: string | null;
  },
>(list: readonly T[]): T[] {
  const kindRank = (k: TaxAuditObservationKind | null): number => (k === 'qualification' ? 0 : 1);
  return list
    .filter((o) => o.status === 'accepted')
    .sort(
      (a, b) =>
        kindRank(a.kind) - kindRank(b.kind) ||
        (a.clauseNo === null ? -1 : 0) - (b.clauseNo === null ? -1 : 0) ||
        compareClauseNo(a.clauseNo ?? '', b.clauseNo ?? ''),
    );
}

export interface TaxAuditReviewSignoff {
  level: TaxAuditReviewLevel;
  employeeId: string;
  employeeName: string | null;
  signedOffAt: string;
}

export interface TaxAuditReviewPoint {
  id: string;
  workingPaperId: string | null;
  clauseNo: string | null;
  level: TaxAuditReviewLevel;
  body: string;
  status: TaxAuditReviewPointStatus;
  raisedByName: string | null;
  raisedAt: string;
  response: string | null;
  respondedByName: string | null;
  respondedAt: string | null;
  clearedByName: string | null;
  clearedAt: string | null;
  canRespond: boolean;
  canClear: boolean;
  version: number;
}

export interface TaxAuditObservation {
  id: string;
  workingPaperId: string | null;
  clauseNo: string | null;
  wording: string;
  status: TaxAuditObservationStatus;
  kind: TaxAuditObservationKind | null;
  decisionNote: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  raisedByName: string | null;
  createdAt: string;
  canEdit: boolean;
  version: number;
}

export interface TaxAuditReview {
  auditId: string;
  engagementId: string;
  financialYear: string;
  stage: TaxAuditStage;
  signingPartnerId: string | null;
  signingPartnerName: string | null;
  /** The chain in order, each with its active sign-off. */
  chain: { level: TaxAuditReviewLevel; signoff: TaxAuditReviewSignoff | null }[];
  points: TaxAuditReviewPoint[];
  observations: TaxAuditObservation[];
  /** What the report will list: accepted entries in report order. */
  report: TaxAuditObservation[];
  unsettledClauses: string[];
  unconfirmedDrafts: string[];
  startBlockers: string[];
  signingBlockers: string[];
  /** The level the viewer reviews at; null for someone who does not review. */
  myLevel: TaxAuditReviewLevel | null;
  canStart: boolean;
  /** The level the viewer may sign off now, if any. */
  canSignOff: TaxAuditReviewLevel | null;
  /** The signing Partner: decides what goes into the report. */
  canDecide: boolean;
  /** Whether the review can still change (the report is not yet signed). */
  editable: boolean;
  version: number;
}

export interface SignOffTaxAuditReviewInput {
  level: TaxAuditReviewLevel;
  version: number;
}

export interface RaiseTaxAuditReviewPointInput {
  body: string;
  /** Leave out for a point on the report as a whole. */
  workingPaperId?: string;
}

export interface RespondTaxAuditReviewPointInput {
  response: string;
  version: number;
}

export interface FlagTaxAuditObservationInput {
  wording: string;
  workingPaperId?: string;
}

export interface EditTaxAuditObservationInput {
  wording: string;
  version: number;
}

export interface DecideTaxAuditObservationInput {
  outcome: TaxAuditObservationKind | 'dropped';
  note?: string;
  version: number;
}
