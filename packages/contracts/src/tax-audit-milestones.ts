/**
 * Tax audit milestones and the firm board (Phase 5, F-9).
 *
 * The firm works each tax audit to internal dates counted back from the
 * report's statutory due date (override, then CBDT extension, then statute),
 * so a slip shows weeks early, not on the last day (plan F.4). The offsets are
 * the firm's, in Workflow settings. A missed milestone puts the audit on its
 * owner's Today under Overdue and on the firm board as At risk; after the due
 * date the board shows each late audit's s.271B exposure.
 */
import type { TaxAuditStage } from './tax-audits';
import { TAX_AUDIT_STAGES } from './tax-audits';

export const TAX_AUDIT_MILESTONES = [
  'applicability',
  'accepted',
  'info_requests',
  'info_received',
  'clause_work',
  'review',
  'signed',
  'uploaded',
  'client_accepted',
] as const;
export type TaxAuditMilestoneKey = (typeof TAX_AUDIT_MILESTONES)[number];

export const TAX_AUDIT_MILESTONE_LABEL: Record<TaxAuditMilestoneKey, string> = {
  applicability: 'Applicability confirmed',
  accepted: 'Accepted, appointment letter signed',
  info_requests: 'Information requests sent',
  info_received: 'Client information received',
  clause_work: 'Clause work done',
  review: 'Review done',
  signed: 'Signed with UDIN',
  uploaded: 'Uploaded to the e-filing portal',
  client_accepted: 'Accepted by the client on the portal',
};

/** Whose milestone it is, by role on the audit. */
export type TaxAuditMilestoneRole = 'manager' | 'signing_partner' | 'senior';

export const TAX_AUDIT_MILESTONE_ROLE: Record<TaxAuditMilestoneKey, TaxAuditMilestoneRole> = {
  applicability: 'manager',
  accepted: 'signing_partner',
  info_requests: 'senior',
  info_received: 'senior',
  // "Articles and Senior": the articles work the clauses, the senior answers for the date.
  clause_work: 'senior',
  review: 'manager',
  signed: 'signing_partner',
  uploaded: 'senior',
  // The manager chases the client.
  client_accepted: 'manager',
};

export const TAX_AUDIT_MILESTONE_ROLE_LABEL: Record<TaxAuditMilestoneRole, string> = {
  manager: 'Manager',
  signing_partner: 'Signing Partner',
  senior: 'Senior',
};

/** Days before the statutory due date, one per milestone. */
export type TaxAuditMilestoneOffsets = Record<TaxAuditMilestoneKey, number>;

export const DEFAULT_TAX_AUDIT_MILESTONE_OFFSETS: TaxAuditMilestoneOffsets = {
  applicability: 90,
  accepted: 75,
  info_requests: 75,
  info_received: 60,
  clause_work: 30,
  review: 15,
  signed: 7,
  uploaded: 5,
  client_accepted: 2,
};

/** The most days before the due date a milestone may be set. */
export const TAX_AUDIT_MILESTONE_OFFSET_MAX = 365;

/**
 * The milestones someone ticks by hand, until their desk moves the stage
 * itself. The others follow their desk only: the applicability decision,
 * acceptance (with its COP and limit checks), signing, upload and the
 * client's acceptance.
 */
export const TAX_AUDIT_MILESTONE_TICKABLE: readonly TaxAuditMilestoneKey[] = [
  'info_requests',
  'info_received',
  'clause_work',
  'review',
];

/** The stage at which a milestone is behind the audit, done without a tick. */
const DONE_AT_STAGE: Record<TaxAuditMilestoneKey, TaxAuditStage> = {
  applicability: 'acceptance',
  accepted: 'information',
  info_requests: 'clause_work',
  info_received: 'clause_work',
  clause_work: 'review',
  review: 'signed',
  signed: 'signed',
  uploaded: 'uploaded',
  client_accepted: 'client_accepted',
};

/** A milestone's offsets, each kept to 0–max whole days; missing or bad ones take the default. */
export function taxAuditMilestoneOffsets(raw: unknown): TaxAuditMilestoneOffsets {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_TAX_AUDIT_MILESTONE_OFFSETS };
  for (const k of TAX_AUDIT_MILESTONES) {
    const v = src[k];
    if (
      typeof v === 'number' &&
      Number.isInteger(v) &&
      v >= 0 &&
      v <= TAX_AUDIT_MILESTONE_OFFSET_MAX
    ) {
      out[k] = v;
    }
  }
  return out;
}

/** ISO date `days` before `date` (calendar arithmetic, no time zone). */
export function isoDaysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** What the plan needs to know of an audit. */
export interface TaxAuditMilestoneFacts {
  stage: TaxAuditStage;
  /** The report's statutory due date; null: no filing on the calendar yet. */
  dueDate: string | null;
  /** The year's applicability decision is on record. */
  applicabilityDecided: boolean;
  acceptedAt: string | null;
  signedAt: string | null;
  /** Milestones ticked done by hand (or by a desk), with when. */
  ticked: Partial<Record<TaxAuditMilestoneKey, string>>;
}

export interface TaxAuditMilestonePlanItem {
  key: TaxAuditMilestoneKey;
  label: string;
  role: TaxAuditMilestoneRole;
  /** The internal date; null without a due date. */
  dueOn: string | null;
  done: boolean;
  /** Past its date (IST) and not done. */
  missed: boolean;
}

