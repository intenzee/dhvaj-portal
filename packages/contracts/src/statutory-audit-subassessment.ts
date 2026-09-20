/**
 * Shared per-sub-section assessment model for Section 02.2–02.7 (Implementation
 * Guide §6, §7). Rather than eight near-identical tables, ONE
 * `audit_framework_subassessment` table holds every sub-section's engine output
 * and professional conclusion, keyed by `(workflowInstanceId, subSectionKey,
 * areaKey)` and discriminated by `subSectionKey`. The 02.8 dashboard aggregates
 * across it.
 *
 * It reuses the §19 {@link FrameworkState} model and the suggestion-vs-conclusion
 * rule (guide §1/§3): the engine emits `{ systemOutcome, systemBasis, ... }`; the
 * professional records a `conclusion`; an override keeps BOTH plus a mandatory
 * basis. Every conclusion driven by a rule freezes the `ruleVersionId` and cites
 * an `authorityProvisionId` for `View Provision`.
 */

import type { FrameworkState } from './statutory-audit-framework';

/** The Section 02 sub-sections that own a sub-assessment. */
export const SUB_SECTION_KEY = {
  financialReporting: '02.2',
  scheduleIii: '02.3',
  caro: '02.4',
  icfr: '02.5',
  consolidation: '02.6',
  otherReporting: '02.7',
} as const;
export type SubSectionKey = (typeof SUB_SECTION_KEY)[keyof typeof SUB_SECTION_KEY];

/**
 * The generic sub-assessment record. `systemOutcome` / `conclusion` are
 * sub-section-specific outcome strings (each sub-section defines its own union);
 * `systemDetail` carries structured extras (facts used, sub-status, phase, …).
 */
export interface FrameworkSubAssessment {
  id: string;
  subSectionKey: SubSectionKey;
  areaKey: string;
  title: string;
  state: FrameworkState;
  /** The engine's advisory outcome (a sub-section-specific string), if computed. */
  systemOutcome: string | null;
  systemBasis: string | null;
  /** Structured engine extras: `{ factsUsed, subStatus, phaseThreshold, … }`. */
  systemDetail: unknown | null;
  /** The rule version frozen onto the conclusion, when a library rule drove it. */
  ruleVersionId: string | null;
  /** The provision the conclusion rests on, for `View Provision`. */
  authorityProvisionId: string | null;
  /** The professional conclusion (a sub-section-specific outcome string). */
  conclusion: string | null;
  /** True when the conclusion differs from the system outcome (basis required). */
  isOverridden: boolean;
  basis: string | null;
  impact: string | null;
  /** Sub-section-specific captured facts not held by 02.1/masters. */
  facts: unknown | null;
  needsReevaluation: boolean;
  decidedByName: string | null;
  decidedAt: string | null;
  version: number;
}
