/**
 * Review & sign-off vocabulary (Phase 7) shared by the API and web.
 *
 * Distinct from both the engagement lifecycle (governance state) and the
 * service workflow (how the work is performed): the review engine records the
 * professional review trail and gates completion on a valid sign-off whose
 * required authority is set by the engagement's effective review model.
 */

/**
 * The kind of review event recorded against an engagement.
 *  - `manager_review` — a manager-level review (may raise review points).
 *  - `ep_review`      — a review by the accountable Engagement Partner
 *                       (key-matter or full review; may raise review points).
 *  - `sign_off`       — the terminal approval that gates completion. Who may
 *                       perform it is decided by the effective review model
 *                       (see {@link REVIEW_MODEL} / `requiresEpSignoff`).
 */
export const REVIEW_TYPE = {
  managerReview: 'manager_review',
  epReview: 'ep_review',
  signOff: 'sign_off',
} as const;
export type ReviewType = (typeof REVIEW_TYPE)[keyof typeof REVIEW_TYPE];
export const REVIEW_TYPES: ReviewType[] = Object.values(REVIEW_TYPE);

/** Review types that a reviewer records directly (sign-off has its own endpoint). */
export const RECORDABLE_REVIEW_TYPES: ReviewType[] = [
  REVIEW_TYPE.managerReview,
  REVIEW_TYPE.epReview,
];

/**
 * Outcome of a review. `cleared`/`returned` apply to manager/EP reviews;
 * `signed_off` applies only to a `sign_off`. The pairing is also enforced by a
 * database CHECK.
 */
export const REVIEW_OUTCOME = {
  cleared: 'cleared',
  returned: 'returned',
  signedOff: 'signed_off',
} as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOME)[keyof typeof REVIEW_OUTCOME];
export const REVIEW_OUTCOMES: ReviewOutcome[] = Object.values(REVIEW_OUTCOME);

/** Lifecycle of a review point (a matter raised during review). */
export const REVIEW_POINT_STATUS = {
  open: 'open',
  resolved: 'resolved',
} as const;
export type ReviewPointStatus = (typeof REVIEW_POINT_STATUS)[keyof typeof REVIEW_POINT_STATUS];
export const REVIEW_POINT_STATUSES: ReviewPointStatus[] = Object.values(REVIEW_POINT_STATUS);
