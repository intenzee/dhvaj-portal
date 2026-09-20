/**
 * @hsdg/contracts
 *
 * Shared, framework-agnostic contracts (enums, DTO shapes, constants) used by
 * both the API and the web portal so business vocabulary is defined once.
 *
 * Populated incrementally, one domain at a time, as phases are delivered.
 * Phase 0 intentionally ships only the API-version constant.
 */

export const API_VERSION = 'v1' as const;
export const API_PREFIX = 'api' as const;

export * from './identity';
export * from './authority';
export * from './audit-rules';
export * from './entities';
export * from './services';
export * from './components';
export * from './engagements';
export * from './statutory-audit';
export * from './statutory-audit-acceptance';
export * from './statutory-audit-profile';
export * from './statutory-audit-framework';
export * from './statutory-audit-subassessment';
export * from './statutory-audit-financial-reporting';
export * from './statutory-audit-schedule-iii';
export * from './statutory-audit-matters';
export * from './statutory-audit-work';
export * from './statutory-audit-planning';
export * from './statutory-audit-risk';
export * from './statutory-audit-procedures';
export * from './statutory-audit-pbc';
export * from './statutory-audit-review';
export * from './statutory-audit-team';
export * from './statutory-audit-completion';
export * from './statutory-audit-reassessment';
export * from './time';
export * from './commercial';
export * from './notes';
export * from './reviews';
export * from './compliance';
export * from './tasks';
export * from './documents';
export * from './notifications';
export * from './dashboard';
export * from './reports';
export * from './pagination';
