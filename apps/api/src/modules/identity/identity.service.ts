import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { SYSTEM_ROLE, type RoleSlug } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { AuditService } from '../audit/audit.service';
import type {
  CreateOfficeInput,
  CreateUserInput,
  OfficeRecord,
  PrincipalData,
  RoleRecord,
  UpdateOfficeInput,
  UpdateUserInput,
  UserListItem,
} from './identity.types';

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
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

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

  /** Assignable roles, for the Administration role picker. */
  async listRoles(ctx: RlsContext): Promise<RoleRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        slug: RoleSlug;
        name: string;
        description: string | null;
      }>(
        `SELECT id, slug, name, description
         FROM hsdg.roles
         WHERE slug <> 'system'
         ORDER BY CASE slug
           WHEN 'managing_partner' THEN 1 WHEN 'admin' THEN 2 WHEN 'partner' THEN 3
           WHEN 'manager' THEN 4 WHEN 'senior' THEN 5 WHEN 'article' THEN 6 ELSE 7 END`,
      );
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
      }));
    });
  }

  async createUser(ctx: RlsContext, input: CreateUserInput): Promise<UserListItem> {
    return this.db.withRlsContext(ctx, async (client) => {
      const officeId = await this.resolveOfficeId(client, input.officeCode);

      let createdId: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.users (email, display_name, primary_office_id, mfa_required)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [input.email, input.displayName, officeId, input.mfaRequired ?? false],
        );
        createdId = rows[0]!.id;
      } catch (err) {
        throw translateUserPgError(err);
      }

      if (input.roles && input.roles.length > 0) {
        await this.replaceRoles(client, createdId, input.roles);
      }

      const created = (await this.selectUser(client, createdId))!;
      await this.audit.recordWith(client, ctx, {
        action: 'user.created',
        objectType: 'user',
        objectId: createdId,
        after: created,
      });
      return created;
    });
  }

  async updateUser(ctx: RlsContext, id: string, input: UpdateUserInput): Promise<UserListItem> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectUser(client, id);
      if (!before) throw new NotFoundException('User not found.');

      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };

      if (input.displayName !== undefined) set('display_name', input.displayName);
      if (input.officeCode !== undefined) {
        set('primary_office_id', await this.resolveOfficeId(client, input.officeCode));
      }
      if (input.isActive !== undefined) set('is_active', input.isActive);
      if (input.mfaRequired !== undefined) set('mfa_required', input.mfaRequired);

      if (sets.length === 0) return before;

      params.push(id);
      try {
        await client.query(
          `UPDATE hsdg.users SET ${sets.join(', ')} WHERE id = $${params.length}`,
          params,
        );
      } catch (err) {
        throw translateUserPgError(err);
      }

      const after = (await this.selectUser(client, id))!;
      await this.audit.recordWith(client, ctx, {
        action: 'user.updated',
        objectType: 'user',
        objectId: id,
        before,
        after,
      });
      return after;
    });
  }

  /** Replace a user's full role set (idempotent). Records before/after roles. */
  async setUserRoles(ctx: RlsContext, id: string, roles: RoleSlug[]): Promise<UserListItem> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectUser(client, id);
      if (!before) throw new NotFoundException('User not found.');

      await this.replaceRoles(client, id, roles);

      const after = (await this.selectUser(client, id))!;
      await this.audit.recordWith(client, ctx, {
        action: 'user.roles_changed',
        objectType: 'user',
        objectId: id,
        before: { roles: before.roles },
        after: { roles: after.roles },
      });
      return after;
    });
  }

  async createOffice(ctx: RlsContext, input: CreateOfficeInput): Promise<OfficeRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      let created: OfficeRecord;
      try {
        const { rows } = await client.query<{
          id: string;
          code: string;
          name: string;
          is_active: boolean;
        }>(
          `INSERT INTO hsdg.offices (code, name)
           VALUES ($1, $2)
           RETURNING id, code, name, is_active`,
          [input.code, input.name],
        );
        const r = rows[0]!;
        created = { id: r.id, code: r.code, name: r.name, isActive: r.is_active };
      } catch (err) {
        throw translateOfficePgError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'office.created',
        objectType: 'office',
        objectId: created.id,
        after: created,
      });
      return created;
    });
  }

  async updateOffice(ctx: RlsContext, id: string, input: UpdateOfficeInput): Promise<OfficeRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectOffice(client, id);
      if (!before) throw new NotFoundException('Office not found.');

      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (input.name !== undefined) set('name', input.name);
      if (input.isActive !== undefined) set('is_active', input.isActive);
      if (sets.length === 0) return before;

      params.push(id);
      try {
        await client.query(
          `UPDATE hsdg.offices SET ${sets.join(', ')} WHERE id = $${params.length}`,
          params,
        );
      } catch (err) {
        throw translateOfficePgError(err);
      }

      const after = (await this.selectOffice(client, id))!;
      await this.audit.recordWith(client, ctx, {
        action: 'office.updated',
        objectType: 'office',
        objectId: id,
        before,
        after,
      });
      return after;
    });
  }

  // ── private helpers ───────────────────────────────────────────────────────

  private async replaceRoles(client: PoolClient, userId: string, roles: RoleSlug[]): Promise<void> {
    const unique = [...new Set(roles)];
    await client.query(`DELETE FROM hsdg.user_roles WHERE user_id = $1`, [userId]);
    for (const slug of unique) {
      const roleId = await this.resolveRoleId(client, slug);
      await client.query(
        `INSERT INTO hsdg.user_roles (user_id, role_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [userId, roleId],
      );
    }
  }

  private async resolveRoleId(client: PoolClient, slug: RoleSlug): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.roles WHERE slug = $1 AND slug <> 'system'`,
      [slug],
    );
    if (!rows[0]) throw new BadRequestException(`Unknown role "${slug}".`);
    return rows[0].id;
  }

  private async resolveOfficeId(client: PoolClient, code: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.offices WHERE code = $1`,
      [code],
    );
    if (!rows[0]) throw new BadRequestException(`Unknown office "${code}".`);
    return rows[0].id;
  }

  private async selectUser(client: PoolClient, id: string): Promise<UserListItem | null> {
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
    return rows[0] ? toUserListItem(rows[0]) : null;
  }

  private async selectOffice(client: PoolClient, id: string): Promise<OfficeRecord | null> {
    const { rows } = await client.query<{
      id: string;
      code: string;
      name: string;
      is_active: boolean;
    }>(`SELECT id, code, name, is_active FROM hsdg.offices WHERE id = $1`, [id]);
    const r = rows[0];
    return r ? { id: r.id, code: r.code, name: r.name, isActive: r.is_active } : null;
  }
}

/** Map PostgreSQL constraint violations on users to clean HTTP errors. */
function translateUserPgError(err: unknown): Error {
  const code = (err as { code?: string }).code;
  if (code === '23505') return new ConflictException('A user with this email already exists.');
  if (code === '23503') return new BadRequestException('Referenced office does not exist.');
  if (code === '23514') return new BadRequestException('User data violates a constraint.');
  return err as Error;
}

/** Map PostgreSQL constraint violations on offices to clean HTTP errors. */
function translateOfficePgError(err: unknown): Error {
  const code = (err as { code?: string }).code;
  if (code === '23505') return new ConflictException('An office with this code already exists.');
  if (code === '23514')
    return new BadRequestException('Office code must be 2–20 chars of A–Z, 0–9, - or _.');
  return err as Error;
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
