import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  GRADE,
  type AddArticleshipLeaveInput,
  type Articleship,
  type ArticleshipDetail,
  type ArticleshipLeave,
  type ArticleshipScheme,
  type ArticleshipStatus,
  type EndArticleshipInput,
  type SaveArticleshipInput,
  type UpdateArticleshipSchemeInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

/** The register, with the person, principal, scheme and leave taken. */
const ARTICLESHIP_SELECT = `
  SELECT a.*, e.employee_code, e.full_name AS employee_name, o.code AS office_code,
         p.full_name AS principal_name, pp.membership_no AS principal_membership_no,
         s.label AS scheme_label, s.leave_entitlement_days AS scheme_leave_days,
         COALESCE((SELECT sum(l.days) FROM hsdg.articleship_leaves l
                    WHERE l.articleship_id = a.id), 0)::text AS leave_taken
    FROM hsdg.articleships a
    JOIN hsdg.employees e ON e.id = a.employee_id
    JOIN hsdg.offices o ON o.id = e.primary_office_id
    JOIN hsdg.employees p ON p.id = a.principal_employee_id
    LEFT JOIN hsdg.partner_profiles pp ON pp.employee_id = p.id
    JOIN hsdg.articleship_schemes s ON s.code = a.scheme_code`;

interface ArticleshipRow {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  office_code: string;
  principal_employee_id: string;
  principal_name: string;
  principal_membership_no: string | null;
  scheme_code: string;
  scheme_label: string;
  scheme_leave_days: number | null;
  icai_registration_no: string | null;
  icai_registration_date: string | null;
  start_date: string;
  expected_completion: string;
  leave_entitlement_days: number | null;
  leave_taken: string;
  transferred_from: string | null;
  status: ArticleshipStatus;
  ended_on: string | null;
  end_note: string | null;
  version: number;
}

/** Start date plus whole months, as a calendar date (clamped to month end). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/**
 * The articleship register (spec §4.7). HR and the Managing Partner keep it;
 * the article and their principal can read their own (RLS decides).
 */
