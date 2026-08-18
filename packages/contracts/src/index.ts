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
export * from './entities';
export * from './services';
export * from './pagination';
