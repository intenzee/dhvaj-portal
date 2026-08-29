/**
 * Compliance vocabulary (Phase 8) shared by the API and web.
 *
 * Compliance rules are configurable, effective-dated, and versioned; instances
 * snapshot the rule version used to calculate them, so changing a future rule
 * never rewrites history. Two clocks are tracked separately: the STATUTORY
 * deadline and the HSDG INTERNAL SLA.
 */

/** How a compliance deadline's base (reference) date is derived. */
export const CALCULATION_BASIS = {
  /** Financial-year end (derived from the engagement's financial year). */
  fyEnd: 'fy_end',
  /** End of the compliance period (supplied per instance). */
  periodEnd: 'period_end',
  /** Start of the compliance period (supplied per instance) — for start-anchored
   *  deadlines (PERIOD_START_PLUS_DAYS, §4). */
  periodStart: 'period_start',
  /** End of a month (supplied per instance). */
  monthEnd: 'month_end',
  /** A recurring fixed date (month + day) in the relevant year. */
  fixedDate: 'fixed_date',
  /** An event date supplied per instance (e.g. notice received). */
  eventDate: 'event_date',
} as const;
export type CalculationBasis = (typeof CALCULATION_BASIS)[keyof typeof CALCULATION_BASIS];
export const CALCULATION_BASES: CalculationBasis[] = Object.values(CALCULATION_BASIS);

/** How a computed date is nudged off weekends/holidays. */
export const WORKING_DAY_ADJUSTMENT = {
  none: 'none',
  next: 'next',
  previous: 'previous',
} as const;
export type WorkingDayAdjustment =
  (typeof WORKING_DAY_ADJUSTMENT)[keyof typeof WORKING_DAY_ADJUSTMENT];
export const WORKING_DAY_ADJUSTMENTS: WorkingDayAdjustment[] =
  Object.values(WORKING_DAY_ADJUSTMENT);

/** Status of a compliance obligation. "Overdue" is derived (open + past deadline). */
export const COMPLIANCE_STATUS = {
  open: 'open',
  completed: 'completed',
  waived: 'waived',
} as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUS)[keyof typeof COMPLIANCE_STATUS];
export const COMPLIANCE_STATUSES: ComplianceStatus[] = Object.values(COMPLIANCE_STATUS);

/** The two independent clocks an override may target. */
export const COMPLIANCE_CLOCK = {
  statutory: 'statutory',
  internalSla: 'internal_sla',
} as const;
export type ComplianceClock = (typeof COMPLIANCE_CLOCK)[keyof typeof COMPLIANCE_CLOCK];
export const COMPLIANCE_CLOCKS: ComplianceClock[] = Object.values(COMPLIANCE_CLOCK);

/** Broad statutory category a rule belongs to. */
export const COMPLIANCE_CATEGORY = {
  incomeTax: 'income_tax',
  gst: 'gst',
  tds: 'tds',
  roc: 'roc',
  audit: 'audit',
  other: 'other',
} as const;
export type ComplianceCategory = (typeof COMPLIANCE_CATEGORY)[keyof typeof COMPLIANCE_CATEGORY];
export const COMPLIANCE_CATEGORIES: ComplianceCategory[] = Object.values(COMPLIANCE_CATEGORY);

/**
 * Frozen Due-Date CATEGORY (Due-Date Classification spec §2) — HOW a deadline is
 * generated. This is a separate axis from {@link COMPLIANCE_CATEGORY} (which is
 * the statutory DOMAIN: income-tax / GST / …). Every compliance rule and every
 * catalogue component carries one, so the calendar engine treats each obligation
 * by its generation model rather than as a generic date-and-repeat.
 *
 * The set is closed and stable ("frozen") — adding a category is a deliberate,
 * migration-backed change, never ad-hoc. Codes are the spec's own UPPER_SNAKE.
 */