/**
 * The audit's milestones, in order. A milestone is done once ticked, or once
 * the stage is past it (and acceptance / signing by their own dates). Filed
 * audits have every milestone done; not-applicable ones have none to do.
 * Pure — shared by the API and web, and tested.
 */
export function taxAuditMilestonePlan(
  facts: TaxAuditMilestoneFacts,
  offsets: TaxAuditMilestoneOffsets,
  today: string,
): TaxAuditMilestonePlanItem[] {
  if (facts.stage === 'not_applicable') return [];
  const at = TAX_AUDIT_STAGES.indexOf(facts.stage);
  return TAX_AUDIT_MILESTONES.map((key) => {
    const done =
      Boolean(facts.ticked[key]) ||
      at >= TAX_AUDIT_STAGES.indexOf(DONE_AT_STAGE[key]) ||
      (key === 'applicability' && facts.applicabilityDecided) ||
      (key === 'accepted' && facts.acceptedAt !== null) ||
      (key === 'signed' && facts.signedAt !== null);
    const dueOn = facts.dueDate ? isoDaysBefore(facts.dueDate, offsets[key]) : null;
    return {
      key,
      label: TAX_AUDIT_MILESTONE_LABEL[key],
      role: TAX_AUDIT_MILESTONE_ROLE[key],
      dueOn,
      done,
      missed: !done && dueOn !== null && dueOn < today,
    };
  });
}

/** One milestone on the audit's Tax Audit tab (GET …/tax-audits/:auditId/milestones). */
export interface TaxAuditMilestone extends TaxAuditMilestonePlanItem {
  roleLabel: string;
  doneAt: string | null;
  doneByName: string | null;
  /** Who answers for it: the person named, else the role's person; null when nobody holds the role. */
  ownerId: string | null;
  ownerName: string | null;
  /** The firm named this person in place of the role's. */
  ownerNamed: boolean;
  /** The caller may tick it (or untick their tick) here. */
  canTick: boolean;
}

export interface TaxAuditMilestones {
  auditId: string;
  engagementId: string;
  financialYear: string;
  stage: TaxAuditStage;
  dueDate: string | null;
  milestones: TaxAuditMilestone[];
  /** The engagement's partner or manager: may name a milestone's owner. */
  canNameOwners: boolean;
}

/** PUT …/milestones/:milestone — tick or untick it, and/or name its owner (null: back to the role). */
export interface SaveTaxAuditMilestoneInput {
  done?: boolean;
  ownerId?: string | null;
}

// ── s.271B ──────────────────────────────────────────────────────────────

/** s.271B: 0.5% of turnover or gross receipts, up to ₹1.5 lakh. */
export const TAX_AUDIT_PENALTY_RATE = 0.005;
export const TAX_AUDIT_PENALTY_CAP = 150_000;

/** The s.271B exposure for a late report, in whole rupees; null when turnover is unknown. */
export function section271BExposure(turnover: number | null): number | null {
  if (turnover === null || !Number.isFinite(turnover) || turnover < 0) return null;
  return Math.min(Math.round(turnover * TAX_AUDIT_PENALTY_RATE), TAX_AUDIT_PENALTY_CAP);
}

// ── The firm board (GET /tax-audits/board) ──────────────────────────────

/** Not started / In progress / Completed, as the board counts them. */
export type TaxAuditBoardBucket = 'not_started' | 'in_progress' | 'completed';

export function taxAuditBoardBucket(stage: TaxAuditStage): TaxAuditBoardBucket | null {
  if (stage === 'not_applicable') return null;
  if (stage === 'not_started') return 'not_started';
  if (stage === 'filed') return 'completed';
  return 'in_progress';
}

export interface TaxAuditBoardMiss {
  key: TaxAuditMilestoneKey;
  label: string;
  dueOn: string;
  ownerName: string | null;
}

export interface TaxAuditBoardRow {
  auditId: string;
  engagementId: string;
  engagementCode: string;
  entityName: string;
  stage: TaxAuditStage;
  dueDate: string | null;
  signingPartnerName: string | null;
  /** Missed milestones, earliest first. */
  missed: TaxAuditBoardMiss[];
  /** Days past the due date, unfiled; null when not late. */
  daysLate: number | null;
  /** Turnover or gross receipts the exposure is worked on; null when unknown. */
  turnover: number | null;
  /** s.271B exposure once late; null when not late or turnover is unknown. */
  exposure: number | null;
}

export interface TaxAuditBoardPartner {
  employeeId: string;
  name: string;
  reports: number;
  /** "Deepak: 41 of 60 for FY 2025-26". */
  summary: string;
}

export interface TaxAuditBoard {
  financialYear: string;
  /** IST date the board was read for. */
  today: string;
  counts: Record<TaxAuditBoardBucket, number>;
  byStage: Partial<Record<TaxAuditStage, number>>;
  /** Open audits with a missed milestone or past the due date, earliest due first. */
  atRisk: TaxAuditBoardRow[];
  /** Late audits' s.271B exposure, summed where turnover is known. */
  totalExposure: number;
  limit: number;
  partners: TaxAuditBoardPartner[];
}

/** The board is for the Managing Partner and Partners. */
export const TAX_AUDIT_BOARD_ROLES: readonly string[] = ['managing_partner', 'partner'];

export function canSeeTaxAuditBoard(role: string | null | undefined): boolean {
  return role != null && TAX_AUDIT_BOARD_ROLES.includes(role);
}
