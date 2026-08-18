/** Service-catalogue vocabulary shared by the API and web. */

export const RECURRENCE = {
  oneTime: 'one_time',
  monthly: 'monthly',
  quarterly: 'quarterly',
  halfYearly: 'half_yearly',
  annual: 'annual',
  asRequired: 'as_required',
} as const;
export type Recurrence = (typeof RECURRENCE)[keyof typeof RECURRENCE];
export const RECURRENCES: Recurrence[] = Object.values(RECURRENCE);

/** Review-model slugs (also rows in review_models, with a rank). */
export const REVIEW_MODEL = {
  managerReview: 'manager_review',
  keyMatterReview: 'key_matter_review',
  fullEpReview: 'full_ep_review',
} as const;
export type ReviewModelSlug = (typeof REVIEW_MODEL)[keyof typeof REVIEW_MODEL];

/**
 * A completed/actual review satisfies a service's requirement only when its
 * model is at least as rigorous (rank) as the service requires. Enforced at
 * sign-off in Phase 7; the ranks live in the review_models table.
 */
export function meetsReviewRequirement(requiredRank: number, actualRank: number): boolean {
  return actualRank >= requiredRank;
}
