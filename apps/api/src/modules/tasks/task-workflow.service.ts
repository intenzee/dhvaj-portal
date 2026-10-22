import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  FEATURE_FLAG,
  NOTIFICATION_TYPE,
  TASK_STATUS,
  TIME_STOP_REASON,
  type ClockState,
  type TaskAction,
  type TaskStatus,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { reviewerCandidates } from '../workflow-settings/default-reviewer';
import { workflowPolicy } from '../workflow-settings/workflow-policy';
import {
  clockState,
  closeRunningFor,
  closeTaskEntries,
  openAutoEntry,
  setEventContext,
  settleTasksAfterClose,
} from '../engagements/time/auto-time';
import { TasksService, mapTaskError } from './tasks.service';
import {
  actionForStatus,
  planTransition,
  TransitionError,
  type TransitionPlan,
} from './task-workflow';
import type { TaskRecord } from './tasks.types';
import { notLinkedToEmployee } from '../../common/errors/staff-link.messages';

export interface TransitionBody {
  reason?: string;
  escalationDate?: string;
  reviewerEmployeeId?: string;
  version?: number;
}

export interface TransitionResult {
  task: TaskRecord;
  clock: ClockState;
}

interface TaskCtxRow {
  status: TaskStatus;
  title: string;
  assigned_to_employee_id: string | null;
  reviewer_employee_id: string | null;
  engagement_service_id: string | null;
  source_compliance_instance_id: string | null;
  is_billable: boolean;
  version: number;
  blocked_by_open: number;
  is_lead: boolean;
  engagement_kind: string | null;
  engagement_status: string;
  engagement_partner_id: string | null;
  engagement_manager_id: string | null;
  stream_lead_id: string | null;
}

/**
 * Change 3 — task transitions that drive the clock. Each call runs in ONE
 * transaction: the task's status, the time entries it opens and closes, the
 * task_events row (trigger), any client dependency, the notification and the
 * audit record commit together or not at all.
 *
 * The filing a task produces follows the task by itself (SQL trigger
 * tasks_refresh_filing → derive_instance_workflow_status).
 *
 * Automatic time runs only when ff_auto_time is on AND the engagement is a
 * Compliance engagement; audit staff keep the manual timer until audit time is
 * automated. Status changes work either way.
 */
