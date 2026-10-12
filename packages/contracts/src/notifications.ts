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
  /** A document was uploaded — notifies the reviewer; powers the "to review" inbox. */
  documentUploaded: 'document_uploaded',
  /** 02.8 §17 — an approved Audit Framework was reopened (Engagement Manager / Partner). */
  frameworkReopened: 'framework_reopened',
  /** 02.8 §17 — downstream work was created, invalidated or needs reassessment (owners). */
  frameworkWorkImpacted: 'framework_work_impacted',
  /** 03.1 §19 — a new Enhanced / Immediate signal entered the register (Engagement Manager). */
  planningSignalAlert: 'planning_signal_alert',
  /** 03.1 §10/§20 — an Immediate Partner Attention item was surfaced / challenged / answered. */
  planningPartnerAttention: 'planning_partner_attention',
  /** 03.1 §19 — approved planning strategy reopened for a controlled revision. */
  planningStrategyReopened: 'planning_strategy_reopened',
  /** 03.2 §21 — a completed 03.2 needs reassessment after its analytics moved (Engagement Manager). */
  planningUnderstandingReassessment: 'planning_understanding_reassessment',
  /** 03.2 §23 — the Engagement Partner commented on / challenged 03.2, or the Manager answered. */
  planningUnderstandingChallenge: 'planning_understanding_challenge',
  /** 03.3 §20/§23 — a completed 03.3 needs reassessment (03.2 figures moved / EP required it). */
  planningMaterialityReassessment: 'planning_materiality_reassessment',
  /** 03.3 §23 — the Engagement Partner commented on / challenged 03.3, or the Manager answered. */
  planningMaterialityChallenge: 'planning_materiality_challenge',
  /** 03.5 §27 — the EP commented / challenged / requested reassessment, or an area was requested. */
  planningAreasReview: 'planning_areas_review',
  /** 03.5 §25 — a completed 03.5 became Update Required (Engagement Manager). */
  planningAreasUpdateRequired: 'planning_areas_update_required',
  /** 03.4 §24/§27 — a completed 03.4 needs reassessment (materiality revision / Section 05 / 03.1). */
  planningScopeReassessment: 'planning_scope_reassessment',
  /** 03.4 §26 — the Engagement Partner challenged / requested on 03.4, or the Manager answered. */
  planningScopePartnerAction: 'planning_scope_partner_action',
  /** Change 3 — a task was sent for review (reviewer). */
  taskReviewRequested: 'task_review_requested',
  /** Change 3 — the reviewer returned a task with points (assignee). */
  taskReturned: 'task_returned',
  /** Change 5 — a filing was lodged with its ARN (engagement manager). */
  filingLodged: 'filing_lodged',
  /** Change 3 — a time adjustment over 30 minutes awaits approval (leads). */
  timeAdjustmentPending: 'time_adjustment_pending',
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