export const DUE_DATE_CATEGORY = {
  /** Recurring legal obligation with fixed calendar logic (e.g. a fixed return date). */
  statutoryFixed: 'STATUTORY_FIXED',
  /** Legal deadline calculated from facts/rules (e.g. taxpayer-dependent tax deadline). */
  statutoryRule: 'STATUTORY_RULE',
  /** Legal deadline triggered by an event (e.g. response after a notice/order). */
  statutoryEvent: 'STATUTORY_EVENT',
  /** Government-notified temporary revised statutory deadline (an extension overlay). */
  govtExtension: 'GOVT_EXTENSION',
  /** Internal recurring HSDG SLA (e.g. books by the 6th). */
  hsdgRecurring: 'HSDG_RECURRING',
  /** Internal assignment/stage milestone (e.g. manager review). */
  hsdgMilestone: 'HSDG_MILESTONE',
  /** Client-agreed contractual/management commitment (e.g. MIS by the 7th). */
  clientCommitted: 'CLIENT_COMMITTED',
  /** Specific material ad-hoc task deadline (e.g. agreement review). */
  taskDeadline: 'TASK_DEADLINE',
  /** Deadline generated from an event plus a configured SLA (response within X days). */
  eventSla: 'EVENT_SLA',
  /** Open-ended work with no predetermined date (e.g. general advisory). */
  noFixedDate: 'NO_FIXED_DATE',
} as const;
export type DueDateCategory = (typeof DUE_DATE_CATEGORY)[keyof typeof DUE_DATE_CATEGORY];
export const DUE_DATE_CATEGORIES: DueDateCategory[] = Object.values(DUE_DATE_CATEGORY);

/**
 * Due-Date SOURCE (spec §3) — WHERE a deadline's authority comes from. Kept
 * independent of {@link DUE_DATE_CATEGORY}: a statutory event may be sourced from
 * LAW_RULE, a client deliverable from CLIENT_COMMITMENT, a task from USER_ENTERED.
 * Optional on a rule/component (an obligation need not declare its source).
 */
export const DUE_DATE_SOURCE = {
  /** Underlying statutory requirement (the law or rule itself). */
  lawRule: 'LAW_RULE',
  /** A government extension / special notification. */
  governmentNotification: 'GOVERNMENT_NOTIFICATION',
  /** Internal firm SLA / policy. */
  hsdgPolicy: 'HSDG_POLICY',
  /** Contractual engagement-letter obligation. */
  engagementLetter: 'ENGAGEMENT_LETTER',
  /** A specific agreed client deadline. */
  clientCommitment: 'CLIENT_COMMITMENT',
  /** An internal workflow/stage deadline. */
  workflow: 'WORKFLOW',
  /** An authorised manual date entered by a user. */
  userEntered: 'USER_ENTERED',
} as const;
export type DueDateSource = (typeof DUE_DATE_SOURCE)[keyof typeof DUE_DATE_SOURCE];
export const DUE_DATE_SOURCES: DueDateSource[] = Object.values(DUE_DATE_SOURCE);

/**
 * Deadline LAYER type (spec §16) — one compliance obligation can carry several
 * deadline layers, each surfaced as its own calendar event: the statutory
 * filing, the HSDG preparation target, and the review milestones. The statutory
 * and internal-SLA layers live on the obligation itself; these are the ADDED
 * milestone layers (preparation + reviews + assurance stage gates).
 */
export const DEADLINE_LAYER_TYPE = {
  /** HSDG preparation target ahead of the statutory date (HSDG_RECURRING). */
  hsdgPreparation: 'hsdg_preparation',
  /** Manager review milestone (HSDG_MILESTONE). */
  managerReview: 'manager_review',
  /** Engagement-partner review milestone (HSDG_MILESTONE). */
  epReview: 'ep_review',
  /** Provided-by-client complete gate (CLIENT_COMMITTED / HSDG_MILESTONE). */
  pbcComplete: 'pbc_complete',
  /** Fieldwork complete gate (HSDG_MILESTONE). */
  fieldworkComplete: 'fieldwork_complete',
  /** Any other configured layer. */
  custom: 'custom',
} as const;
export type DeadlineLayerType = (typeof DEADLINE_LAYER_TYPE)[keyof typeof DEADLINE_LAYER_TYPE];
export const DEADLINE_LAYER_TYPES: DeadlineLayerType[] = Object.values(DEADLINE_LAYER_TYPE);

