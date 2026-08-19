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
