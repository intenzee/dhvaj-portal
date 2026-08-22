/**
 * Reports & MIS vocabulary (management aggregations) shared by the API and web.
 *
 * Every figure is RLS-scoped: it reflects only the engagements/tasks/obligations
 * the caller can see — firm-wide for the Managing Partner, assignment-scoped for
 * a partner/manager. The database scopes the rows; these reports just roll them
 * up. Gated by `report.read` (management tier).
 */

/** A labelled count, for simple breakdown lists. */
export interface CountByKey {
  key: string;
  count: number;
}

export interface EngagementMisReport {
  totals: {
    total: number;
    active: number;
    onHold: number;
    completed: number;
    waitingForClient: number;
    signedOff: number;
  };
  byStatus: Array<{ status: string; count: number }>;
  byServiceLine: Array<{ serviceLine: string; count: number }>;
  byOffice: Array<{ officeCode: string; count: number }>;
  byPartner: Array<{ partnerId: string; partnerName: string; active: number; total: number }>;
}

export interface ComplianceMisReport {
  dueSoonWindowDays: number;
  totals: { open: number; overdue: number; dueSoon: number; completed: number; waived: number };
  byCategory: Array<{ category: string; open: number; overdue: number; dueSoon: number }>;
}

export interface UtilisationRow {
  employeeId: string;
  employeeName: string;
  gradeName: string | null;
  officeCode: string;
  asEp: number;
  asManager: number;
  asMember: number;
  openTasks: number;
  overdueTasks: number;
}

export interface UtilisationReport {
  rows: UtilisationRow[];
}
