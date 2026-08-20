import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { EP_OPTIONAL_STATUSES, NOTIFICATION_TYPE, type EngagementStatus } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { translatePgError as mapPgError } from '../../common/errors/pg-error.util';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ENGAGEMENT_BASE, mapEngagement, selectEngagementDetail } from './engagement-detail.query';
import type { EngagementRow } from './engagement-detail.query';
import type {
  AssignTeamMemberInput,
  CreateEngagementInput,
  EngagementDetail,
  EngagementFilter,
  EngagementSummary,
  UpdateEngagementInput,
} from './engagements.types';

@Injectable()
export class EngagementsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async listEngagements(
    ctx: RlsContext,
    filter: EngagementFilter,
    page: PageParams,
  ): Promise<PageResult<EngagementSummary>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`eng.status = $${params.length}`);
    }
    if (filter.entityId) {
      params.push(filter.entityId);
      conditions.push(`eng.entity_id = $${params.length}`);
    }
    if (filter.serviceCode) {
      params.push(filter.serviceCode);
      conditions.push(`s.code = $${params.length}`);
    }
    if (filter.officeCode) {
      params.push(filter.officeCode);
      conditions.push(`o.code = $${params.length}`);
    }
    if (filter.mine) {
      // null (not '') so a user with no employee link yields no matches rather
      // than an invalid-uuid error.
      params.push(ctx.employeeId ?? null);
      const p = `$${params.length}`;
      conditions.push(
        `(eng.engagement_partner_id = ${p}::uuid OR eng.engagement_manager_id = ${p}::uuid
          OR EXISTS (SELECT 1 FROM hsdg.engagement_team t WHERE t.engagement_id = eng.id AND t.employee_id = ${p}::uuid))`,
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitParam = `$${params.length + 1}`;
    const offsetParam = `$${params.length + 2}`;
    params.push(page.limit, page.offset);

    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<
        EngagementRow & { team_count: string; total_count: string }
      >(
        `SELECT sub.*,
                (SELECT count(*) FROM hsdg.engagement_team t WHERE t.engagement_id = sub.id) AS team_count
         FROM (${ENGAGEMENT_BASE} ${where}
               ORDER BY eng.created_at DESC
               LIMIT ${limitParam} OFFSET ${offsetParam}) sub`,
        params,
      );
      // count(*) OVER() cannot ride inside the ORDER BY/LIMIT subquery cleanly
      // with the outer subquery here, so total is a separate cheap count.
      const totalResult = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM hsdg.engagements eng
         JOIN hsdg.services s ON s.id = eng.service_id
         JOIN hsdg.offices o ON o.id = eng.office_id ${where}`,
        params.slice(0, params.length - 2),
      );
      return {
        items: rows.map(mapEngagement),
        total: Number(totalResult.rows[0]?.total ?? 0),
      };
    });
  }

  async getEngagementById(ctx: RlsContext, id: string): Promise<EngagementDetail | null> {
    return this.db.withRlsContext(ctx, (client) => selectEngagementDetail(client, id));
  }

  async createEngagement(ctx: RlsContext, input: CreateEngagementInput): Promise<EngagementDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      // The client must be one the caller can see (office or via engagement).
      const entity = await client.query<{ id: string; home_office_id: string }>(
        `SELECT id, home_office_id FROM hsdg.entities WHERE id = $1`,
        [input.entityId],
      );
      if (!entity.rows[0]) {
        throw new BadRequestException('Entity not found or not accessible.');
      }
      const officeId = input.officeCode
        ? await this.resolveOfficeId(client, input.officeCode)
        : entity.rows[0].home_office_id;

      // Default accountability to the creator, but only into a role their grade
      // allows: a partner becomes the EP, a manager becomes the manager. RLS
      // then requires the EP/manager to be the caller unless they are firm-wide,
      // and the grade trigger rejects a non-partner EP / non-manager manager.
      let epId = input.engagementPartnerEmployeeId ?? null;
      let managerId = input.engagementManagerEmployeeId ?? null;
      if (ctx.employeeId && (epId === null || managerId === null)) {
        const grade = await this.callerGradeClass(client, ctx.employeeId);
        if (epId === null && grade === 'partner') epId = ctx.employeeId;
        if (managerId === null && grade === 'manager') managerId = ctx.employeeId;
      }

      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.engagements
             (entity_id, service_id, financial_year, period_label, office_id,
              engagement_partner_id, engagement_manager_id, status,
              predecessor_engagement_id, planned_start_date, planned_end_date, accepted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING id`,
          [
            input.entityId,
            input.serviceId,
            input.financialYear,
            input.periodLabel ?? 'FY',
            officeId,
            epId,
            managerId,
            input.status ?? 'prospect',
            input.predecessorEngagementId ?? null,
            input.plannedStartDate ?? null,
            input.plannedEndDate ?? null,
            isAccepted(input.status) ? new Date() : null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translatePgError(err);
      }

      const detail = await selectEngagementDetail(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'engagement.created',
        objectType: 'engagement',
        objectId: id,
        after: detail,
      });
      return detail!;
    });
  }

  async updateEngagement(
    ctx: RlsContext,
    id: string,
    input: UpdateEngagementInput,
  ): Promise<EngagementDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await selectEngagementDetail(client, id);
      if (!before) throw new NotFoundException('Engagement not found.');

      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, val: unknown): void => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.engagementManagerEmployeeId !== undefined) {
        set('engagement_manager_id', input.engagementManagerEmployeeId);
      }
      if (input.officeCode !== undefined) {
        set('office_id', await this.resolveOfficeId(client, input.officeCode));
      }
      if (input.plannedStartDate !== undefined) set('planned_start_date', input.plannedStartDate);
      if (input.plannedEndDate !== undefined) set('planned_end_date', input.plannedEndDate);
      if (sets.length === 0) return before;

      await this.versionedUpdate(client, id, sets, params, input.version);
      const after = await selectEngagementDetail(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'engagement.updated',
        objectType: 'engagement',
        objectId: id,
        before,
        after,
      });
      return after!;
    });
  }

  /** Change the accountable EP. RLS requires firm-wide authority (governance). */
  async reassignPartner(
    ctx: RlsContext,
    id: string,
    newEpEmployeeId: string,
    reason: string | undefined,
    expectedVersion?: number,
  ): Promise<EngagementDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await selectEngagementDetail(client, id);
      if (!before) throw new NotFoundException('Engagement not found.');

      // Optimistic concurrency is enforced atomically in the WHERE (not a
      // read-then-write compare), so a concurrent version bump between the read
      // above and this UPDATE cannot be lost.
      const params: unknown[] = [newEpEmployeeId, id];
      let versionClause = '';
      if (expectedVersion !== undefined) {
        params.push(expectedVersion);
        versionClause = ` AND version = $${params.length}`;
      }
      let updated: number;
      try {
        const result = await client.query(
          `UPDATE hsdg.engagements
           SET engagement_partner_id = $1, version = version + 1
           WHERE id = $2${versionClause}`,
          params,
        );
        updated = result.rowCount ?? 0;
      } catch (err) {
        throw translatePgError(err);
      }
      if (updated === 0) {
        // Distinguish a stale version (the row moved on) from an RLS/governance
        // denial (e.g. a non-firm-wide EP trying to hand off accountability).
        const current = await selectEngagementDetail(client, id);
        if (current && expectedVersion !== undefined && current.version !== expectedVersion) {
          throw new ConflictException(
            'Engagement was modified by someone else. Refresh and retry (stale version).',
          );
        }
        throw new ForbiddenException('Not permitted to reassign the Engagement Partner.');
      }
      const after = await selectEngagementDetail(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'engagement.ep_changed',
        objectType: 'engagement',
        objectId: id,
        before: { engagementPartnerId: before.engagementPartnerId },
        after: { engagementPartnerId: after!.engagementPartnerId },
        reason: reason ?? null,
      });
      // Notify the incoming EP (now accountable) and the outgoing EP.
      await this.notifications.emitWith(client, ctx, {
        type: NOTIFICATION_TYPE.epChanged,
        recipientEmployeeIds: [after!.engagementPartnerId, before.engagementPartnerId],
        title: `Engagement Partner changed — ${after!.engagementCode}`,
        body: `You are now the accountable EP for ${after!.engagementCode} (${after!.entityName}).`,
        engagementId: id,
        objectType: 'engagement',
        objectId: id,
      });
      return after!;
    });
  }

  async assignTeamMember(
    ctx: RlsContext,
    id: string,
    input: AssignTeamMemberInput,
  ): Promise<EngagementDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await selectEngagementDetail(client, id);
      if (!before) throw new NotFoundException('Engagement not found.');
      try {
        await client.query(
          `INSERT INTO hsdg.engagement_team (engagement_id, employee_id, role_on_engagement)
           VALUES ($1, $2, $3)`,
          [id, input.employeeId, input.roleOnEngagement ?? 'member'],
        );
      } catch (err) {
        throw translatePgError(err);
      }
      await this.bumpVersion(client, id);
      const after = await selectEngagementDetail(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'engagement.team_assigned',
        objectType: 'engagement',
        objectId: id,
        after: { employeeId: input.employeeId, role: input.roleOnEngagement ?? 'member' },
      });
      return after!;
    });
  }

  async removeTeamMember(
    ctx: RlsContext,
    id: string,
    employeeId: string,
  ): Promise<EngagementDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await selectEngagementDetail(client, id);
      if (!before) throw new NotFoundException('Engagement not found.');
      const result = await client.query(
        `DELETE FROM hsdg.engagement_team WHERE engagement_id = $1 AND employee_id = $2`,
        [id, employeeId],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new NotFoundException('Team member not found on this engagement.');
      }
      await this.bumpVersion(client, id);
      const after = await selectEngagementDetail(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'engagement.team_removed',
        objectType: 'engagement',
        objectId: id,
        after: { employeeId },
      });
      return after!;
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async versionedUpdate(
    client: PoolClient,
    id: string,
    sets: string[],
    params: unknown[],
    expectedVersion: number | undefined,
  ): Promise<void> {
    const withVersion = [...sets, 'version = version + 1'];
    const p = [...params, id];
    const idParam = `$${p.length}`;
    let versionClause = '';
    if (expectedVersion !== undefined) {
      p.push(expectedVersion);
      versionClause = ` AND version = $${p.length}`;
    }
    let updated: number;
    try {
      const result = await client.query(
        `UPDATE hsdg.engagements SET ${withVersion.join(', ')} WHERE id = ${idParam}${versionClause}`,
        p,
      );
      updated = result.rowCount ?? 0;
    } catch (err) {
      throw translatePgError(err);
    }
    if (updated === 0) {
      throw new ConflictException(
        'Engagement was modified by someone else. Refresh and retry (stale version).',
      );
    }
  }

  private async resolveOfficeId(client: PoolClient, code: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.offices WHERE code = $1`,
      [code],
    );
    if (!rows[0]) throw new BadRequestException(`Unknown office "${code}".`);
    return rows[0].id;
  }

  /** Increment the aggregate version so roster changes are visible to optimistic
   *  concurrency (team writes touch a child table, not the engagement row). */
  private async bumpVersion(client: PoolClient, id: string): Promise<void> {
    await client.query(`UPDATE hsdg.engagements SET version = version + 1 WHERE id = $1`, [id]);
  }

  /** Classify the caller's grade for accountability defaulting (partner ⇒ EP,
   *  manager ⇒ manager). Reads only the caller's own visible employee row. */
  private async callerGradeClass(
    client: PoolClient,
    employeeId: string,
  ): Promise<'partner' | 'manager' | 'other'> {
    const { rows } = await client.query<{ is_partner: boolean; is_manager: boolean }>(
      `SELECT g.is_partner_grade AS is_partner,
              (g.rank >= (SELECT rank FROM hsdg.grades WHERE slug = 'manager')) AS is_manager
       FROM hsdg.employees e JOIN hsdg.grades g ON g.id = e.grade_id
       WHERE e.id = $1`,
      [employeeId],
    );
    if (!rows[0]) return 'other';
    if (rows[0].is_partner) return 'partner';
    if (rows[0].is_manager) return 'manager';
    return 'other';
  }
}

function isAccepted(status: EngagementStatus | undefined): boolean {
  return status !== undefined && !EP_OPTIONAL_STATUSES.includes(status);
}

/** Map PostgreSQL constraint/RLS violations to clean HTTP errors (engagement domain). */
export function translatePgError(err: unknown): Error {
  return mapPgError(err, {
    unique: [
      {
        match: 'identity',
        message: 'An engagement already exists for this client, service, year and period.',
      },
      { match: 'engagement_team', message: 'That employee is already on the engagement team.' },
    ],
    uniqueDefault: 'A duplicate value violates a unique constraint.',
    foreignKey: 'A referenced record does not exist.',
    check: 'Invalid engagement state — an accepted engagement requires an Engagement Partner.',
    // Raised by the engagement grade-/review-plan triggers; the message is a
    // fixed, developer-authored string — safe to surface when short.
    raise: (message) =>
      message && message.length <= 200 ? message : 'Invalid engagement accountability.',
    forbidden: 'Not permitted to write this engagement.',
  });
}
