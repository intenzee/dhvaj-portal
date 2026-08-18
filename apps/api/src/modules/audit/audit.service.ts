import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
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
  constructor(private readonly db: DatabaseService) {}

  async record(ctx: RlsContext, input: AuditInput): Promise<void> {
    await this.db.withRlsContext(ctx, async (client) => {
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
          input.correlationId ?? null,
        ],
      );
    });
  }

  async list(ctx: RlsContext, limit = 50): Promise<AuditEventRecord[]> {
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
      }>(
        `SELECT id, occurred_at, actor_user_id, actor_role, action,
                object_type, object_id, reason, correlation_id
         FROM hsdg.audit_events
         ORDER BY occurred_at DESC
         LIMIT $1`,
        [limit],
      );
      return rows.map((r) => ({
        id: r.id,
        occurredAt: r.occurred_at.toISOString(),
        actorUserId: r.actor_user_id,
        actorRole: r.actor_role,
        action: r.action,
        objectType: r.object_type,
        objectId: r.object_id,
        reason: r.reason,
        correlationId: r.correlation_id,
      }));
    });
  }
}
