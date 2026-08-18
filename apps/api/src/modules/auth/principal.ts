import type { RoleSlug } from '@hsdg/contracts';
import type { RlsContext } from '../../database/rls-context';

/**
 * The authenticated actor for a request. Built once by the auth layer from the
 * verified token + the identity store, then attached to the request and used
 * for authorisation and to derive the database security context.
 */
export interface Principal {
  userId: string;
  email: string;
  displayName: string;
  officeId: string;
  officeCode: string;
  roles: RoleSlug[];
  /**
   * Highest-precedence role — what RLS policies test (firm-wide vs office).
   * Undefined when the user holds no role; the database context role is then
   * empty, so RLS treats them as office-scoped with no firm-wide access.
   */
  effectiveRole: RoleSlug | undefined;
  permissions: string[];
  mfaRequired: boolean;
  mfaSatisfied: boolean;
}

/** Derive the transaction-local database security context from a principal. */
export function rlsContextFromPrincipal(principal: Principal): RlsContext {
  return {
    userId: principal.userId,
    role: principal.effectiveRole ?? '',
    officeId: principal.officeId,
  };
}
