import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { EMPLOYMENT_STATUS, type EmploymentStatus, type GradeSlug } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { AuditService } from '../audit/audit.service';
import type {
  CreateEmployeeInput,
  EmployeeFilter,
  EmployeeRecord,
  UpdateEmployeeInput,
} from './organisation.types';

/** Shared projection for an employee with its grade, office, manager, profile. */
const EMPLOYEE_SELECT = `
  SELECT e.id, e.employee_code, e.full_name, e.user_id, u.email AS user_email,
         g.slug AS grade_slug, g.name AS grade_name, g.is_partner_grade,
         e.primary_office_id, o.code AS office_code,
         e.reports_to_id, m.full_name AS reports_to_name,
         e.employment_status, e.date_of_joining, e.date_of_exit,
         pp.membership_no, pp.partner_since, e.version, g.rank AS grade_rank
  FROM hsdg.employees e
  JOIN hsdg.grades g ON g.id = e.grade_id
  JOIN hsdg.offices o ON o.id = e.primary_office_id
  LEFT JOIN hsdg.users u ON u.id = e.user_id
  LEFT JOIN hsdg.employees m ON m.id = e.reports_to_id
  LEFT JOIN hsdg.partner_profiles pp ON pp.employee_id = e.id`;

interface EmployeeRow {
  id: string;
  employee_code: string;
  full_name: string;
  user_id: string | null;
  user_email: string | null;
  grade_slug: GradeSlug;
  grade_name: string;
  is_partner_grade: boolean;
  primary_office_id: string;
  office_code: string;
  reports_to_id: string | null;
  reports_to_name: string | null;
  employment_status: EmploymentStatus;
  // `date` columns are returned as raw 'YYYY-MM-DD' strings (see pg-types.ts).
  date_of_joining: string;
  date_of_exit: string | null;
  membership_no: string | null;
  partner_since: string | null;
  version: number;
}

