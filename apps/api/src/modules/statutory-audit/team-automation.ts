/**
 * Statutory Audit — Team plans itself from the file (Audit Spec §21, §24, §37).
 *
 *   • Estimated hours — each procedure is weighted by its area's risk level
 *     (and more when it answers a significant risk); a person's estimate is
 *     the procedures they prepare, the areas they own, a share for what they
 *     review and the partner / manager file time. It becomes their planned
 *     hours until someone sets them.
 *   • Balance the work — the work automation leaves every procedure with the
 *     engagement manager. Not-started procedures still with the manager / EP
 *     (or with no one) are handed to the team: significant- or high-risk work
 *     to a senior or the in-charge, the rest spread by load. The EP reviews
 *     significant-risk work and the manager the rest (SA 220).
 *   • Flags — what needs attention on each person's work.
 *
 * Pure: no database, unit-tested on its own.
 */
import type { TeamBalanceMove, TeamFlag } from '@hsdg/contracts';

/** Preparer hours by the risk level of the procedure's audit area. */
export const RISK_HOURS: Record<string, number> = {
  low: 2,
  moderate: 4,
  high: 6,
  significant: 8,
};
/** A procedure in an area with no risk level set (e.g. a workstream programme). */
export const DEFAULT_PROCEDURE_HOURS = 3;
/** Extra for a procedure that answers a significant risk. */
export const SIGNIFICANT_RISK_EXTRA = 2;
/** Concluding an area. */
export const AREA_HOURS = 1;
/** Reviewing takes this share of the preparer's hours. */
export const REVIEW_SHARE = 0.15;
/** Planning, completion and sign-off time on the file. */
export const EP_FILE_HOURS = 4;
export const MANAGER_FILE_HOURS = 6;
/** Grade rank of a Senior (Article 40, Senior 60, Manager 80, Partner 100). */
export const SENIOR_RANK = 60;
export const MANAGER_RANK = 80;

export interface TeamProcedure {
  id: string;
  ref: string;
  title: string;
  state: string;
  ownerId: string | null;
  reviewerId: string | null;
  dueDate: string | null;
  /** Risk level of its audit area. */
  areaRisk: string | null;
  /** It answers a significant risk. */
  significant: boolean;
}

export interface TeamArea {
  id: string;
  ownerId: string | null;
}

export interface TeamPerson {
  employeeId: string;
  name: string;
  gradeRank: number | null;
  /** Role on the engagement (in_charge, member, reviewer, specialist) — null for leads. */
  role: string | null;
}

