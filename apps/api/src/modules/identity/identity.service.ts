import { Injectable } from '@nestjs/common';
import { SYSTEM_ROLE, type RoleSlug } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import type { OfficeRecord, PrincipalData, UserListItem } from './identity.types';

/**
 * Data access for the identity model.
 *
 * Two kinds of read:
 *  - Authentication bootstrap ({@link loadPrincipalByEmail}/{@link loadPrincipalByEntraId})
 *    resolves the acting user BEFORE a real security context exists. It runs
 *    under the reserved 'system' context, which RLS grants firm-wide read for
 *    exactly this purpose. 'system' is never an assignable role, so no human
 *    principal can obtain it.
 *  - Business reads ({@link listUsers}, {@link getUserById}, {@link listOffices})
 *    run under the caller's real context, so RLS scopes the results.
 */
@Injectable()
export class IdentityService {
  constructor(private readonly db: DatabaseService) {}

  private get systemContext(): RlsContext {
    return { userId: '', role: SYSTEM_ROLE, officeId: '' };
  }

  async loadPrincipalByEmail(email: string): Promise<PrincipalData | null> {
    return this.loadPrincipal('u.email = $1', email);
  }

  async loadPrincipalByEntraId(entraObjectId: string): Promise<PrincipalData | null> {
    return this.loadPrincipal('u.entra_object_id = $1', entraObjectId);
  }

  private async loadPrincipal(whereClause: string, value: string): Promise<PrincipalData | null> {
    return this.db.withRlsContext(this.systemContext, async (client) => {
      const userResult = await client.query<{
        id: string;
        email: string;
        display_name: string;
        primary_office_id: string;
        office_code: string;
        employee_id: string | null;
        is_active: boolean;
        mfa_required: boolean;
        roles: RoleSlug[];
      }>(
        `SELECT u.id, u.email, u.display_name, u.primary_office_id,
                o.code AS office_code, emp.id AS employee_id, u.is_active, u.mfa_required,
                COALESCE(
                  array_agg(DISTINCT r.slug) FILTER (WHERE r.slug IS NOT NULL),
                  '{}'
                ) AS roles
         FROM hsdg.users u
         JOIN hsdg.offices o ON o.id = u.primary_office_id
         LEFT JOIN hsdg.employees emp ON emp.user_id = u.id
         LEFT JOIN hsdg.user_roles ur ON ur.user_id = u.id
         LEFT JOIN hsdg.roles r ON r.id = ur.role_id
         WHERE ${whereClause}
         GROUP BY u.id, o.code, emp.id`,
        [value],
      );

      const row = userResult.rows[0];
      if (!row) return null;

      const permResult = await client.query<{ slug: string }>(
        `SELECT DISTINCT p.slug
         FROM hsdg.permissions p
         JOIN hsdg.role_permissions rp ON rp.permission_id = p.id
         JOIN hsdg.user_roles ur ON ur.role_id = rp.role_id
         WHERE ur.user_id = $1`,
        [row.id],
      );

      return {
        userId: row.id,
        email: row.email,
        displayName: row.display_name,
        officeId: row.primary_office_id,
        officeCode: row.office_code,
        employeeId: row.employee_id,
        isActive: row.is_active,
        mfaRequired: row.mfa_required,
        roles: row.roles,
        permissions: permResult.rows.map((p) => p.slug),
      };
    });
  }

  async listUsers(ctx: RlsContext, page: PageParams): Promise<PageResult<UserListItem>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        email: string;
        display_name: string;
        primary_office_id: string;
        office_code: string;
        is_active: boolean;
        roles: RoleSlug[];
        total_count: string;
      }>(
        `SELECT sub.*, count(*) OVER() AS total_count
         FROM (
           SELECT u.id, u.email, u.display_name, u.primary_office_id,
                  o.code AS office_code, u.is_active,
                  COALESCE(
                    array_agg(DISTINCT r.slug) FILTER (WHERE r.slug IS NOT NULL),
                    '{}'
                  ) AS roles
           FROM hsdg.users u
           JOIN hsdg.offices o ON o.id = u.primary_office_id
           LEFT JOIN hsdg.user_roles ur ON ur.user_id = u.id
           LEFT JOIN hsdg.roles r ON r.id = ur.role_id
           GROUP BY u.id, o.code
         ) sub
         ORDER BY sub.display_name
         LIMIT $1 OFFSET $2`,
        [page.limit, page.offset],
      );
      return {
        items: rows.map(toUserListItem),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }

  async getUserById(ctx: RlsContext, id: string): Promise<UserListItem | null> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        email: string;
        display_name: string;
        primary_office_id: string;
        office_code: string;
        is_active: boolean;
        roles: RoleSlug[];
      }>(
        `SELECT u.id, u.email, u.display_name, u.primary_office_id,
                o.code AS office_code, u.is_active,
                COALESCE(
                  array_agg(DISTINCT r.slug) FILTER (WHERE r.slug IS NOT NULL),
                  '{}'
                ) AS roles
         FROM hsdg.users u
         JOIN hsdg.offices o ON o.id = u.primary_office_id
         LEFT JOIN hsdg.user_roles ur ON ur.user_id = u.id
         LEFT JOIN hsdg.roles r ON r.id = ur.role_id
         WHERE u.id = $1
         GROUP BY u.id, o.code`,
        [id],
      );
      const row = rows[0];
      return row ? toUserListItem(row) : null;
    });
  }

  async listOffices(ctx: RlsContext): Promise<OfficeRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        code: string;
        name: string;
        is_active: boolean;
      }>(
        `SELECT id, code, name, is_active
         FROM hsdg.offices
         ORDER BY code`,
      );
      return rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        isActive: r.is_active,
      }));
    });
  }
}

function toUserListItem(row: {
  id: string;
  email: string;
  display_name: string;
  primary_office_id: string;
  office_code: string;
  is_active: boolean;
  roles: RoleSlug[];
}): UserListItem {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    officeId: row.primary_office_id,
    officeCode: row.office_code,
    isActive: row.is_active,
    roles: row.roles,
  };
}
