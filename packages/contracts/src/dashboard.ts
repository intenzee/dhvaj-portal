/**
 * Dashboard vocabulary (Phase 12) shared by the API and web.
 *
 * The summary is a set of RLS-scoped counts — each reflects only what the caller
 * can see, so the same endpoint powers every role's Home dashboard (firm-wide for
 * the Managing Partner, assignment-scoped for everyone else). The web decides
 * WHICH cards to show per role; the counts themselves are already scoped by the
 * database.
 */
export interface DashboardSummary {
  /** Engagements in the ACTIVE state that the caller can see. */
  activeEngagements: number;
  /** Open compliance obligations past their statutory deadline. */
  overdueCompliance: number;
  /** Open compliance obligations due within the "due soon" window. */
  dueSoonCompliance: number;
  /** Active, not-signed-off engagements with at least one open review point. */
  pendingReviews: number;
  /** Active engagements awaiting the caller's EP sign-off (EP = caller, ready to sign). */
  pendingSignoffs: number;
  /** Open client dependencies (waiting for the client). */
  openClientDependencies: number;
  /** Open key-matter (high-risk) review points. */
  highRisk: number;
  /** Open tasks assigned to the caller. */
  myOpenTasks: number;
  /** Open tasks assigned to the caller and past their due date. */
  myOverdueTasks: number;
  /** The caller's unread notifications. */
  unreadNotifications: number;
  /** The "due soon" window used for the compliance counts, in days. */
  dueSoonWindowDays: number;
}

/** The card kinds a Home dashboard can render. */
export const DASHBOARD_CARD = {
  activeEngagements: 'active_engagements',
  overdue: 'overdue',
  dueSoon: 'due_soon',
  pendingReviews: 'pending_reviews',
  pendingSignoffs: 'pending_signoffs',
  clientDependencies: 'client_dependencies',
  highRisk: 'high_risk',
  myTasks: 'my_tasks',
} as const;
export type DashboardCard = (typeof DASHBOARD_CARD)[keyof typeof DASHBOARD_CARD];