export interface TeamLeads {
  epId: string | null;
  managerId: string | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function procedureHours(p: Pick<TeamProcedure, 'areaRisk' | 'significant'>): number {
  const base = (p.areaRisk && RISK_HOURS[p.areaRisk]) || DEFAULT_PROCEDURE_HOURS;
  return base + (p.significant ? SIGNIFICANT_RISK_EXTRA : 0);
}

/** Hard work: answers a significant risk, or sits in a high / significant-risk area. */
export const isHard = (p: Pick<TeamProcedure, 'areaRisk' | 'significant'>): boolean =>
  p.significant || p.areaRisk === 'high' || p.areaRisk === 'significant';

/** A person's estimated hours on the file, with how it was worked out. */
export function estimateHours(
  employeeId: string,
  procedures: readonly TeamProcedure[],
  areas: readonly TeamArea[],
  leads: TeamLeads,
): { hours: number; basis: string | null } {
  const prepared = procedures.filter((p) => p.ownerId === employeeId);
  const reviewed = procedures.filter((p) => p.reviewerId === employeeId);
  const owned = areas.filter((a) => a.ownerId === employeeId);
  const prepHours = prepared.reduce((n, p) => n + procedureHours(p), 0);
  const reviewHours = round1(reviewed.reduce((n, p) => n + procedureHours(p), 0) * REVIEW_SHARE);
  const areaHours = owned.length * AREA_HOURS;
  const fileHours =
    employeeId === leads.epId
      ? EP_FILE_HOURS
      : employeeId === leads.managerId
        ? MANAGER_FILE_HOURS
        : 0;
  const parts = [
    prepared.length > 0 && `${prepared.length} procedure(s) (${prepHours}h)`,
    owned.length > 0 && `${owned.length} area(s) (${areaHours}h)`,
    reviewed.length > 0 && `reviewing ${reviewed.length} (${reviewHours}h)`,
    fileHours > 0 &&
      `${employeeId === leads.epId ? 'planning & sign-off' : 'planning & completion'} (${fileHours}h)`,
  ].filter(Boolean) as string[];
  return {
    hours: round1(prepHours + reviewHours + areaHours + fileHours),
    basis: parts.length ? `Estimated from ${parts.join(', ')}` : null,
  };
}

/**
 * "Balance the work": hand the not-started procedures still sitting with the
 * manager / EP (or no one) to the team by grade and load, and route review —
 * the EP reviews significant-risk work, the manager the rest. Only changes
 * that would actually move something are returned.
 */
export function planBalance(
  people: readonly TeamPerson[],
  procedures: readonly TeamProcedure[],
  leads: TeamLeads,
): TeamBalanceMove[] {
  const leadIds = new Set([leads.epId, leads.managerId].filter(Boolean) as string[]);
  const team = people.filter(
    (p) =>
      !leadIds.has(p.employeeId) &&
      (p.gradeRank == null || p.gradeRank < MANAGER_RANK) &&
      p.role !== 'reviewer' &&
      p.role !== 'specialist',
  );
  const name = (id: string | null): string | null =>
    id ? (people.find((p) => p.employeeId === id)?.name ?? null) : null;
  const moves: TeamBalanceMove[] = [];

  // Owners — by load, seniors for hard work.
  const load = new Map(team.map((p) => [p.employeeId, 0]));
  for (const p of procedures) {
    if (p.ownerId && load.has(p.ownerId) && p.state !== 'complete') {
      load.set(p.ownerId, load.get(p.ownerId)! + procedureHours(p));
    }
  }
  const movable = procedures
    .filter((p) => p.state === 'not_started' && (p.ownerId == null || leadIds.has(p.ownerId)))
    .sort((a, b) => procedureHours(b) - procedureHours(a) || a.ref.localeCompare(b.ref));
  const newOwner = new Map<string, string>();
  for (const p of movable) {
    const hard = isHard(p);
    const eligible = team.filter(
      (t) => !hard || (t.gradeRank ?? 0) >= SENIOR_RANK || t.role === 'in_charge',
    );
    if (eligible.length === 0) continue;
    const to = [...eligible].sort(
      (a, b) => load.get(a.employeeId)! - load.get(b.employeeId)! || a.name.localeCompare(b.name),
    )[0]!;
    load.set(to.employeeId, load.get(to.employeeId)! + procedureHours(p));
    newOwner.set(p.id, to.employeeId);
    moves.push({
      procedureId: p.id,
      ref: p.ref,
      title: p.title,
      field: 'owner',
      fromEmployeeId: p.ownerId,
      fromName: name(p.ownerId),
      toEmployeeId: to.employeeId,
      toName: to.name,
      reason: hard
        ? `${p.significant ? 'Significant-risk' : 'High-risk'} work — to a senior with the lightest load`
        : 'Spread by load',
    });
  }

  // Reviewers — EP on significant-risk work, manager on the rest.
  if (leads.epId && leads.managerId) {
    for (const p of procedures) {
      if (p.state !== 'not_started') continue;
      const owner = newOwner.get(p.id) ?? p.ownerId;
      const want = p.significant ? leads.epId : leads.managerId;
      // Nobody reviews their own work.
      if (p.reviewerId === want || owner === want) continue;
      if (p.reviewerId != null && !leadIds.has(p.reviewerId)) continue; // a person chose them
      moves.push({
        procedureId: p.id,
        ref: p.ref,
        title: p.title,
        field: 'reviewer',
        fromEmployeeId: p.reviewerId,
        fromName: name(p.reviewerId),
        toEmployeeId: want,
        toName: name(want) ?? (p.significant ? 'Engagement partner' : 'Engagement manager'),
        reason: p.significant
          ? 'The engagement partner reviews significant-risk work (SA 220)'
          : 'First-level review by the manager; the partner reviews significant risks',
      });
    }
  }
  return moves;
}

export interface FlagFacts {
  plannedHours: number;
  actualHours: number;
  ownedProcedures: number;
  ownedAreas: number;
  isLead: boolean;
  overdue: number;
  returned: number;
  notesToAnswer: number;
  waitingForTheirReview: number;
}

/** What needs attention on one person's work, most urgent first. */
export function memberFlags(f: FlagFacts): TeamFlag[] {
  const flags: TeamFlag[] = [];
  if (f.overdue > 0) flags.push({ key: 'overdue', label: `${f.overdue} overdue`, tone: 'danger' });
  if (f.plannedHours > 0 && f.actualHours > f.plannedHours) {
    flags.push({
      key: 'over_plan',
      label: `Over plan by ${round1(f.actualHours - f.plannedHours)}h`,
      tone: 'danger',
    });
  }
  if (f.returned > 0) {
    flags.push({ key: 'returned', label: `${f.returned} returned from review`, tone: 'warn' });
  }
  if (f.notesToAnswer > 0) {
    flags.push({ key: 'notes', label: `${f.notesToAnswer} note(s) to answer`, tone: 'warn' });
  }
  if (f.waitingForTheirReview > 0) {
    flags.push({
      key: 'to_review',
      label: `${f.waitingForTheirReview} waiting for their review`,
      tone: 'info',
    });
  }
  if (!f.isLead && f.ownedProcedures + f.ownedAreas === 0) {
    flags.push({ key: 'no_work', label: 'No work assigned', tone: 'info' });
  }
  return flags;
}