/**
 * Escalation level (spec §24 — Status and Escalation). A derived urgency band
 * for an OPEN obligation, from its operative date and today: it drives the
 * calendar's colour and the escalation ladder (due-soon → owner; overdue →
 * owner + manager; critical → engagement partner / firm). Closed obligations
 * (completed / waived) are `none`.
 */
export const ESCALATION_LEVEL = {
  none: 'none',
  upcoming: 'upcoming',
  dueSoon: 'due_soon',
  dueToday: 'due_today',
  overdue: 'overdue',
  critical: 'critical',
} as const;
export type EscalationLevel = (typeof ESCALATION_LEVEL)[keyof typeof ESCALATION_LEVEL];
export const ESCALATION_LEVELS: EscalationLevel[] = Object.values(ESCALATION_LEVEL);

/**
 * The DISTINCT action each escalation band takes (spec §24 — Status and
 * Escalation). A band is not just a colour: each one triggers a specific action
 * addressed to a specific tier of accountability, so the calendar legend and the
 * notification engine agree on who is told and what happens.
 */
export const ESCALATION_ACTION = {
  /** Closed obligation — no action. */
  none: 'none',
  /** Far enough out to only watch — no notification. */
  monitor: 'monitor',
  /** Due soon — remind the obligation's owner. */
  notifyOwner: 'notify_owner',
  /** Due today — alert the owner and their manager. */
  alertManager: 'alert_manager',
  /** Overdue — escalate to the manager and the engagement partner. */
  escalatePartner: 'escalate_partner',
  /** Critically overdue — escalate to the engagement partner and the firm. */
  escalateFirm: 'escalate_firm',
} as const;
export type EscalationAction = (typeof ESCALATION_ACTION)[keyof typeof ESCALATION_ACTION];

/** UI tone for an escalation band's badge/legend swatch. */
export type EscalationTone = 'neutral' | 'info' | 'warn' | 'danger';

/**
 * The full descriptor of an escalation band (§24): its distinct action, the
 * accountability tier it reaches, a legend label, and a UI tone. Shared so the
 * API, the calendar legend, and the escalation notifications never drift.
 */
export interface EscalationDescriptor {
  level: EscalationLevel;
  action: EscalationAction;
  /** Who the obligation escalates to at this band (ordered, most-local first). */
  recipients: string[];
  /** Short human label for the calendar legend and badges. */
  label: string;
  tone: EscalationTone;
}

const ESCALATION_DESCRIPTORS: Record<EscalationLevel, EscalationDescriptor> = {
  none: { level: 'none', action: 'none', recipients: [], label: 'Closed', tone: 'neutral' },
  upcoming: {
    level: 'upcoming',
    action: 'monitor',
    recipients: [],
    label: 'Upcoming',
    tone: 'neutral',
  },
  due_soon: {
    level: 'due_soon',
    action: 'notify_owner',
    recipients: ['Owner'],
    label: 'Due soon',
    tone: 'info',
  },
  due_today: {
    level: 'due_today',
    action: 'alert_manager',
    recipients: ['Owner', 'Manager'],
    label: 'Due today',
    tone: 'warn',
  },
  overdue: {
    level: 'overdue',
    action: 'escalate_partner',
    recipients: ['Manager', 'Engagement partner'],
    label: 'Overdue',
    tone: 'danger',
  },
  critical: {
    level: 'critical',
    action: 'escalate_firm',
    recipients: ['Engagement partner', 'Firm (Managing Partner)'],
    label: 'Critical',
    tone: 'danger',
  },
};

/** The distinct §24 action + accountability tier for an escalation band. */
export function escalationAction(level: EscalationLevel): EscalationDescriptor {
  return ESCALATION_DESCRIPTORS[level];
}

/**
 * The OPEN escalation ladder, in ascending urgency — the calendar legend and any
 * "escalation policy" view iterate this (closed obligations are excluded).
 */
export const ESCALATION_LADDER: EscalationDescriptor[] = [
  ESCALATION_DESCRIPTORS.upcoming,
  ESCALATION_DESCRIPTORS.due_soon,
  ESCALATION_DESCRIPTORS.due_today,
  ESCALATION_DESCRIPTORS.overdue,
  ESCALATION_DESCRIPTORS.critical,
];
