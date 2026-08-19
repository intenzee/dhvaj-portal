/** DI token for the shared pg Pool. */
export const PG_POOL = Symbol('PG_POOL');

/**
 * Names of the transaction-local settings that carry the security context into
 * PostgreSQL. RLS policies (added from Phase 1 onward) read these via
 * `current_setting(...)`. They are always set with `SET LOCAL`, so they live
 * only for the duration of a single transaction and can never leak between
 * pooled connections.
 *
 * The `hsdg.` prefix namespaces them as custom GUCs.
 */
export const RLS_SETTINGS = {
  userId: 'hsdg.user_id',
  role: 'hsdg.role',
  officeId: 'hsdg.office_id',
  orgId: 'hsdg.org_id',
  /** Acting user's employee id — drives engagement-assignment access (Phase 5). */
  employeeId: 'hsdg.employee_id',
} as const;
