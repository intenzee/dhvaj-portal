/**
 * The security context propagated into every data-access transaction and, from
 * Phase 1, enforced by PostgreSQL Row Level Security.
 *
 * This is the single source of "who is acting" for the database layer. It is
 * deliberately minimal in Phase 0 (no auth yet); Phase 1 populates it from the
 * authenticated principal. RLS policies are written against these values, so
 * the database enforces access independently of the application and UI.
 */
export interface RlsContext {
  /** Authenticated user's UUID. */
  userId: string;
  /** Effective role slug (e.g. managing_partner, partner, manager, senior). */
  role: string;
  /** Acting office UUID, when the request is office-scoped. */
  officeId?: string;
  /** Organisation UUID (firm). */
  orgId?: string;
}
