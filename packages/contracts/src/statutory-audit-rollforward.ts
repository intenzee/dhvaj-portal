/**
 * Prior-year roll-forward for continuing audits (Implementation Guide §12).
 *
 * For a continuing audit (02.1 `initialAudit === false`), each Section 02
 * sub-section is roll-forward driven: the prior-year audit file's values sit
 * beside the current, stable classifications carry forward as System Suggested
 * (never silently final), monetary values refresh from current data, and changes
 * — listing, group, entity category, regulator/special entities, financial year,
 * accounting environment, and the framework / CARO / ICFR / CFS conclusions — are
 * highlighted. Any change that affects an already-decided downstream assessment
 * marks it `needs_reevaluation` (the existing reassessment mechanism, §13).
 *
 * This is pure comparison data; the service reads the prior-year file and applies
 * the carry-forward + re-evaluation flags.
 */

import type { FrameworkState } from './statutory-audit-framework';
import type { SubSectionKey } from './statutory-audit-subassessment';

/** The 02.1 profile facts tracked for change-highlighting between years (§12). */
export interface RollForwardProfileSnapshot {
  isListed: boolean;
  groupHasRelationships: boolean;
  entityCategory: string | null;
  specialEntityTypes: string[];
  financialYear: string | null;
  accountingEnvironment: string | null;
}

/** One profile field compared prior vs current. */
export interface RollForwardFieldChange {
  field: string;
  label: string;
  prior: string | null;
  current: string | null;
  changed: boolean;
}

/** One sub-section's prior-vs-current conclusion, with carry-forward eligibility. */
export interface RollForwardSection {
  subSectionKey: SubSectionKey;
  title: string;
  priorConclusion: string | null;
  priorState: FrameworkState | null;
  currentConclusion: string | null;
  currentState: FrameworkState;
  /** The conclusion changed between a decided prior year and a decided current year. */
  changed: boolean;
  /** A decided prior conclusion exists and the current section is not yet decided — eligible to carry. */
  carriedForward: boolean;
}

/** A prior sub-section conclusion (from the prior-year file). */
export interface PriorSection {
  subSectionKey: SubSectionKey;
  conclusion: string | null;
  state: FrameworkState;
}

/** A current sub-section conclusion (this year's file). */
export interface CurrentSection {
  subSectionKey: SubSectionKey;
  title: string;
  conclusion: string | null;
  state: FrameworkState;
}

/** The whole roll-forward comparison for one statutory-audit workflow instance. */
export interface RollForwardComparison {
  /** True when 02.1 marks this a continuing (not first-year) audit. */
  isContinuingAudit: boolean;
  /** True when a prior-year statutory-audit file was found for the entity. */
  hasPriorYear: boolean;
  priorEngagementId: string | null;
  priorFinancialYear: string | null;
  currentFinancialYear: string | null;
  profileChanges: RollForwardFieldChange[];
  sections: RollForwardSection[];
  /** Decided current sub-sections that a change marks for re-evaluation. */
  changedSections: SubSectionKey[];
}

/** The states in which a sub-section is considered decided (mirrors FRAMEWORK_DECIDED_STATES). */
const DECIDED: readonly FrameworkState[] = ['applicable', 'not_applicable', 'overridden', 'approved'];
function isDecided(state: FrameworkState | null): boolean {
  return state != null && DECIDED.includes(state);
}

/** Compare the tracked 02.1 profile facts between the prior and current year (§12). */
export function compareProfile(
  prior: RollForwardProfileSnapshot,
  current: RollForwardProfileSnapshot,
): RollForwardFieldChange[] {
  const yn = (b: boolean): string => (b ? 'Yes' : 'No');
  const field = (
    field: string,
    label: string,
    prior: string | null,
    current: string | null,
  ): RollForwardFieldChange => ({ field, label, prior, current, changed: prior !== current });
  return [
    field('isListed', 'Listing status', yn(prior.isListed), yn(current.isListed)),
    field('groupHasRelationships', 'Group relationships', yn(prior.groupHasRelationships), yn(current.groupHasRelationships)),
    field('entityCategory', 'Entity category', prior.entityCategory, current.entityCategory),
    field(
      'specialEntityTypes',
      'Regulator / special entity',
      [...prior.specialEntityTypes].sort().join(', ') || '—',
      [...current.specialEntityTypes].sort().join(', ') || '—',
    ),
    field('financialYear', 'Financial year', prior.financialYear, current.financialYear),
    field('accountingEnvironment', 'Accounting environment', prior.accountingEnvironment, current.accountingEnvironment),
  ];
}

/**
 * Build the per-section roll-forward view: for each current sub-section, sit its
 * prior conclusion beside it, mark a change when both years are decided and the
 * conclusion differs, and mark it carry-forward-eligible when the prior year is
 * decided but the current year is not yet.
 */
export function rollForwardSections(
  prior: PriorSection[],
  current: CurrentSection[],
): RollForwardSection[] {
  const priorByKey = new Map(prior.map((p) => [p.subSectionKey, p]));
  return current.map((c) => {
    const p = priorByKey.get(c.subSectionKey) ?? null;
    const priorDecided = isDecided(p?.state ?? null);
    const currentDecided = isDecided(c.state);
    return {
      subSectionKey: c.subSectionKey,
      title: c.title,
      priorConclusion: p?.conclusion ?? null,
      priorState: p?.state ?? null,
      currentConclusion: c.conclusion,
      currentState: c.state,
      changed: priorDecided && currentDecided && (p?.conclusion ?? null) !== c.conclusion,
      carriedForward: priorDecided && !currentDecided,
    };
  });
}

/**
 * The decided current sub-sections a change marks for re-evaluation: any section
 * whose own conclusion changed, plus — when any tracked profile fact changed —
 * every already-decided section (a profile change ripples downstream, §12).
 */
export function changedSections(
  profileChanges: RollForwardFieldChange[],
  sections: RollForwardSection[],
): SubSectionKey[] {
  const profileChanged = profileChanges.some((c) => c.changed);
  const keys = new Set<SubSectionKey>();
  for (const s of sections) {
    const decided = isDecided(s.currentState);
    if (s.changed) keys.add(s.subSectionKey);
    if (profileChanged && decided) keys.add(s.subSectionKey);
  }
  return [...keys];
}
