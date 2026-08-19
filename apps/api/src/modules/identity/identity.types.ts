import type { RoleSlug } from '@hsdg/contracts';

/** Everything needed to build a Principal for an authenticated user. */
export interface PrincipalData {
  userId: string;
  email: string;
  displayName: string;
  officeId: string;
  officeCode: string;
  employeeId: string | null;
  isActive: boolean;
  mfaRequired: boolean;
  roles: RoleSlug[];
  permissions: string[];
}

/** A user as exposed by the API (RLS decides which are visible). */
export interface UserListItem {
  id: string;
  email: string;
  displayName: string;
  officeId: string;
  officeCode: string;
  isActive: boolean;
  roles: RoleSlug[];
}

export interface OfficeRecord {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface AuditEventRecord {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  reason: string | null;
  correlationId: string | null;
}
