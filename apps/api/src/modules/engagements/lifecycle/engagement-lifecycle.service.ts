import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  LIFECYCLE_ACTION,
  NOTIFICATION_TYPE,
  type EngagementStatus,
  type LifecycleAction,
} from '@hsdg/contracts';
import { DatabaseService } from '../../../database/database.service';
import type { RlsContext } from '../../../database/rls-context';
import type { PageParams, PageResult } from '../../../common/pagination/pagination.dto';
import { resolveAmbientCorrelationId } from '../../../common/context/request-context';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { selectEngagementDetail } from '../engagement-detail.query';
import { translatePgError } from '../engagements.service';
import type { EngagementDetail, LifecycleHistoryRecord } from '../engagements.types';
import { LIFECYCLE_GUARDS } from './lifecycle-guards';
import type { LifecycleTransitionInput } from './lifecycle.types';

interface TransitionRow {
  action: string;
  from_status: EngagementStatus;
  to_status: EngagementStatus | null;
  is_active: boolean;
}

interface HistoryRow {
  id: string;
  action: string;
  from_status: EngagementStatus;
  to_status: EngagementStatus;
  actor_user_id: string | null;
  actor_role: string | null;
  reason: string | null;
  correlation_id: string | null;
  previous_version: number;
  resulting_version: number;
  created_at: Date;
}

/**
 * The engagement lifecycle (governance/commercial state, §3-§14). Every
 * transition runs the same ten-step sequence (§21) inside one transaction:
 * load → validate current state → validate the configured transition →
 * guards → version check → mutate → history → audit → commit. Any failure
 * rolls the whole thing back — there is never a mutation without its history
 * and audit entry, or vice versa.
 */
