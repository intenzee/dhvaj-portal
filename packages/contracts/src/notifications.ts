import type { WorkItemRef } from './work-links';

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

// ── Staff Workflow WF-305 · Fewer, actionable notifications ─────────────────

/**
 * Actionable: the recipient must do something (review, sign off, chase, file),
 * and it clears itself once that is done. Informational: worth knowing, nothing
 * to do — it goes to the daily digest unless the user asks for it in the bell.
 */
export const NOTIFICATION_KIND = {
  actionable: 'actionable',
  informational: 'informational',
} as const;
export type NotificationKind = (typeof NOTIFICATION_KIND)[keyof typeof NOTIFICATION_KIND];

const A = NOTIFICATION_KIND.actionable;
const I = NOTIFICATION_KIND.informational;

/** Every type, classified. A Record, so a new type will not compile until it is. */
export const NOTIFICATION_TYPE_KIND: Record<NotificationType, NotificationKind> = {
  task_assigned: A,
  review_pending: A,
  ep_signoff_pending: A,
  internal_sla_approaching: I,
  internal_sla_overdue: A,
  statutory_deadline_approaching: I,
  statutory_deadline_overdue: A,
  compliance_due_today: A,
  deadline_layer_overdue: A,
  client_commitment_overdue: A,
  client_dependency_overdue: A,
  client_dependency_reminder: I,
  engagement_reopened: I,
  ep_changed: I,
  high_risk_exception: A,
  document_uploaded: A,
  framework_reopened: I,
  framework_work_impacted: A,
  planning_signal_alert: I,
  planning_partner_attention: A,
  planning_strategy_reopened: I,
  planning_understanding_reassessment: A,
  planning_understanding_challenge: A,
  planning_materiality_reassessment: A,
  planning_materiality_challenge: A,
  planning_areas_review: A,
  planning_areas_update_required: A,
  planning_scope_reassessment: A,
  planning_scope_partner_action: A,
  task_review_requested: A,
  task_returned: A,
  filing_lodged: I,
  time_adjustment_pending: A,
};

export function notificationKind(type: NotificationType): NotificationKind {
  return NOTIFICATION_TYPE_KIND[type] ?? A;
}

/** Plain names for the profile's per-type settings and the digest's headings. */
export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  task_assigned: 'Task assigned to you',
  review_pending: 'Review pending',
  ep_signoff_pending: 'Sign-off pending',
  internal_sla_approaching: 'Internal due date coming up',
  internal_sla_overdue: 'Internal due date passed',
  statutory_deadline_approaching: 'Statutory due date coming up',
  statutory_deadline_overdue: 'Statutory due date passed',
  compliance_due_today: 'Due today',
  deadline_layer_overdue: 'Review overdue',
  client_commitment_overdue: 'Client commitment overdue',
  client_dependency_overdue: 'Client request overdue',
  client_dependency_reminder: 'Client reminder sent',
  engagement_reopened: 'Engagement reopened',
  ep_changed: 'Engagement partner changed',
  high_risk_exception: 'High-risk exception',
  document_uploaded: 'Document to review',
  framework_reopened: 'Audit framework reopened',
  framework_work_impacted: 'Audit work affected',
  planning_signal_alert: 'Planning signal',
  planning_partner_attention: 'Partner attention',
  planning_strategy_reopened: 'Planning strategy reopened',
  planning_understanding_reassessment: 'Understanding needs reassessment',
  planning_understanding_challenge: 'Understanding challenged',
  planning_materiality_reassessment: 'Materiality needs reassessment',
  planning_materiality_challenge: 'Materiality challenged',
  planning_areas_review: 'Audit areas review',
  planning_areas_update_required: 'Audit areas need updating',
  planning_scope_reassessment: 'Scope needs reassessment',
  planning_scope_partner_action: 'Scope partner action',
  task_review_requested: 'Review requested',
  task_returned: 'Returned with review points',
  filing_lodged: 'Filing lodged',
  time_adjustment_pending: 'Time correction to approve',
};

/** Where a type reaches the user. Actionable types always reach the bell. */
export const NOTIFICATION_DELIVERY = { bell: 'bell', digest: 'digest', off: 'off' } as const;
export type NotificationDelivery =
  (typeof NOTIFICATION_DELIVERY)[keyof typeof NOTIFICATION_DELIVERY];
export const NOTIFICATION_DELIVERIES: NotificationDelivery[] = Object.values(NOTIFICATION_DELIVERY);

/**
 * Where a type actually goes for a user: an actionable type always to the bell;
 * an informational one where they chose, the digest by default.
 */
export function notificationDelivery(
  type: NotificationType,
  chosen?: NotificationDelivery | null,
): NotificationDelivery {
  if (notificationKind(type) === NOTIFICATION_KIND.actionable) return NOTIFICATION_DELIVERY.bell;
  return chosen ?? NOTIFICATION_DELIVERY.digest;
}

/** One type's setting, as the profile shows it. */
export interface NotificationPreference {
  type: NotificationType;
  label: string;
  kind: NotificationKind;
  delivery: NotificationDelivery;
  /** Whether the user may change it (informational types only). */
  editable: boolean;
}

/** PUT /notifications/preferences — informational types only. */
export interface NotificationPreferenceUpdate {
  type: NotificationType;
  delivery: NotificationDelivery;
}

/** A notification as its recipient sees it. */
export interface NotificationItem {
  id: string;
  type: NotificationType;
  kind: NotificationKind;
  title: string;
  body: string | null;
  engagementId: string | null;
  objectType: string | null;
  objectId: string | null;
  /** The exact place it opens (`workItemHref`); null for an engagement-less notice. */
  link: WorkItemRef | null;
  status: NotificationStatus;
  readAt: string | null;
  /** Set when it was read because the action it asked for was done. */
  resolvedAt: string | null;
  createdAt: string;
}

/** GET /notifications/digest — the day's informational notices, by type. */
export interface NotificationDigest {
  /** IST day the digest covers (yyyy-mm-dd). */
  date: string;
  total: number;
  groups: { type: NotificationType; label: string; items: NotificationItem[] }[];
}
