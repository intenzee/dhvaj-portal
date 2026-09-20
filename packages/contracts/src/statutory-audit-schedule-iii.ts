/**
 * 02.3 — Schedule III & Presentation Framework (Implementation Guide §9.3).
 *
 * Decides the applicable Schedule III **Division** (I = Accounting Standards,
 * II = Ind AS non-NBFC, III = Ind AS NBFC) — or a **specialised statutory
 * format** for a bank / insurer / regulated entity — by routing from the 02.2
 * reporting-framework conclusion (never re-deciding it). It then derives the
 * required FS components, the cash-flow requirement/exemption (which **consumes**
 * the 02.1 OPC / small-company / dormant classifications — never re-asked), the
 * rounding framework, and the disclosure library.
 *
 * NO statutory number lives in code (guide §1): the Schedule III rounding
 * turnover band resolves from the Audit Rules Library through the injected
 * `RuleResolver`, and the Division cites its Schedule III provision **version by
 * audit period**, so a historical engagement freezes the version in force then.
 * The disclosure list is rule-required baseline + fact-triggered items — a zero
 * balance never suppresses a rule-required disclosure (guide §9.3 Output).
 */

import type { FrameworkState } from './statutory-audit-framework';
import type { FrameworkSubAssessment } from './statutory-audit-subassessment';
import type { ReportingFrameworkOutcome } from './statutory-audit-financial-reporting';

/** The Schedule III presentation framework the engine concludes (§9.3). */
export const SCHEDULE_III_OUTCOME = {
  /** Division I — Accounting Standards. */
  divisionI: 'division_i',
  /** Division II — Ind AS, non-NBFC. */
  divisionII: 'division_ii',
  /** Division III — Ind AS, NBFC. */
  divisionIII: 'division_iii',
  /** Bank / insurer / regulated — a specialised statutory format applies (no Division forced). */
  specialisedFormat: 'specialised_format',
  /** 02.2 is not concluded yet, or a deciding fact is absent — never a guess (guide §4.3). */
  informationInsufficient: 'information_insufficient',
  /** The system cannot safely decide; a professional must. */
  professionalReview: 'professional_review_required',
} as const;
export type ScheduleIiiOutcome =
  (typeof SCHEDULE_III_OUTCOME)[keyof typeof SCHEDULE_III_OUTCOME];
export const SCHEDULE_III_OUTCOMES: ScheduleIiiOutcome[] = Object.values(SCHEDULE_III_OUTCOME);

/** Outcomes a professional may record as the conclusion (decisive ones only). */
export const SCHEDULE_III_CONCLUSIONS: ScheduleIiiOutcome[] = [
  SCHEDULE_III_OUTCOME.divisionI,
  SCHEDULE_III_OUTCOME.divisionII,
  SCHEDULE_III_OUTCOME.divisionIII,
  SCHEDULE_III_OUTCOME.specialisedFormat,
];

/** A financial-statement component Schedule III requires. */
export const FS_COMPONENT = {
  balanceSheet: 'balance_sheet',
  statementOfProfitAndLoss: 'statement_of_profit_and_loss',
  cashFlowStatement: 'cash_flow_statement',
  statementOfChangesInEquity: 'statement_of_changes_in_equity',
  notes: 'notes_to_accounts',
} as const;
export type FsComponent = (typeof FS_COMPONENT)[keyof typeof FS_COMPONENT];
export const FS_COMPONENTS: FsComponent[] = Object.values(FS_COMPONENT);

/**
 * The normalised facts the 02.3 engine reads. Every one is assembled server-side
 * from the confirmed 02.1 profile and the concluded 02.2 assessment — 02.3
 * captures nothing of its own (guide §1 capture-once).
 */
export interface ScheduleIiiFacts {
  /** The 02.2 reporting-framework conclusion that routes the Division (null ⇒ 02.2 not concluded). */
  reportingFramework: ReportingFrameworkOutcome | null;
  /** NBFC/HFC (02.1) — routes Ind AS to Division III. */
  isNbfc: boolean;
  /** Bank / insurer (02.1) — a specialised statutory format applies. */
  isBankOrInsurance: boolean;
  /** One Person Company (02.1 entity type) — cash-flow exemption input (§2(40) proviso). */
  isOpc: boolean;
  /** Small company per the confirmed 02.1 §2(85) assessment — cash-flow exemption input. */
  isSmallCompany: boolean;
  /** Dormant company (02.1 special entity) — cash-flow exemption input. */
  isDormant: boolean;
  /** First-time Ind AS (02.2 detail) — triggers the Ind AS 101 reconciliation disclosure. */
  firstTimeIndAs: boolean;
  /** Turnover (02.1) — selects the Schedule III rounding band. */
  turnover: number | null;
}

/** Structured engine extras stored in `systemDetail`. */
export interface ScheduleIiiDetail {
  /** The concluded Division, or null for a specialised/insufficient outcome. */
  division: ScheduleIiiOutcome | null;
  /** The Schedule III provision code the Division cites (`SCH_III_DIV_*`), or null. */
  divisionProvisionCode: string | null;
  /** Whether a Cash Flow Statement is required, after the §2(40) exemption test. */
  cashFlowRequired: boolean;
  /** Why the cash-flow statement is exempt (OPC / small / dormant), or null when required. */
  cashFlowExemptionReason: string | null;
  /** The §2(40) proviso provision id, frozen by the service when the exemption applies. */
  cashFlowProvisionId: string | null;
  /** The FS components the framework requires. */
  requiredComponents: FsComponent[];
  /** The Schedule III rounding turnover band threshold (rupees), resolved from the library. */
  roundingThreshold: number | null;
  /** The presentation rounding units permitted for the entity's turnover band. */
  roundingUnits: string[];
  /** Rule-required baseline + fact-triggered disclosures (labels) — never balance-suppressed. */
  disclosures: string[];
}

/** The result of the pure 02.3 engine (guide §7 signature). */
export interface ScheduleIiiResult {
  outcome: ScheduleIiiOutcome;
  state: FrameworkState;
  basis: string;
  /** The Schedule III rounding rule version frozen onto the conclusion, when resolved. */
  ruleVersionId: string | null;
  /** The Division's Schedule III provision (period-correct), frozen by the service. */
  authorityProvisionId: string | null;
  detail: ScheduleIiiDetail;
}

/**
 * The 02.3 read shape for one statutory-audit workflow instance: the shared
 * sub-assessment plus the typed 02.3 detail and the base facts the engine used.
 */
export interface StatutoryAuditScheduleIii {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  assessment: FrameworkSubAssessment;
  /** Typed view of the engine's structured detail (Division / components / rounding). */
  detail: ScheduleIiiDetail | null;
  /** The base facts assembled from confirmed 02.1 + concluded 02.2 (read-only display). */
  baseFacts: ScheduleIiiFacts;
  /** True once 02.1 is confirmed AND 02.2 concluded — 02.3 routes from their frozen outputs. */
  upstreamReady: boolean;
}

/** Record the professional conclusion for 02.3 (override needs a basis, §19). */
export interface RecordScheduleIiiDecisionInput {
  conclusion: ScheduleIiiOutcome;
  basis?: string | null;
  impact?: string | null;
  version: number;
}