@Injectable()
export class ArticleshipService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async schemes(ctx: RlsContext): Promise<ArticleshipScheme[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        code: string;
        label: string;
        period_months: number;
        leave_entitlement_days: number | null;
        is_active: boolean;
      }>(`SELECT * FROM hsdg.articleship_schemes ORDER BY sort_order, code`);
      return rows.map((r) => ({
        code: r.code,
        label: r.label,
        periodMonths: r.period_months,
        leaveEntitlementDays: r.leave_entitlement_days,
        isActive: r.is_active,
      }));
    });
  }

  async updateScheme(
    ctx: RlsContext,
    code: string,
    input: UpdateArticleshipSchemeInput,
  ): Promise<ArticleshipScheme> {
    await this.db.withRlsContext(ctx, async (client) => {
      const before = await client.query(`SELECT * FROM hsdg.articleship_schemes WHERE code = $1`, [
        code,
      ]);
      if (!before.rows[0]) throw new NotFoundException('Scheme not found.');
      const { rowCount } = await client.query(
        `UPDATE hsdg.articleship_schemes
            SET label = COALESCE($2, label),
                period_months = COALESCE($3, period_months),
                leave_entitlement_days = CASE WHEN $4::boolean THEN $5::int
                                              ELSE leave_entitlement_days END,
                is_active = COALESCE($6, is_active)
          WHERE code = $1`,
        [
          code,
          input.label ?? null,
          input.periodMonths ?? null,
          input.leaveEntitlementDays !== undefined,
          input.leaveEntitlementDays ?? null,
          input.isActive ?? null,
        ],
      );
      if (!rowCount) throw new NotFoundException('Scheme not found.');
      await this.audit.recordWith(client, ctx, {
        action: 'articleship_scheme.updated',
        objectType: 'articleship_scheme',
        before: before.rows[0],
        after: input,
      });
    });
    const found = (await this.schemes(ctx)).find((s) => s.code === code);
    return found!;
  }

  /** The register: every articleship the caller can see, active first. */
  async list(ctx: RlsContext, status?: ArticleshipStatus): Promise<Articleship[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<ArticleshipRow>(
        `${ARTICLESHIP_SELECT}
          WHERE ($1::text IS NULL OR a.status = $1)
          ORDER BY (a.status = 'active') DESC, a.expected_completion, e.full_name`,
        [status ?? null],
      );
      return rows.map(mapArticleship);
    });
  }

  /** One person's articleships, newest first, with leave. */
  async forEmployee(ctx: RlsContext, employeeId: string): Promise<ArticleshipDetail[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<ArticleshipRow>(
        `${ARTICLESHIP_SELECT} WHERE a.employee_id = $1 ORDER BY a.start_date DESC`,
        [employeeId],
      );
      const out: ArticleshipDetail[] = [];
      for (const r of rows)
        out.push({ ...mapArticleship(r), leaves: await this.leaves(client, r.id) });
      return out;
    });
  }

  /** Create the articleship, or edit the active one (versioned, audited). */
  async save(
    ctx: RlsContext,
    employeeId: string,
    input: SaveArticleshipInput,
  ): Promise<ArticleshipDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const person = await this.employee(client, employeeId);
      if (!person) throw new NotFoundException('Employee not found.');
      if (person.grade_slug !== GRADE.article) {
        throw new BadRequestException('Only an article has an articleship.');
      }
      const principal = await this.employee(client, input.principalEmployeeId);
      if (!principal || !principal.is_partner_grade) {
        throw new BadRequestException('The principal must be a partner.');
      }
      const scheme = await client.query<{ period_months: number; is_active: boolean }>(
        `SELECT period_months, is_active FROM hsdg.articleship_schemes WHERE code = $1`,
        [input.schemeCode],
      );
      if (!scheme.rows[0]) throw new BadRequestException(`Unknown scheme "${input.schemeCode}".`);
      const completion =
        input.expectedCompletion ?? addMonths(input.startDate, scheme.rows[0].period_months);

      const current = await client.query<ArticleshipRow>(
        `${ARTICLESHIP_SELECT} WHERE a.employee_id = $1 AND a.status = 'active'`,
        [employeeId],
      );
      const before = current.rows[0] ? mapArticleship(current.rows[0]) : null;
      const values = [
        input.principalEmployeeId,
        input.schemeCode,
        input.icaiRegistrationNo?.trim() || null,
        input.icaiRegistrationDate ?? null,
        input.startDate,
        completion,
        input.leaveEntitlementDays ?? null,
        input.transferredFrom?.trim() || null,
      ];
      let id: string;
      try {
        if (!before) {
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO hsdg.articleships
               (principal_employee_id, scheme_code, icai_registration_no, icai_registration_date,
                start_date, expected_completion, leave_entitlement_days, transferred_from,
                employee_id, created_by_user_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NULLIF($10,'')::uuid)
             RETURNING id`,
            [...values, employeeId, ctx.userId],
          );
          id = rows[0]!.id;
        } else {
          const { rowCount } = await client.query(
            `UPDATE hsdg.articleships
                SET principal_employee_id = $1, scheme_code = $2, icai_registration_no = $3,
                    icai_registration_date = $4, start_date = $5, expected_completion = $6,
                    leave_entitlement_days = $7, transferred_from = $8, version = version + 1
              WHERE id = $9 AND ($10::int IS NULL OR version = $10)`,
            [...values, before.id, input.version ?? null],
          );
          if (!rowCount) {
            throw new ConflictException(
              'The articleship was changed by someone else. Reload and try again.',
            );
          }
          id = before.id;
        }
      } catch (err) {
        throw translate(err);
      }
      const after = await this.detail(client, id);
      await this.audit.recordWith(client, ctx, {
        action: before ? 'articleship.updated' : 'articleship.created',
        objectType: 'articleship',
        objectId: id,
        ...(before ? { before } : {}),
        after: { ...after, leaves: undefined },
      });
      return after;
    });
  }

  /** Complete, transfer out or terminate the active articleship. */
  async end(
    ctx: RlsContext,
    employeeId: string,
    input: EndArticleshipInput,
  ): Promise<ArticleshipDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.active(client, employeeId);
      if (input.endedOn < current.startDate) {
        throw new BadRequestException('The articleship can’t end before it started.');
      }
      const { rowCount } = await client.query(
        `UPDATE hsdg.articleships
            SET status = $2, ended_on = $3, end_note = $4, version = version + 1
          WHERE id = $1 AND ($5::int IS NULL OR version = $5)`,
        [
          current.id,
          input.status,
          input.endedOn,
          input.note?.trim() || null,
          input.version ?? null,
        ],
      );
      if (!rowCount) {
        throw new ConflictException(
          'The articleship was changed by someone else. Reload and try again.',
        );
      }
      const after = await this.detail(client, current.id);
      await this.audit.recordWith(client, ctx, {
        action: 'articleship.ended',
        objectType: 'articleship',
        objectId: current.id,
        before: { status: current.status },
        after: { status: input.status, endedOn: input.endedOn },
        ...(input.note ? { reason: input.note } : {}),
      });
      return after;
    });
  }

  async addLeave(
    ctx: RlsContext,
    employeeId: string,
    input: AddArticleshipLeaveInput,
  ): Promise<ArticleshipDetail> {
    if (input.toDate < input.fromDate) {
      throw new BadRequestException('The leave can’t end before it starts.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.active(client, employeeId);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.articleship_leaves
           (articleship_id, from_date, to_date, days, kind, note, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6, NULLIF($7,'')::uuid) RETURNING id`,
        [
          current.id,
          input.fromDate,
          input.toDate,
          input.days,
          input.kind,
          input.note?.trim() || null,
          ctx.userId,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'articleship.leave_added',
        objectType: 'articleship',
        objectId: current.id,
        after: { leaveId: rows[0]!.id, ...input },
      });
      return this.detail(client, current.id);
    });
  }

  async removeLeave(
    ctx: RlsContext,
    employeeId: string,
    leaveId: string,
  ): Promise<ArticleshipDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.active(client, employeeId);
      const { rows } = await client.query(
        `DELETE FROM hsdg.articleship_leaves WHERE id = $1 AND articleship_id = $2 RETURNING *`,
        [leaveId, current.id],
      );
      if (!rows[0]) throw new NotFoundException('Leave entry not found.');
      await this.audit.recordWith(client, ctx, {
        action: 'articleship.leave_removed',
        objectType: 'articleship',
        objectId: current.id,
        before: rows[0],
      });
      return this.detail(client, current.id);
    });
  }

  private async active(client: PoolClient, employeeId: string): Promise<Articleship> {
    const { rows } = await client.query<ArticleshipRow>(
      `${ARTICLESHIP_SELECT} WHERE a.employee_id = $1 AND a.status = 'active'`,
      [employeeId],
    );
    if (!rows[0]) throw new NotFoundException('No active articleship for this person.');
    return mapArticleship(rows[0]);
  }

  private async detail(client: PoolClient, id: string): Promise<ArticleshipDetail> {
    const { rows } = await client.query<ArticleshipRow>(`${ARTICLESHIP_SELECT} WHERE a.id = $1`, [
      id,
    ]);
    return { ...mapArticleship(rows[0]!), leaves: await this.leaves(client, id) };
  }

  private async leaves(client: PoolClient, articleshipId: string): Promise<ArticleshipLeave[]> {
    const { rows } = await client.query<{
      id: string;
      from_date: string;
      to_date: string;
      days: string;
      kind: ArticleshipLeave['kind'];
      note: string | null;
      created_at: Date;
    }>(`SELECT * FROM hsdg.articleship_leaves WHERE articleship_id = $1 ORDER BY from_date DESC`, [
      articleshipId,
    ]);
    return rows.map((r) => ({
      id: r.id,
      fromDate: r.from_date,
      toDate: r.to_date,
      days: Number(r.days),
      kind: r.kind,
      note: r.note,
      createdAt: r.created_at.toISOString(),
    }));
  }

  private async employee(
    client: PoolClient,
    id: string,
  ): Promise<{ grade_slug: string; is_partner_grade: boolean } | null> {
    const { rows } = await client.query<{ grade_slug: string; is_partner_grade: boolean }>(
      `SELECT g.slug AS grade_slug, g.is_partner_grade
         FROM hsdg.employees e JOIN hsdg.grades g ON g.id = e.grade_id WHERE e.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }
}

function mapArticleship(r: ArticleshipRow): Articleship {
  const own = r.leave_entitlement_days;
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    employeeName: r.employee_name,
    officeCode: r.office_code,
    principalEmployeeId: r.principal_employee_id,
    principalName: r.principal_name,
    principalMembershipNo: r.principal_membership_no,
    schemeCode: r.scheme_code,
    schemeLabel: r.scheme_label,
    icaiRegistrationNo: r.icai_registration_no,
    icaiRegistrationDate: r.icai_registration_date,
    startDate: r.start_date,
    expectedCompletion: r.expected_completion,
    leaveEntitlementDays: own ?? r.scheme_leave_days,
    leaveEntitlementOverridden: own !== null,
    leaveTakenDays: Number(r.leave_taken),
    transferredFrom: r.transferred_from,
    status: r.status,
    endedOn: r.ended_on,
    endNote: r.end_note,
    version: r.version,
  };
}

function translate(err: unknown): Error {
  const { code, constraint } = err as { code?: string; constraint?: string };
  if (code === '23505' && constraint === 'articleships_one_active') {
    return new ConflictException('This person already has an active articleship.');
  }
  if (code === '23514') {
    if (constraint === 'articleship_completion_after_start') {
      return new BadRequestException('Expected completion must be after the start date.');
    }
    if (constraint === 'articleship_not_own_principal') {
      return new BadRequestException('An article can’t be their own principal.');
    }
    return new BadRequestException('The articleship details aren’t valid.');
  }
  if (code === '42501') return new ForbiddenException('Only HR can change the register.');
  return err as Error;
}
