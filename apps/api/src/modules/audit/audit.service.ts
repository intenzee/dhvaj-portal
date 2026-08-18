import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { CLS_CORRELATION_ID } from '../../common/context/request-context';
import type { AuditEventRecord } from '../identity/identity.types';

export interface AuditInput {
  action: string;
  objectType: string;
  objectId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  correlationId?: string | null;
}

/**
 * Writes and reads the immutable audit trail.
 *
 * Writes run inside the actor's security context so the append-only RLS policy
 * applies and the actor is recorded. The table has no UPDATE/DELETE grant or
 * policy, so records cannot be altered after the fact — this service offers no
 * update or delete method by design.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cls: ClsService,
  ) {}

  /** Record an event in its own transaction. */
  async record(ctx: RlsContext, input: AuditInput): Promise<void> {
    await this.db.withRlsContext(ctx, (client) => this.recordWith(client, ctx, input));
  }

  /**
   * Record an event using an existing transaction client, so a mutation and its
   * audit entry commit (or roll back) atomically. Callers pass the same client
   * they used for the change.
   */
  async recordWith(client: PoolClient, ctx: RlsContext, input: AuditInput): Promise<void> {
    // Default the correlation id from the ambient request context, so every
    // audited event is tied to the request that caused it without callers
    // having to thread it through. Guard for calls made outside a request.
    const ambient = this.cls.isActive() ? this.cls.get<string>(CLS_CORRELATION_ID) : undefined;
    const correlationId = input.correlationId ?? ambient ?? null;

    await client.query(
      `INSERT INTO hsdg.audit_events
         (actor_user_id, actor_role, action, object_type, object_id,
          before_state, after_state, reason, correlation_id)
       VALUES (NULLIF($1, '')::uuid, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
      [
        ctx.userId,
        ctx.role,
        input.action,
        input.objectType,
        input.objectId ?? null,
        input.before === undefined ? null : JSON.stringify(input.before),
        input.after === undefined ? null : JSON.stringify(input.after),
        input.reason ?? null,
        correlationId,
      ],
    );
  }

  async list(ctx: RlsContext, page: PageParams): Promise<PageResult<AuditEventRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        occurred_at: Date;
        actor_user_id: string | null;
        actor_role: string | null;
        action: string;
        object_type: string;
        object_id: string | null;
        reason: string | null;
        correlation_id: string | null;
        total_count: string;
      }>(
        `SELECT id, occurred_at, actor_user_id, actor_role, action,
                object_type, object_id, reason, correlation_id,
                count(*) OVER() AS total_count
         FROM hsdg.audit_events
         ORDER BY occurred_at DESC
         LIMIT $1 OFFSET $2`,
        [page.limit, page.offset],
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          occurredAt: r.occurred_at.toISOString(),
          actorUserId: r.actor_user_id,
          actorRole: r.actor_role,
          action: r.action,
          objectType: r.object_type,
          objectId: r.object_id,
          reason: r.reason,
          correlationId: r.correlation_id,
        })),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }
}
