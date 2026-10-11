import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { PlanningCapability } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import {
  assertPlanningCapability,
  readPlanningLock,
  resolvePlanningActor,
} from './planning-governance';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAPABILITY_KEY = 'planning:capability';
const LOCK_EXEMPT_KEY = 'planning:lockExempt';

/**
 * §23 — the 03.1 capability a write needs (any one of them). Undecorated
 * writes need `assess` (Engagement Manager).
 */
export const PlanningCapabilityRequired = (...capabilities: PlanningCapability[]) =>
  SetMetadata(CAPABILITY_KEY, capabilities);

/** The write is allowed while 03.1 is frozen (EP review, reopen, a draft that persists nothing). */
export const PlanningLockExempt = () => SetMetadata(LOCK_EXEMPT_KEY, true);

/**
 * 03.1 governance on every 03.1 write (DHVAJ 03.1 §19, §23):
 *   • the acting user's role on the engagement must carry the route's
 *     capability (Article / Senior propose and record facts, the Manager
 *     assesses and completes, the EP reviews) — 403 otherwise;
 *   • once Planning is approved in 03.12, 03.1 is frozen until a controlled
 *     revision is opened — 409 otherwise.
 * Reads pass. The audit file is `:workflowInstanceId`, else every live file of
 * engagement `:id` (a per-item route). RLS remains the backstop.
 */
@Injectable()
export class PlanningGovernanceGuard implements CanActivate {
  constructor(
    private readonly db: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { principal?: Principal; params: Record<string, string> }>();
    if (req.method === 'GET' || req.method === 'HEAD' || !req.principal) return true;
    const engagementId = req.params.id;
    const workflowInstanceId = req.params.workflowInstanceId;
    if (!engagementId || !UUID.test(engagementId)) return true;
    if (workflowInstanceId && !UUID.test(workflowInstanceId)) return true;

    const targets = [context.getHandler(), context.getClass()];
    const capabilities = this.reflector.getAllAndOverride<PlanningCapability[] | undefined>(
      CAPABILITY_KEY,
      targets,
    ) ?? ['assess'];
    const lockExempt =
      this.reflector.getAllAndOverride<boolean | undefined>(LOCK_EXEMPT_KEY, targets) ?? false;

    await this.db.withRlsContext(rlsContextFromPrincipal(req.principal), async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM hsdg.service_workflow_instances
          WHERE engagement_id = $1 AND status <> 'cancelled'
            AND ($2::uuid IS NULL OR id = $2::uuid)`,
        [engagementId, workflowInstanceId ?? null],
      );
      // A file the caller cannot see is left to the service to reject (404).
      if (rows.length === 0) return;
      if (capabilities.length) {
        const actor = await resolvePlanningActor(client, engagementId);
        if (!capabilities.some((c) => actor.capabilities[c])) {
          assertPlanningCapability(actor, capabilities[0]!);
        }
      }
      if (lockExempt) return;
      for (const r of rows) {
        const lock = await readPlanningLock(client, r.id);
        if (lock.locked) throw new ConflictException(lock.lockReason);
      }
    });
    return true;
  }
}
