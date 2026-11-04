/**
 * Practice Services PS-302 · cost rates, realisation and profitability.
 * Rates and margins are seen only with practice.finance. Money is a decimal
 * string (rupees, 2 dp); hours are numbers (2 dp).
 */

/** A grade's rates, in force from `effectiveFrom` until the grade's next row. */
export interface RateCardRow {
  id: string;
  gradeId: string;
  gradeName: string;
  financialYear: string;
  costRatePerHour: string;
  chargeOutRatePerHour: string;
  effectiveFrom: string;
}

/** One person's rates, over their grade's, from `effectiveFrom`. */
export interface EmployeeRateRow {
  id: string;
  employeeId: string;
  employeeName: string;
  gradeName: string | null;
  costRatePerHour: string;
  chargeOutRatePerHour: string;
  effectiveFrom: string;
  note: string | null;
}

export interface GradeOption {
  id: string;
  slug: string;
  name: string;
  rank: number;
}

/** The firm's working calendar: available hours for utilisation. */
export interface WorkingCalendar {
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  workingWeekdays: number[];
  workingHoursPerDay: string;
}

export interface RateCardsResponse {
  grades: GradeOption[];
  cards: RateCardRow[];
  overrides: EmployeeRateRow[];
  calendar: WorkingCalendar;
}

/** PUT /rate-cards: every grade's rates from one day (a grade left out keeps its own). */
export interface PutRateCardsInput {
  effectiveFrom: string;
  rates: { gradeId: string; costRatePerHour: string; chargeOutRatePerHour: string }[];
}

export interface PutEmployeeRateInput {
  employeeId: string;
  effectiveFrom: string;
  costRatePerHour: string;
  chargeOutRatePerHour: string;
  note?: string | null;
}

export type PutWorkingCalendarInput = WorkingCalendar;

export const PROFITABILITY_BY = ['client', 'engagement', 'service', 'partner', 'month'] as const;
export type ProfitabilityBy = (typeof PROFITABILITY_BY)[number];
export const PROFITABILITY_BY_LABEL: Record<ProfitabilityBy, string> = {
  client: 'Client',
  engagement: 'Engagement',
  service: 'Service',
  partner: 'Partner',
  month: 'Month',
};

/** How many of the lowest-margin rows the report highlights. */
export const PROFITABILITY_BOTTOM = 10;

export interface ProfitabilityMeasures {
  /** All hours logged (billable or not). */
  hours: number;
  billableHours: number;
  /** Σ hours × cost rate. */
  timeCost: string;
  /** Σ billable hours × charge-out rate. */
  standardValue: string;
  /** Σ invoice taxable value issued in the period, less approved credit notes. */
  billed: string;
  /** Σ receipts allocated in the period, ex-GST (pro rata to the invoice). */
  collected: string;
  /** billed ÷ standard value, %, 1 dp; null when there is no standard value. */
  realisationPct: number | null;
  /** collected ÷ billed, %, 1 dp; null when nothing was billed. */
  collectionPct: number | null;
  /** billed − time cost. */
  margin: string;
  /** margin ÷ billed, %, 1 dp; null when nothing was billed. */
  marginPct: number | null;
  /** Hours with no rate in force on their day (costed at nothing). */
  unratedHours: number;
}

export interface ProfitabilityRow extends ProfitabilityMeasures {
  key: string;
  label: string;
  /** e.g. the client of an engagement, the office of a partner. */
  sub: string | null;
  /** Among the lowest margins (when there are more rows than PROFITABILITY_BOTTOM), or a loss. */
  bottom: boolean;
}

export interface ProfitabilityReport {
  from: string;
  to: string;
  by: ProfitabilityBy;
  rows: ProfitabilityRow[];
  totals: ProfitabilityMeasures;
  /** People whose hours had no rate in force: set their grade's card. */
  unratedPeople: string[];
}

export interface ProfitabilityQuery {
  from?: string;
  to?: string;
  by?: ProfitabilityBy;
  partnerId?: string;
  officeId?: string;
  serviceId?: string;
  entityId?: string;
}

/** The last full quarter (Indian FY quarters) before `today`, as from/to. Pure. */
export function lastQuarter(today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  // Quarters start in Apr, Jul, Oct, Jan.
  const qStart = m >= 4 ? Math.floor((m - 4) / 3) * 3 + 4 : 1;
  let sy = y;
  let sm = qStart - 3;
  if (sm < 1) {
    sm += 12;
    sy -= 1;
  }
  const end = new Date(Date.UTC(sy, sm + 2, 0)).getUTCDate();
  const mm = (n: number) => String(n).padStart(2, '0');
  return {
    from: `${sy}-${mm(sm)}-01`,
    to: `${sy}-${mm(sm + 2)}-${mm(end)}`,
  };
}