@Injectable()
export class OrganisationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async listEmployees(
    ctx: RlsContext,
    filter: EmployeeFilter,
    page: PageParams,
  ): Promise<PageResult<EmployeeRecord>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`e.employment_status = $${params.length}`);
    }
    if (filter.gradeSlug) {
      params.push(filter.gradeSlug);
      conditions.push(`g.slug = $${params.length}`);
    }
    if (filter.officeCode) {
      params.push(filter.officeCode);
      conditions.push(`o.code = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitParam = `$${params.length + 1}`;
    const offsetParam = `$${params.length + 2}`;
    params.push(page.limit, page.offset);

    return this.db.withRlsContext(ctx, async (client) => {
      // One round-trip: the window count() gives the pre-limit total.
      const { rows } = await client.query<EmployeeRow & { total_count: string }>(
        `SELECT sub.*, count(*) OVER() AS total_count
         FROM (${EMPLOYEE_SELECT} ${where}) sub
         ORDER BY sub.grade_rank DESC, sub.full_name
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params,
      );
      return {
        items: rows.map(mapEmployee),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }

  async getEmployeeById(ctx: RlsContext, id: string): Promise<EmployeeRecord | null> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<EmployeeRow>(`${EMPLOYEE_SELECT} WHERE e.id = $1`, [id]);
      return rows[0] ? mapEmployee(rows[0]) : null;
    });
  }

  async listDirectReports(ctx: RlsContext, managerId: string): Promise<EmployeeRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<EmployeeRow>(
        `${EMPLOYEE_SELECT} WHERE e.reports_to_id = $1 ORDER BY g.rank DESC, e.full_name`,
        [managerId],
      );
      return rows.map(mapEmployee);
    });
  }

  async listPartners(ctx: RlsContext): Promise<EmployeeRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<EmployeeRow>(
        `${EMPLOYEE_SELECT} WHERE g.is_partner_grade ORDER BY e.full_name`,
      );
      return rows.map(mapEmployee);
    });
  }

  async createEmployee(ctx: RlsContext, input: CreateEmployeeInput): Promise<EmployeeRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const gradeId = await this.resolveGradeId(client, input.gradeSlug);
      const officeId = await this.resolveOfficeId(client, input.officeCode);

      const status = input.employmentStatus ?? EMPLOYMENT_STATUS.active;
      let createdId: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.employees
             (employee_code, full_name, user_id, grade_id, primary_office_id,
              reports_to_id, employment_status, date_of_joining)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            input.employeeCode,
            input.fullName,
            input.userId ?? null,
            gradeId,
            officeId,
            input.reportsToId ?? null,
            status,
            input.dateOfJoining,
          ],
        );
        createdId = rows[0]!.id;
      } catch (err) {
        throw translatePgError(err);
      }

      const created = await this.selectById(client, createdId);
      await this.audit.recordWith(client, ctx, {
        action: 'employee.created',
        objectType: 'employee',
        objectId: createdId,
        after: created,
      });
      return created!;
    });
  }

  async updateEmployee(
    ctx: RlsContext,
    id: string,
    input: UpdateEmployeeInput,
  ): Promise<EmployeeRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectById(client, id);
      if (!before) {
        throw new NotFoundException('Employee not found.');
      }

      const nextStatus = input.employmentStatus ?? before.employmentStatus;
      const nextExit = input.dateOfExit !== undefined ? input.dateOfExit : before.dateOfExit;
      if (nextStatus === EMPLOYMENT_STATUS.exited && !nextExit) {
        throw new BadRequestException('An exited employee requires a date of exit.');
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };

      if (input.fullName !== undefined) set('full_name', input.fullName);
      if (input.gradeSlug !== undefined) {
        set('grade_id', await this.resolveGradeId(client, input.gradeSlug));
      }
      if (input.officeCode !== undefined) {
        set('primary_office_id', await this.resolveOfficeId(client, input.officeCode));
      }
      if (input.reportsToId !== undefined) set('reports_to_id', input.reportsToId);
      if (input.employmentStatus !== undefined) set('employment_status', input.employmentStatus);
      if (input.dateOfExit !== undefined) set('date_of_exit', input.dateOfExit);

      if (sets.length === 0) {
        return before; // Nothing to change.
      }

      // Optimistic concurrency: always bump the version; if the caller supplied
      // an expected version, only update when it still matches (else 409).
      sets.push('version = version + 1');
      params.push(id);
      const idParam = `$${params.length}`;
      let versionClause = '';
      if (input.version !== undefined) {
        params.push(input.version);
        versionClause = ` AND version = $${params.length}`;
      }

      let updated: number;
      try {
        const result = await client.query(
          `UPDATE hsdg.employees SET ${sets.join(', ')} WHERE id = ${idParam}${versionClause}`,
          params,
        );
        updated = result.rowCount ?? 0;
      } catch (err) {
        throw translatePgError(err);
      }

      if (updated === 0) {
        // The row exists (checked above), so a zero-row update means the
        // supplied version was stale — someone else changed it first.
        throw new ConflictException(
          'Employee was modified by someone else. Refresh and retry (stale version).',
        );
      }

      const after = await this.selectById(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'employee.updated',
        objectType: 'employee',
        objectId: id,
        before,
        after,
      });
      return after!;
    });
  }

  private async selectById(client: PoolClient, id: string): Promise<EmployeeRecord | null> {
    const { rows } = await client.query<EmployeeRow>(`${EMPLOYEE_SELECT} WHERE e.id = $1`, [id]);
    return rows[0] ? mapEmployee(rows[0]) : null;
  }

  private async resolveGradeId(client: PoolClient, slug: GradeSlug): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.grades WHERE slug = $1`,
      [slug],
    );
    if (!rows[0]) throw new BadRequestException(`Unknown grade "${slug}".`);
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
}

function mapEmployee(row: EmployeeRow): EmployeeRecord {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    fullName: row.full_name,
    userId: row.user_id,
    userEmail: row.user_email,
    gradeSlug: row.grade_slug,
    gradeName: row.grade_name,
    isPartner: row.is_partner_grade,
    officeId: row.primary_office_id,
    officeCode: row.office_code,
    reportsToId: row.reports_to_id,
    reportsToName: row.reports_to_name,
    employmentStatus: row.employment_status,
    dateOfJoining: row.date_of_joining,
    dateOfExit: row.date_of_exit,
    membershipNo: row.membership_no,
    partnerSince: row.partner_since,
    version: row.version,
  };
}

/** Map PostgreSQL constraint violations to clean HTTP errors. */
export function translatePgError(err: unknown): Error {
  const code = (err as { code?: string }).code;
  if (code === '23505') return new ConflictException('Employee code already exists.');
  if (code === '23503')
    return new BadRequestException('Referenced user, grade, or office does not exist.');
  if (code === '23514') return new BadRequestException('Employee data violates a constraint.');
  return err as Error;
}
