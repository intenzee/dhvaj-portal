/**
 * Standard pagination contract shared by the API and web. Offset-based: simple
 * and adequate for the portal's list sizes; a cursor variant can be layered on
 * later without changing this envelope's shape.
 */

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** Uniform envelope every paginated list endpoint returns. */
export interface Paginated<T> {
  items: T[];
  /** Total rows matching the query, ignoring limit/offset. */
  total: number;
  limit: number;
  offset: number;
}
