import { CanActivate, ConflictException, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { DatabaseService } from '../../database/database.service';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { readFrameworkApprovalStateOn } from './framework-approval-read';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 02.8 §14 — Section 03 (Planning) stays locked until the Engagement Partner
 * approves the Audit Framework (AF-02), and while an "Approve Subject to
 * Conditions" condition that does not let Planning commence is still open.
 *
 * Applied with `@UseGuards` to the 03.1–03.5 controllers; it lets every read
 * through and rejects writes with 409 + the reason. The audit file is the
 * route's `:workflowInstanceId`, else every live file of engagement `:id` (a
 * per-item route). Runs after the global auth guards, under the caller's RLS
 * context — a file the caller cannot see is left to the service to reject.
 */
@Injectable()
export class Section03LockGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { principal?: Principal; params: Record<string, string> }>();
    if (req.method === 'GET' || req.method === 'HEAD' || !req.principal) return true;
    const engagementId = req.params.id;
    const workflowInstanceId = req.params.workflowInstanceId;
    if (!engagementId || !UUID.test(engagementId)) return true;
    if (workflowInstanceId && !UUID.test(workflowInstanceId)) return true;

    const reason = await this.db.withRlsContext(
      rlsContextFromPrincipal(req.principal),
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM hsdg.service_workflow_instances
            WHERE engagement_id = $1 AND status <> 'cancelled'
              AND ($2::uuid IS NULL OR id = $2::uuid)`,
          [engagementId, workflowInstanceId ?? null],
        );
        if (rows.length === 0) return null;
        const states = await readFrameworkApprovalStateOn(
          client,
          rows.map((r) => r.id),
        );
        for (const r of rows) {
          const gate = states.get(r.id)?.planning;
          if (!gate?.unlocked)
            return (
              gate?.reason ??
              'Section 03 opens once the Engagement Partner approves the Audit Framework (02.8).'
            );
        }
        return null;
      },
    );
    if (reason) throw new ConflictException(reason);
    return true;
  }
}
