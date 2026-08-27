/** Engagement vocabulary shared by the API and web. */

/**
 * Universal engagement lifecycle states. The guarded state machine (which
 * transitions are legal) arrives in Phase 6; here they are the permitted values.
 */
export const ENGAGEMENT_STATUS = {
  prospect: 'prospect',
  pendingAcceptance: 'pending_acceptance',
  accepted: 'accepted',
  active: 'active',
  onHold: 'on_hold',
  completed: 'completed',
  closed: 'closed',
  declined: 'declined',
  withdrawn: 'withdrawn',
  cancelled: 'cancelled',
} as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUS)[keyof typeof ENGAGEMENT_STATUS];
export const ENGAGEMENT_STATUSES: EngagementStatus[] = Object.values(ENGAGEMENT_STATUS);

/** States at which an accountable Engagement Partner is NOT yet required. */
export const EP_OPTIONAL_STATUSES: EngagementStatus[] = [
  ENGAGEMENT_STATUS.prospect,
  ENGAGEMENT_STATUS.pendingAcceptance,
  ENGAGEMENT_STATUS.declined,
  ENGAGEMENT_STATUS.withdrawn,
  ENGAGEMENT_STATUS.cancelled,
];

/**
 * Lifecycle of ONE service carried by an engagement (multi-service, §9–§10).
 * Independent of the parent engagement's status after creation — a firm can put
 * just the GST service on hold while Accounting stays active.
 */
export const ENGAGEMENT_SERVICE_STATUS = {
  prospect: 'prospect',
  active: 'active',
  onHold: 'on_hold',
  completed: 'completed',
  cancelled: 'cancelled',
} as const;
export type EngagementServiceStatus =
  (typeof ENGAGEMENT_SERVICE_STATUS)[keyof typeof ENGAGEMENT_SERVICE_STATUS];
export const ENGAGEMENT_SERVICE_STATUSES: EngagementServiceStatus[] =
  Object.values(ENGAGEMENT_SERVICE_STATUS);

/** One service line under a multi-service engagement (a row of engagement_services). */
export interface EngagementServiceLine {
  id: string;
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  /** The primary/legacy service (mirrors engagements.service_id); exactly one per engagement. */
  isPrimary: boolean;
  status: EngagementServiceStatus;
  officeId: string;
  officeCode: string;
  leadEmployeeId: string | null;
  leadEmployeeName: string | null;
  createdAt: string;
}

/** Role a team member plays on a specific engagement (EP/manager are separate). */
export const TEAM_ROLE = {
  inCharge: 'in_charge',
  member: 'member',
  reviewer: 'reviewer',
  specialist: 'specialist',
} as const;
export type TeamRole = (typeof TEAM_ROLE)[keyof typeof TEAM_ROLE];
export const TEAM_ROLES: TeamRole[] = Object.values(TEAM_ROLE);

/**
 * Phase 6: the engagement lifecycle's guarded transition actions. Each is its
 * own endpoint (`POST /engagements/:id/<action, kebab-case>`) — there is no
 * generic "set status" endpoint. `from`/`to` are the shapes seeded into
 * `hsdg.engagement_lifecycle_transitions`; `resume`'s destination is dynamic
 * (the engagement's own `on_hold_previous_status`), not a fixed status.
 */
export const LIFECYCLE_ACTION = {
  submitForAcceptance: 'submit_for_acceptance',
  accept: 'accept',
  start: 'start',
  putOnHold: 'put_on_hold',
  resume: 'resume',
  complete: 'complete',
  close: 'close',
  decline: 'decline',
  withdraw: 'withdraw',
  cancel: 'cancel',
  reopen: 'reopen',
} as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTION)[keyof typeof LIFECYCLE_ACTION];
export const LIFECYCLE_ACTIONS: LifecycleAction[] = Object.values(LIFECYCLE_ACTION);