@Injectable()
export class TaskWorkflowService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly tasks: TasksService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /** POST /engagements/:id/tasks/:taskId/<action>. */
  async transition(
    ctx: RlsContext,
    engagementId: string,
    taskId: string,
    action: TaskAction,
    body: TransitionBody,
  ): Promise<TransitionResult> {
    return this.db.withRlsContext(ctx, (client) =>
      this.transitionWith(client, ctx, engagementId, taskId, action, body),
    );
  }

  /**
   * The legacy status endpoint (POST …/status) expressed as a transition, so the
   * dropdown and the new buttons drive the clock identically.
   */
  async setStatus(
    ctx: RlsContext,
    engagementId: string,
    taskId: string,
    status: TaskStatus,
    version: number | undefined,
  ): Promise<TaskRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadTask(client, taskId, engagementId);
      if (row.status === status)
        return (await this.tasks.selectTask(client, taskId, engagementId))!;
      const action = actionForStatus(row.status, status);
      if (action) {
        const res = await this.transitionWith(client, ctx, engagementId, taskId, action, {
          ...(version !== undefined ? { version } : {}),
          // The dropdown carries no text; a return still records why.
          reason: action === 'return' ? 'Returned for changes' : undefined,
        });
        return res.task;
      }
      // A plain change (→ blocked without a client request, paused → todo …).
      if (!row.is_lead && row.assigned_to_employee_id !== ctx.employeeId) {
        throw new ForbiddenException(
          'Only the assignee or an engagement lead may update this task.',
        );
      }
      if (row.status === TASK_STATUS.inProgress) {
        await closeTaskEntries(client, taskId, ['work'], TIME_STOP_REASON.paused);
      }
      await this.updateTask(client, taskId, engagementId, version, [`status = $1`], [status], null);
      return (await this.tasks.selectTask(client, taskId, engagementId))!;
    });
  }

  /** Apply a transition on an existing transaction (also used by the lodge). */
  async transitionWith(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    taskId: string,
    action: TaskAction,
    body: TransitionBody,
  ): Promise<TransitionResult> {
    const row = await this.loadTask(client, taskId, engagementId);
    const me = ctx.employeeId ?? null;
    let plan: TransitionPlan;
    try {
      plan = planTransition({
        action,
        status: row.status,
        actor: {
          isAssignee: !!me && row.assigned_to_employee_id === me,
          isReviewer: !!me && row.reviewer_employee_id === me,
          isLead: row.is_lead,
        },
        hasAssignee: !!row.assigned_to_employee_id,
        hasReviewer: !!row.reviewer_employee_id,
        blockedByOpenCount: row.blocked_by_open,
        hasReason: !!body.reason?.trim(),
      });
    } catch (err) {
      throw toHttp(err);
    }
    if (plan.open && !me) {
      throw new BadRequestException(notLinkedToEmployee('record time on this task'));
    }

    // Reviewer: default on Send for review; a lead taking over a review.
    let reviewerId = row.reviewer_employee_id;
    if (plan.defaultReviewer || body.reviewerEmployeeId) {
      // Questions for the partners, 2: the firm chooses who reviews by default.
      reviewerId =
        body.reviewerEmployeeId ??
        reviewerCandidates(
          (await workflowPolicy(client)).defaultReviewer,
          {
            streamLead: row.stream_lead_id,
            manager: row.engagement_manager_id,
            partner: row.engagement_partner_id,
          },
          row.assigned_to_employee_id,
        );
      if (!reviewerId) {
        throw new BadRequestException('Choose a reviewer before sending this task for review.');
      }
      if (reviewerId === row.assigned_to_employee_id) {
        throw new BadRequestException('The reviewer cannot be the person who did the work.');
      }
      await this.requireMember(client, engagementId, reviewerId);
    }
    if (plan.takeReview) reviewerId = me;

    const autoTime = this.autoTimeOn(row);
    const reason = plan.close?.reason ?? null;

    // 1. Opening a clock: close whatever the caller has running first; a task they
    //    were working on pauses (task_switched). Re-starting the same running
    //    work is a no-op on the clock.
    let alreadyRunning = false;
    if (plan.open && autoTime && me) {
      const state = await clockState(client, me);
      alreadyRunning = state.running?.taskId === taskId && state.running.entryKind === plan.open;
      if (!alreadyRunning && state.running) {
        const closed = await closeRunningFor(client, me, TIME_STOP_REASON.taskSwitched);
        await settleTasksAfterClose(
          client,
          closed.filter((c) => c.taskId !== taskId),
          TIME_STOP_REASON.taskSwitched,
          false,
        );
      }
    }

    // 2. Close this task's entries the transition ends.
    if (plan.close) {
      await closeTaskEntries(client, taskId, plan.close.kinds, plan.close.reason);
    }

    // 3. The task itself (task_events written by the trigger, with the reason).
    const sets: string[] = [`status = $1`];
    const params: unknown[] = [plan.toStatus];
    const add = (sql: string, val?: unknown): void => {
      if (val === undefined) {
        sets.push(sql);
      } else {
        params.push(val);
        sets.push(sql.replace('?', `$${params.length}`));
      }
    };
    if (reviewerId !== row.reviewer_employee_id) add('reviewer_employee_id = ?', reviewerId);
    if (plan.review === 'sent') {
      add('sent_for_review_at = now()');
      add('review_started_at = NULL');
    }
    if (plan.review === 'started') add('review_started_at = now()');
    if (plan.review === 'cleared') add('review_started_at = NULL');
    if (plan.completion === 'set') {
      add('completed_at = now()');
      add('completed_by_employee_id = ?', me);
    }
    if (plan.completion === 'clear') {
      add('completed_at = NULL');
      add('completed_by_employee_id = NULL');
    }
    const eventReason = body.reason?.trim() || reason || null;
    await this.updateTask(client, taskId, engagementId, body.version, sets, params, eventReason);

    // 4. Open the caller's clock.
    if (plan.open && autoTime && me && !alreadyRunning) {
      await openAutoEntry(client, {
        engagementId,
        employeeId: me,
        taskId,
        engagementServiceId: row.engagement_service_id,
        kind: plan.open,
        isBillable: true,
      });
    }

    // 5. Waiting on client raises a client dependency that follows the work.
    if (plan.raiseDependency) {
      await client.query(
        `INSERT INTO hsdg.client_dependencies
           (engagement_id, requested_info, responsible_employee_id, created_by_employee_id,
            escalation_date, engagement_service_id, compliance_instance_id, task_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          engagementId,
          body.reason!.trim(),
          row.assigned_to_employee_id,
          me,
          body.escalationDate ?? null,
          row.engagement_service_id,
          row.source_compliance_instance_id,
          taskId,
        ],
      );
    }

    // 6. Notify.
    if (plan.notify === 'reviewer' && reviewerId && reviewerId !== me) {
      await this.notifications.emitWith(client, ctx, {
        type: NOTIFICATION_TYPE.taskReviewRequested,
        recipientEmployeeIds: [reviewerId],
        title: `Review requested: ${row.title}`,
        engagementId,
        objectType: 'task',
        objectId: taskId,
      });
    }
    if (
      plan.notify === 'assignee' &&
      row.assigned_to_employee_id &&
      row.assigned_to_employee_id !== me
    ) {
      await this.notifications.emitWith(client, ctx, {
        type: NOTIFICATION_TYPE.taskReturned,
        recipientEmployeeIds: [row.assigned_to_employee_id],
        title: `Returned with review points: ${row.title}`,
        body: body.reason?.trim() ?? null,
        engagementId,
        objectType: 'task',
        objectId: taskId,
      });
    }

    await this.audit.recordWith(client, ctx, {
      action: `task.${action.replace(/-/g, '_')}`,
      objectType: 'task',
      objectId: taskId,
      before: { status: row.status },
      after: { status: plan.toStatus, reason: eventReason },
    });

    const task = (await this.tasks.selectTask(client, taskId, engagementId))!;
    const clock = me ? await clockState(client, me) : { running: null, resumable: null };
    return { task, clock };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private autoTimeOn(row: TaskCtxRow): boolean {
    return this.flags.isOn(FEATURE_FLAG.autoTime) && row.engagement_kind === 'compliance';
  }

  private async loadTask(
    client: PoolClient,
    taskId: string,
    engagementId: string,
  ): Promise<TaskCtxRow> {
    const { rows } = await client.query<TaskCtxRow>(
      `SELECT t.status, t.title, t.assigned_to_employee_id, t.reviewer_employee_id,
              t.engagement_service_id, t.source_compliance_instance_id, t.is_billable, t.version,
              (SELECT count(*) FROM hsdg.task_dependencies d
                 JOIN hsdg.tasks bt ON bt.id = d.depends_on_task_id
                WHERE d.task_id = t.id AND bt.status NOT IN ('done','cancelled'))::int AS blocked_by_open,
              hsdg.is_engagement_lead(t.engagement_id) AS is_lead,
              e.kind AS engagement_kind, e.status AS engagement_status,
              e.engagement_partner_id, e.engagement_manager_id,
              (SELECT es.lead_employee_id FROM hsdg.engagement_services es
                WHERE es.id = t.engagement_service_id) AS stream_lead_id
         FROM hsdg.tasks t
         JOIN hsdg.engagements e ON e.id = t.engagement_id
        WHERE t.id = $1 AND t.engagement_id = $2`,
      [taskId, engagementId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Task not found.');
    if (
      ['completed', 'closed', 'cancelled', 'declined', 'withdrawn'].includes(row.engagement_status)
    ) {
      throw new ConflictException('This engagement is closed; its tasks can no longer change.');
    }
    return row;
  }

  private async requireMember(
    client: PoolClient,
    engagementId: string,
    employeeId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.engagements e
        WHERE e.id = $1 AND (e.engagement_partner_id = $2 OR e.engagement_manager_id = $2)
       UNION
       SELECT 1 FROM hsdg.engagement_team t WHERE t.engagement_id = $1 AND t.employee_id = $2`,
      [engagementId, employeeId],
    );
    if (!rows[0]) {
      throw new BadRequestException(
        'The reviewer must be on the engagement (EP, manager or team).',
      );
    }
  }

  private async updateTask(
    client: PoolClient,
    taskId: string,
    engagementId: string,
    expectedVersion: number | undefined,
    sets: string[],
    setParams: unknown[],
    eventReason: string | null,
  ): Promise<void> {
    const params = [...setParams, taskId, engagementId];
    let versionClause = '';
    if (expectedVersion !== undefined) {
      params.push(expectedVersion);
      versionClause = ` AND version = $${params.length}`;
    }
    await setEventContext(client, eventReason, false);
    let updated: number;
    try {
      const res = await client.query(
        `UPDATE hsdg.tasks SET ${[...sets, 'version = version + 1'].join(', ')}
          WHERE id = $${setParams.length + 1} AND engagement_id = $${setParams.length + 2}${versionClause}`,
        params,
      );
      updated = res.rowCount ?? 0;
    } catch (err) {
      throw mapTaskError(err);
    } finally {
      await setEventContext(client, null, false);
    }
    if (updated === 0) {
      if (expectedVersion !== undefined) {
        const { rows } = await client.query<{ version: number }>(
          `SELECT version FROM hsdg.tasks WHERE id = $1`,
          [taskId],
        );
        if (rows[0] && rows[0].version !== expectedVersion) {
          throw new ConflictException('Task was modified by someone else. Refresh and retry.');
        }
      }
      throw new ForbiddenException(
        'Only the assignee, the reviewer or an engagement lead may move this task.',
      );
    }
  }
}

function toHttp(err: unknown): Error {
  if (!(err instanceof TransitionError)) return err as Error;
  if (err.code === 'forbidden') return new ForbiddenException(err.message);
  if (err.code === 'invalid_state') return new ConflictException(err.message);
  return new BadRequestException(err.message);
}
