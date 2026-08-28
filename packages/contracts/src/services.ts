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

/**
 * Reusable catalogue template kinds (§18/§25/§27). One versioned master backs
 * all three; the type discriminates the item shape a version's `body` carries.
 */
export const TEMPLATE_TYPE = {
  checklist: 'checklist',
  pbc: 'pbc',
  documentRequirement: 'document_requirement',
} as const;
export type TemplateType = (typeof TEMPLATE_TYPE)[keyof typeof TEMPLATE_TYPE];
export const TEMPLATE_TYPES: TemplateType[] = Object.values(TEMPLATE_TYPE);

/** Review-model slugs (also rows in review_models, with a rank). */
export const REVIEW_MODEL = {
  managerReview: 'manager_review',
  keyMatterReview: 'key_matter_review',
  fullEpReview: 'full_ep_review',
} as const;
export type ReviewModelSlug = (typeof REVIEW_MODEL)[keyof typeof REVIEW_MODEL];
export const REVIEW_MODELS: ReviewModelSlug[] = Object.values(REVIEW_MODEL);

/**
 * A completed/actual review satisfies a service's requirement only when its
 * model is at least as rigorous (rank) as the service requires. Enforced at
 * sign-off in Phase 7; the ranks live in the review_models table.
 */
export function meetsReviewRequirement(requiredRank: number, actualRank: number): boolean {
  return actualRank >= requiredRank;
}
