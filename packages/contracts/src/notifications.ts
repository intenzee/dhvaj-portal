/**
 * Notification vocabulary (Phase 11) shared by the API and web.
 *
 * A notification is addressed to one recipient user and carries a typed event
 * plus optional engagement/object context for deep-linking. Delivery is
 * channel-abstracted: the in-app "portal" channel is the persisted row itself;
 * email/Teams are pluggable external channels.
 */

/** The material events the firm is notified about (§11 initial set). */
export const NOTIFICATION_TYPE = {
  taskAssigned: 'task_assigned',
  reviewPending: 'review_pending',
  epSignoffPending: 'ep_signoff_pending',
  internalSlaApproaching: 'internal_sla_approaching',
  internalSlaOverdue: 'internal_sla_overdue',
  statutoryDeadlineApproaching: 'statutory_deadline_approaching',
  statutoryDeadlineOverdue: 'statutory_deadline_overdue',
  /** §24 Due Today — an obligation whose operative date is today (owner/reviewer). */
  complianceDueToday: 'compliance_due_today',
  /** §24 Review overdue — a manager/EP review deadline LAYER has passed (reviewer + escalation). */
  deadlineLayerOverdue: 'deadline_layer_overdue',
  /** §24 Client-commitment overdue — a CLIENT_COMMITTED obligation has passed (owner/manager). */
  clientCommitmentOverdue: 'client_commitment_overdue',
  /** §24 PBC overdue — a client dependency past its escalation date (client + owner). */
  clientDependencyOverdue: 'client_dependency_overdue',
  clientDependencyReminder: 'client_dependency_reminder',
  engagementReopened: 'engagement_reopened',
  epChanged: 'ep_changed',
  highRiskException: 'high_risk_exception',
} as const;
export type NotificationType = (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE];
export const NOTIFICATION_TYPES: NotificationType[] = Object.values(NOTIFICATION_TYPE);

/** Per-recipient read state. */
export const NOTIFICATION_STATUS = {
  unread: 'unread',
  read: 'read',
  dismissed: 'dismissed',
} as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUS)[keyof typeof NOTIFICATION_STATUS];
export const NOTIFICATION_STATUSES: NotificationStatus[] = Object.values(NOTIFICATION_STATUS);

/** Delivery channels. `portal` is always on; the rest are opt-in and pluggable. */
export const NOTIFICATION_CHANNEL = {
  portal: 'portal',
  email: 'email',
  teams: 'teams',
} as const;
export type NotificationChannelName =
  (typeof NOTIFICATION_CHANNEL)[keyof typeof NOTIFICATION_CHANNEL];
export const NOTIFICATION_CHANNELS: NotificationChannelName[] = Object.values(NOTIFICATION_CHANNEL);