@Injectable()
export class EngagementLifecycleService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
    private readonly notifications: NotificationsService,
  ) {}

  async transition(
    ctx: RlsContext,
    id: string,
    action: LifecycleAction,
    input: LifecycleTransitionInput,
  ): Promise<EngagementDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await selectEngagementDetail(client, id);
      if (!before) throw new NotFoundException('Engagement not found.');

      const { rows } = await client.query<TransitionRow>(
        `SELECT action, from_status, to_status, is_active
         FROM hsdg.engagement_lifecycle_transitions
         WHERE action = $1 AND from_status = $2`,
        [action, before.status],
      );
      const transition = rows[0];
      if (!transition || !transition.is_active) {
        throw new BadRequestException(
          `Invalid transition: cannot "${action}" an engagement in status "${before.status}".`,
        );
      }

      // 'resume' has no fixed destination in config (§11-§14): it returns to
      // whatever operational status the engagement held before the hold.
      let toStatus: EngagementStatus;
      if (transition.to_status) {
        toStatus = transition.to_status;
      } else if (action === LIFECYCLE_ACTION.resume) {
        if (!before.onHoldPreviousStatus) {
          throw new BadRequestException('Cannot resume: no prior operational status recorded.');
        }
        toStatus = before.onHoldPreviousStatus;
      } else {
        throw new BadRequestException(`Transition "${action}" has no configured destination.`);
      }

      for (const guard of LIFECYCLE_GUARDS[action]) {
        await guard.check({ ctx, engagement: before, action, toStatus, input });
      }

      const sets: string[] = ['status = $1', 'version = version + 1'];
      const params: unknown[] = [toStatus];
      if (toStatus === 'accepted' && !before.acceptedAt) {
        sets.push('accepted_at = now()');
      }
      // §18: 'start' initialises the service-workflow instance from the
      // service's configured workflow family — the family determines the
      // initial state, never a hard-coded "audit starts at Planning".
      if (action === LIFECYCLE_ACTION.start) {
        const { rows: initial } = await client.query<{ id: string }>(
          `SELECT ws.id FROM hsdg.workflow_states ws
           JOIN hsdg.services s ON s.workflow_family_id = ws.workflow_family_id
           WHERE s.id = $1 AND ws.is_initial = true`,
          [before.serviceId],
        );
        if (!initial[0]) {
          throw new BadRequestException(
            `Service "${before.serviceCode}" has no configured workflow (no initial state) — cannot start the engagement.`,
          );
        }
        sets.push(`current_workflow_state_id = $${params.push(initial[0].id)}`);
        // §25: snapshot the workflow family's active effective-dated version, so
        // the engagement records the definition it started under even if the
        // family is later re-versioned. NULL when no version exists yet.
        sets.push(
          `workflow_version_id = (
             SELECT wv.id FROM hsdg.workflow_versions wv
             JOIN hsdg.services s ON s.workflow_family_id = wv.workflow_family_id
             WHERE s.id = $${params.push(before.serviceId)}
               AND wv.effective_from <= CURRENT_DATE
               AND (wv.effective_to IS NULL OR wv.effective_to >= CURRENT_DATE)
             ORDER BY wv.effective_from DESC
             LIMIT 1)`,
        );
      }
      if (action === LIFECYCLE_ACTION.putOnHold) {
        sets.push(`on_hold_reason = $${params.push(input.reason ?? null)}`);
        sets.push(`on_hold_previous_status = $${params.push(before.status)}`);
        sets.push('on_hold_at = now()');
        sets.push(
          `on_hold_expected_resume_date = $${params.push(input.expectedResumeDate ?? null)}`,
        );
      }
      if (action === LIFECYCLE_ACTION.resume) {
        sets.push('on_hold_reason = NULL');
        sets.push('on_hold_previous_status = NULL');
        sets.push('on_hold_at = NULL');
        sets.push('on_hold_expected_resume_date = NULL');
      }

      params.push(id);
      const idParam = `$${params.length}`;
      params.push(before.status);
      const statusParam = `$${params.length}`;
      let versionClause = '';
      if (input.version !== undefined) {
        params.push(input.version);
        versionClause = ` AND version = $${params.length}`;
      }

      // The WHERE also re-checks status (not only the optional version), so a
      // concurrent transition that already moved the engagement is always
      // caught — even for a caller who never supplied a version.
      let updated: number;
      try {
        const result = await client.query(
          `UPDATE hsdg.engagements SET ${sets.join(', ')}
           WHERE id = ${idParam} AND status = ${statusParam}${versionClause}`,
          params,
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

      // Phase 7: reopening invalidates the prior sign-off (ADR-0011 §6 follow-
      // up). The completed work is being reopened for change, so its
      // certification no longer holds — a fresh sign-off is required before the
      // engagement can complete again. Runs under the MP's (reopen is MP-only)
      // is_engagement_lead RLS floor, in the same transaction as the mutation.
      if (action === LIFECYCLE_ACTION.reopen) {
        await client.query(
          `UPDATE hsdg.engagement_reviews
           SET superseded_at = now(), superseded_reason = $2
           WHERE engagement_id = $1 AND review_type = 'sign_off' AND superseded_at IS NULL`,
          [id, `engagement reopened: ${input.reason ?? ''}`.slice(0, 500)],
        );
      }

      const after = await selectEngagementDetail(client, id);
      const correlationId = resolveAmbientCorrelationId(this.cls) ?? null;

      await client.query(
        `INSERT INTO hsdg.engagement_lifecycle_history
           (engagement_id, action, from_status, to_status, actor_user_id, actor_role,
            reason, correlation_id, previous_version, resulting_version)
         VALUES ($1,$2,$3,$4,NULLIF($5,'')::uuid,$6,$7,$8,$9,$10)`,
        [
          id,
          action,
          before.status,
          toStatus,
          ctx.userId,
          ctx.role,
          input.reason ?? null,
          correlationId,
          before.version,
          after!.version,
        ],
      );

      await this.audit.recordWith(client, ctx, {
        action: 'engagement.status_changed',
        objectType: 'engagement',
        objectId: id,
        before: { status: before.status, version: before.version },
        after: { status: after!.status, version: after!.version },
        reason: input.reason ?? null,
        correlationId,
      });

      // Reopening completed/signed-off work is a material event — tell its EP and
      // manager their engagement is active again (a fresh sign-off is required).
      if (action === LIFECYCLE_ACTION.reopen) {
        await this.notifications.emitWith(client, ctx, {
          type: NOTIFICATION_TYPE.engagementReopened,
          recipientEmployeeIds: [after!.engagementPartnerId, after!.engagementManagerId],
          title: `Engagement reopened — ${after!.engagementCode}`,
          body: `${after!.engagementCode} (${after!.entityName}) was reopened${
            input.reason ? `: ${input.reason}` : ''
          }. A fresh sign-off is required before it can complete again.`,
          engagementId: id,
          objectType: 'engagement',
          objectId: id,
        });
      }

      return after!;
    });
  }

  async listHistory(
    ctx: RlsContext,
    id: string,
    page: PageParams,
  ): Promise<PageResult<LifecycleHistoryRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const engagement = await selectEngagementDetail(client, id);
      if (!engagement) throw new NotFoundException('Engagement not found.');

      const { rows } = await client.query<HistoryRow & { total_count: string }>(
        `SELECT id, action, from_status, to_status, actor_user_id, actor_role,
                reason, correlation_id, previous_version, resulting_version, created_at,
                count(*) OVER() AS total_count
         FROM hsdg.engagement_lifecycle_history
         WHERE engagement_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [id, page.limit, page.offset],
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          action: r.action,
          fromStatus: r.from_status,
          toStatus: r.to_status,
          actorUserId: r.actor_user_id,
          actorRole: r.actor_role,
          reason: r.reason,
          correlationId: r.correlation_id,
          previousVersion: r.previous_version,
          resultingVersion: r.resulting_version,
          createdAt: r.created_at.toISOString(),
        })),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }
}
