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
