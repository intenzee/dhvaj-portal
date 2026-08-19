import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { CLIENT_DEPENDENCY_STATUS, type ClientDependencyStatus } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { mapTaskError } from './tasks.service';
import type {
  ClientDependencyRecord,
  ClientDependencyWithContext,
  CloseClientDependencyInput,
  CreateClientDependencyInput,
  ReceiveClientDependencyInput,
  UpdateClientDependencyInput,
} from './tasks.types';

interface DependencyRow {
  id: string;
  engagement_id: string;
  requested_info: string;
  outstanding_items: string | null;
  responsible_employee_id: string | null;
  responsible_name: string | null;
  created_by_employee_id: string | null;
  created_by_name: string | null;
  request_date: string;
  reminder_date: string | null;
  escalation_date: string | null;
  received_date: string | null;
  status: ClientDependencyStatus;
  is_open: boolean;
  is_overdue: boolean;
  reminder_due: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const DEP_BASE = `
  SELECT cd.id, cd.engagement_id, cd.requested_info, cd.outstanding_items,
         cd.responsible_employee_id, re.full_name AS responsible_name,
         cd.created_by_employee_id, ce.full_name AS created_by_name,
         cd.request_date::text, cd.reminder_date::text, cd.escalation_date::text, cd.received_date::text,
         cd.status,
         (cd.status IN ('pending', 'partially_received')) AS is_open,
         (cd.status IN ('pending', 'partially_received') AND cd.escalation_date IS NOT NULL
           AND cd.escalation_date < CURRENT_DATE) AS is_overdue,
         (cd.status IN ('pending', 'partially_received') AND cd.reminder_date IS NOT NULL
           AND cd.reminder_date < CURRENT_DATE) AS reminder_due,
         cd.version, cd.created_at, cd.updated_at
  FROM hsdg.client_dependencies cd
  LEFT JOIN hsdg.employees re ON re.id = cd.responsible_employee_id
  LEFT JOIN hsdg.employees ce ON ce.id = cd.created_by_employee_id`;

/**
 * Client dependencies (Phase 9) — information requested FROM the client. An open
 * dependency is what makes an engagement "waiting for client". Members read;
 * leads manage (client-facing governance). Every mutation is audited.
 */
@Injectable()
export class ClientDependenciesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async request(
    ctx: RlsContext,
    engagementId: string,
    input: CreateClientDependencyInput,
  ): Promise<ClientDependencyRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.requireEngagement(client, engagementId);
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.client_dependencies
             (engagement_id, requested_info, outstanding_items, responsible_employee_id,
              created_by_employee_id, request_date, reminder_date, escalation_date)
           VALUES ($1,$2,$3,$4,$5,COALESCE($6, CURRENT_DATE),$7,$8) RETURNING id`,
          [
            engagementId,
            input.requestedInfo,
            input.outstandingItems ?? null,
            input.responsibleEmployeeId ?? null,
            ctx.employeeId ?? null,
            input.requestDate ?? null,
            input.reminderDate ?? null,
            input.escalationDate ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw mapTaskError(err);
      }
      const dep = await this.selectDependency(client, id, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'client_dependency.requested',
        objectType: 'client_dependency',
        objectId: id,
        after: { engagementId, requestedInfo: input.requestedInfo },
      });
      return dep!;
    });
  }

  async list(
    ctx: RlsContext,
    engagementId: string,
    page: PageParams,
    filter: { status?: ClientDependencyStatus; openOnly?: boolean },
  ): Promise<PageResult<ClientDependencyRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.requireEngagement(client, engagementId);
      const params: unknown[] = [engagementId];
      const conds = ['cd.engagement_id = $1'];
      if (filter.status) {
        params.push(filter.status);
        conds.push(`cd.status = $${params.length}`);
      }
      if (filter.openOnly) conds.push(`cd.status IN ('pending', 'partially_received')`);
      const where = `WHERE ${conds.join(' AND ')}`;
      params.push(page.limit, page.offset);
      const { rows } = await client.query<DependencyRow>(
        `${DEP_BASE} ${where}
         ORDER BY cd.escalation_date NULLS LAST, cd.request_date
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const totalRes = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM hsdg.client_dependencies cd ${where}`,
        params.slice(0, params.length - 2),
      );
      return { items: rows.map(mapDependency), total: Number(totalRes.rows[0]?.total ?? 0) };
    });
  }

  async getOne(
    ctx: RlsContext,
    engagementId: string,
    dependencyId: string,
  ): Promise<ClientDependencyRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const dep = await this.selectDependency(client, dependencyId, engagementId);
      if (!dep) throw new NotFoundException('Client dependency not found.');
      return dep;
    });
  }

  async update(
    ctx: RlsContext,
    engagementId: string,
    dependencyId: string,
    input: UpdateClientDependencyInput,
  ): Promise<ClientDependencyRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectDependency(client, dependencyId, engagementId);
      if (!before) throw new NotFoundException('Client dependency not found.');
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, val: unknown): void => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.outstandingItems !== undefined) set('outstanding_items', input.outstandingItems);
      if (input.responsibleEmployeeId !== undefined)
        set('responsible_employee_id', input.responsibleEmployeeId);
      if (input.reminderDate !== undefined) set('reminder_date', input.reminderDate);
      if (input.escalationDate !== undefined) set('escalation_date', input.escalationDate);
      if (sets.length === 0) return before;

      await this.versionedUpdate(client, dependencyId, engagementId, sets, params, input.version);
      const after = await this.selectDependency(client, dependencyId, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'client_dependency.updated',
        objectType: 'client_dependency',
        objectId: dependencyId,
        after: { engagementId },
      });
      return after!;
    });
  }

  /** Record receipt (fully or partially) of the requested information. */
  async receive(
    ctx: RlsContext,
    engagementId: string,
    dependencyId: string,
    input: ReceiveClientDependencyInput,
  ): Promise<ClientDependencyRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectDependency(client, dependencyId, engagementId);
      if (!before) throw new NotFoundException('Client dependency not found.');
      const status = input.fully
        ? CLIENT_DEPENDENCY_STATUS.received
        : CLIENT_DEPENDENCY_STATUS.partiallyReceived;
      const sets = [
        `status = $1`,
        `received_date = COALESCE($2, CURRENT_DATE)`,
        input.fully
          ? `outstanding_items = NULL`
          : `outstanding_items = COALESCE($3, outstanding_items)`,
      ];
      const params: unknown[] = input.fully
        ? [status, input.receivedDate ?? null]
        : [status, input.receivedDate ?? null, input.outstandingItems ?? null];

      await this.versionedUpdate(client, dependencyId, engagementId, sets, params, input.version);
      const after = await this.selectDependency(client, dependencyId, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'client_dependency.received',
        objectType: 'client_dependency',
        objectId: dependencyId,
        before: { status: before.status },
        after: { status },
      });
      return after!;
    });
  }

  /** Waive or cancel a dependency that is no longer needed (reason recorded). */
  async close(
    ctx: RlsContext,
    engagementId: string,
    dependencyId: string,
    input: CloseClientDependencyInput,
  ): Promise<ClientDependencyRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectDependency(client, dependencyId, engagementId);
      if (!before) throw new NotFoundException('Client dependency not found.');

      await this.versionedUpdate(
        client,
        dependencyId,
        engagementId,
        [`status = $1`],
        [input.status],
        input.version,
      );
      const after = await this.selectDependency(client, dependencyId, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'client_dependency.closed',
        objectType: 'client_dependency',
        objectId: dependencyId,
        before: { status: before.status },
        after: { status: input.status },
        reason: input.reason,
      });
      return after!;
    });
  }

  /** Open client dependencies across every engagement the caller can see. */
  async mine(
    ctx: RlsContext,
    page: PageParams,
    filter: { overdueOnly?: boolean },
  ): Promise<PageResult<ClientDependencyWithContext>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const conds = [`cd.status IN ('pending', 'partially_received')`];
      if (filter.overdueOnly) {
        conds.push(`cd.escalation_date IS NOT NULL AND cd.escalation_date < CURRENT_DATE`);
      }
      const where = `WHERE ${conds.join(' AND ')}`;
      const { rows } = await client.query<
        DependencyRow & { engagement_code: string; entity_name: string }
      >(
        `${DEP_BASE.replace(
          'FROM hsdg.client_dependencies cd',
          `, eng.engagement_code, ent.legal_name AS entity_name
           FROM hsdg.client_dependencies cd
           JOIN hsdg.engagements eng ON eng.id = cd.engagement_id
           JOIN hsdg.entities ent ON ent.id = eng.entity_id`,
        )} ${where}
         ORDER BY cd.escalation_date NULLS LAST, cd.request_date
         LIMIT $1 OFFSET $2`,
        [page.limit, page.offset],
      );
      const totalRes = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM hsdg.client_dependencies cd ${where}`,
      );
      return {
        items: rows.map((r) => ({
          ...mapDependency(r),
          engagementCode: r.engagement_code,
          entityName: r.entity_name,
        })),
        total: Number(totalRes.rows[0]?.total ?? 0),
      };
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async requireEngagement(client: PoolClient, engagementId: string): Promise<void> {
    const eng = await client.query(`SELECT 1 FROM hsdg.engagements WHERE id = $1`, [engagementId]);
    if (!eng.rows[0]) throw new NotFoundException('Engagement not found.');
  }

  private async versionedUpdate(
    client: PoolClient,
    dependencyId: string,
    engagementId: string,
    sets: string[],
    setParams: unknown[],
    expectedVersion: number | undefined,
  ): Promise<void> {
    const params = [...setParams, dependencyId, engagementId];
    const idParam = `$${params.length - 1}`;
    const engParam = `$${params.length}`;
    let versionClause = '';
    if (expectedVersion !== undefined) {
      params.push(expectedVersion);
      versionClause = ` AND version = $${params.length}`;
    }
    let updated: number;
    try {
      const result = await client.query(
        `UPDATE hsdg.client_dependencies SET ${[...sets, 'version = version + 1'].join(', ')}
         WHERE id = ${idParam} AND engagement_id = ${engParam}${versionClause}`,
        params,
      );
      updated = result.rowCount ?? 0;
    } catch (err) {
      throw mapTaskError(err);
    }
    if (updated === 0) {
      throw new ConflictException(
        'Client dependency was modified by someone else. Refresh and retry (stale version).',
      );
    }
  }

  private async selectDependency(
    client: PoolClient,
    dependencyId: string,
    engagementId: string,
  ): Promise<ClientDependencyRecord | null> {
    const { rows } = await client.query<DependencyRow>(
      `${DEP_BASE} WHERE cd.id = $1 AND cd.engagement_id = $2`,
      [dependencyId, engagementId],
    );
    return rows[0] ? mapDependency(rows[0]) : null;
  }
}

function mapDependency(row: DependencyRow): ClientDependencyRecord {
  return {
    id: row.id,
    engagementId: row.engagement_id,
    requestedInfo: row.requested_info,
    outstandingItems: row.outstanding_items,
    responsibleId: row.responsible_employee_id,
    responsibleName: row.responsible_name,
    createdById: row.created_by_employee_id,
    createdByName: row.created_by_name,
    requestDate: row.request_date,
    reminderDate: row.reminder_date,
    escalationDate: row.escalation_date,
    receivedDate: row.received_date,
    status: row.status,
    isOpen: row.is_open,
    isOverdue: row.is_overdue,
    reminderDue: row.reminder_due,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
