import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  NOTIFICATION_TYPE,
  type AssignableTask,
  type AssignableTaskFilters,
  type CreateWorkSetInput,
  type SplitWorkSetInput,
  type SplitWorkSetResult,
  type WorkSetDetail,
  type WorkSetPerson,
  type WorkSetSide,
  type WorkSetSummary,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { recordAssignment, type AssignmentChange } from '../tasks/task-assignments';
import {
  MOVABLE_STATUSES,
  NOT_A_GIVER,
  defaultSetName,
  giveScope,
  setNotificationTitle,
  type GiveScope,
} from './work-sets';

const TASK_ROW_SQL = `
  SELECT t.id, t.title, t.status, t.due_date::text AS due_date,
         t.engagement_id, g.engagement_code, g.entity_id,
         COALESCE(en.display_name, en.legal_name) AS entity_name,
         g.office_id, o.code AS office_code,
         ci.id AS instance_id, COALESCE(v.stream, tsv.stream) AS stream,
         COALESCE(NULLIF(ci.form_label, ''), v.form_label) AS form_label, ci.period_key,
         t.assigned_to_employee_id, ae.full_name AS assigned_to_name,
         t.reviewer_employee_id, re.full_name AS reviewer_name,
         t.work_set_id, ws.name AS work_set_name
    FROM hsdg.tasks t
    JOIN hsdg.engagements g ON g.id = t.engagement_id
    JOIN hsdg.entities en ON en.id = g.entity_id
    LEFT JOIN hsdg.offices o ON o.id = g.office_id
    LEFT JOIN hsdg.compliance_instances ci ON ci.id = t.source_compliance_instance_id
    LEFT JOIN hsdg.compliance_rule_versions v ON v.id = ci.compliance_rule_version_id
    LEFT JOIN hsdg.engagement_services tes ON tes.id = t.engagement_service_id
    LEFT JOIN hsdg.services tsv ON tsv.id = tes.service_id
    LEFT JOIN hsdg.employees ae ON ae.id = t.assigned_to_employee_id
    LEFT JOIN hsdg.employees re ON re.id = t.reviewer_employee_id
    LEFT JOIN hsdg.work_sets ws ON ws.id = t.work_set_id`;

interface TaskRowSql {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  engagement_id: string;
  engagement_code: string;
  entity_id: string;
  entity_name: string;
  office_id: string | null;
  office_code: string | null;
  instance_id: string | null;
  stream: string | null;
  form_label: string | null;
  period_key: string | null;
  assigned_to_employee_id: string | null;
  assigned_to_name: string | null;
  reviewer_employee_id: string | null;
  reviewer_name: string | null;
  work_set_id: string | null;
  work_set_name: string | null;
}

const SET_SUMMARY_SQL = `
  SELECT ws.id, ws.name, ws.assigned_to_employee_id, COALESCE(ae.full_name, '') AS assigned_to_name,
         ws.created_by_employee_id, ce.full_name AS created_by_name,
         ws.due_date::text AS due_date, ws.note, ws.created_at, ws.closed_at,
         count(t.id)::int AS task_count,
         (count(t.id) FILTER (WHERE t.status NOT IN ('done', 'cancelled')))::int AS open_count,
         (count(t.id) FILTER (WHERE t.status = 'done'))::int AS done_count
    FROM hsdg.work_sets ws
    LEFT JOIN hsdg.employees ae ON ae.id = ws.assigned_to_employee_id
    LEFT JOIN hsdg.employees ce ON ce.id = ws.created_by_employee_id
    LEFT JOIN hsdg.tasks t ON t.work_set_id = ws.id`;

const SET_SUMMARY_GROUP = `GROUP BY ws.id, ae.full_name, ce.full_name`;

interface SetSummarySql {
  id: string;
  name: string;
  assigned_to_employee_id: string;
  assigned_to_name: string;
  created_by_employee_id: string | null;
  created_by_name: string | null;
  due_date: string | null;
  note: string | null;
  created_at: Date;
  closed_at: Date | null;
  task_count: number;
  open_count: number;
  done_count: number;
}

/**
 * Work sets (Phase 2, C-3 and C-4). A Manager or above gives a named set of
 * open tasks to someone below them; the giver becomes each task's reviewer and
 * the receiver hears once for the set. The receiver may split the set among
 * the people below them, becoming reviewer of what they hand on. Every change
 * of hands is kept in the task's assignment history.
 */
@Injectable()
export class WorkSetsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Who the caller may give work to; with `below`, only the people below them
   * (who a set may be split among, for anyone with people below).
   */
  async people(ctx: RlsContext, below = false): Promise<WorkSetPerson[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const scope = below ? 'tree' : await this.requireGiver(client, ctx);
      return this.receivers(client, ctx, scope);
    });
  }

  /** The Assign work screen's list: open tasks the caller could hand on. */
  async openTasks(ctx: RlsContext, f: AssignableTaskFilters): Promise<AssignableTask[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.requireGiver(client, ctx);
      const params: unknown[] = [];
      const conds = [
        `t.status NOT IN ('done', 'cancelled')`,
        `((SELECT hsdg.ctx_is_business_firmwide())
          OR hsdg.is_engagement_lead(t.engagement_id)
          OR t.assigned_to_employee_id = ANY ((SELECT hsdg.ctx_subtree())::uuid[]))`,
      ];
      const add = (sql: (p: string) => string, value: unknown): void => {
        params.push(value);
        conds.push(sql(`$${params.length}`));
      };
      if (f.stream) add((p) => `COALESCE(v.stream, tsv.stream) = ${p}`, f.stream);
      if (f.form) add((p) => `COALESCE(NULLIF(ci.form_label, ''), v.form_label) = ${p}`, f.form);
      if (f.period) add((p) => `ci.period_key = ${p}`, f.period);
      if (f.entityId) add((p) => `g.entity_id = ${p}::uuid`, f.entityId);
      if (f.officeId) add((p) => `g.office_id = ${p}::uuid`, f.officeId);
      if (f.ownerId === 'none') conds.push(`t.assigned_to_employee_id IS NULL`);
      else if (f.ownerId) add((p) => `t.assigned_to_employee_id = ${p}::uuid`, f.ownerId);
      if (f.dueWithinDays !== undefined) {
        add(
          (p) => `t.due_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date + ${p}::int`,
          f.dueWithinDays,
        );
      }
      const { rows } = await client.query<TaskRowSql>(
        `${TASK_ROW_SQL}
          WHERE ${conds.join(' AND ')}
          ORDER BY t.due_date NULLS LAST, en.legal_name, t.title
          LIMIT 1000`,
        params,
      );
      return rows.map(toTask);
    });
  }

  /** Give the tasks to one person as a named set (C-3). */
  async create(ctx: RlsContext, input: CreateWorkSetInput): Promise<WorkSetDetail> {
    const me = requireEmployee(ctx);
    const taskIds = [...new Set(input.taskIds)];
    if (taskIds.length === 0) throw new BadRequestException('Tick at least one task.');
    if (input.assignedToId === me)
      throw new BadRequestException('Pick someone else to give it to.');
    const setId = await this.db.withRlsContext(ctx, async (client) => {
      const scope = await this.requireGiver(client, ctx);
      const receiver = await this.requireReceiver(client, ctx, scope, input.assignedToId);
      const tasks = await this.lockMovable(client, taskIds);
      const name =
        input.name?.trim() ||
        defaultSetName(
          tasks.map((t) => ({ formLabel: t.form_label, periodKey: t.period_key })),
          receiver.fullName,
        );
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.work_sets (name, created_by_employee_id, assigned_to_employee_id, due_date, note)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [name, me, receiver.id, input.dueDate ?? null, input.note?.trim() || null],
      );
      const id = rows[0]!.id;
      await this.handOn(client, tasks, {
        to: receiver.id,
        reviewer: me,
        by: me,
        setId: id,
        dueDate: input.dueDate ?? null,
        reason: `Given in set "${name}"`,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'work_set.created',
        objectType: 'work_set',
        objectId: id,
        after: {
          name,
          assignedTo: receiver.id,
          tasks: tasks.length,
          dueDate: input.dueDate ?? null,
        },
      });
      await this.notifyReceiver(client, ctx, {
        to: receiver.id,
        setId: id,
        setName: name,
        count: tasks.length,
        dueDate: input.dueDate ?? null,
        engagementIds: tasks.map((t) => t.engagement_id),
      });
      return id;
    });
    return this.detail(ctx, setId);
  }

  async list(ctx: RlsContext, side: WorkSetSide): Promise<WorkSetSummary[]> {
    const me = requireEmployee(ctx);
    return this.db.withRlsContext(ctx, async (client) => {
      const column = side === 'assigned_by' ? 'created_by_employee_id' : 'assigned_to_employee_id';
      const { rows } = await client.query<SetSummarySql>(
        `${SET_SUMMARY_SQL}
          WHERE ws.${column} = $1
          ${SET_SUMMARY_GROUP}
          ORDER BY ws.closed_at IS NOT NULL, ws.created_at DESC
          LIMIT 200`,
        [me],
      );
      return rows.map(toSummary);
    });
  }

  async detail(ctx: RlsContext, id: string): Promise<WorkSetDetail> {
    const me = requireEmployee(ctx);
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<SetSummarySql>(
        `${SET_SUMMARY_SQL} WHERE ws.id = $1 ${SET_SUMMARY_GROUP}`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException('Work set not found.');
      const set = toSummary(rows[0]);
      const { rows: tasks } = await client.query<TaskRowSql>(
        `${TASK_ROW_SQL} WHERE t.work_set_id = $1 ORDER BY t.due_date NULLS LAST, en.legal_name, t.title`,
        [id],
      );
      const scope = giveScope(await this.mainRole(client, ctx));
      const below = await this.hasPeopleBelow(client);
      return {
        ...set,
        tasks: tasks.map(toTask),
        canSplit: below && (scope !== null || set.assignedToId === me),
      };
    });
  }

  /** Hand some of a set's tasks to one person below the caller (C-4). */
  async split(ctx: RlsContext, id: string, input: SplitWorkSetInput): Promise<SplitWorkSetResult> {
    const me = requireEmployee(ctx);
    const taskIds = [...new Set(input.taskIds)];
    if (taskIds.length === 0) throw new BadRequestException('Tick at least one task.');
    if (input.toEmployeeId === me)
      throw new BadRequestException('Pick someone else to give it to.');
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows: sets } = await client.query<{
        id: string;
        name: string;
        assigned_to_employee_id: string;
        created_by_employee_id: string | null;
      }>(
        `SELECT id, name, assigned_to_employee_id, created_by_employee_id
           FROM hsdg.work_sets WHERE id = $1`,
        [id],
      );
      const set = sets[0];
      if (!set) throw new NotFoundException('Work set not found.');
      const scope = giveScope(await this.mainRole(client, ctx));
      if (scope === null && set.assigned_to_employee_id !== me) {
        throw new ForbiddenException(
          'Only the person this set was given to, or a Manager or above, can split it.',
        );
      }
      // Splitting hands work down: the receiver is below the caller, even for a Partner.
      const receiver = await this.requireReceiver(client, ctx, 'tree', input.toEmployeeId);
      const tasks = await this.lockMovable(client, taskIds);
      if (tasks.some((t) => t.work_set_id !== id)) {
        throw new BadRequestException('Some of those tasks are not in this set.');
      }
      const { rows: holders } = await client.query<{ ok: boolean }>(
        `SELECT bool_and(t.assigned_to_employee_id = ANY ((SELECT hsdg.ctx_subtree())::uuid[])) AS ok
           FROM hsdg.tasks t WHERE t.id = ANY ($1::uuid[])`,
        [taskIds],
      );
      if (scope === null && !holders[0]?.ok) {
        throw new ForbiddenException(
          'You can split only the tasks you hold or gave to the people below you.',
        );
      }
      await this.handOn(client, tasks, {
        to: receiver.id,
        reviewer: me,
        by: me,
        setId: id,
        dueDate: null,
        reason: input.note?.trim() || `Split from set "${set.name}"`,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'work_set.split',
        objectType: 'work_set',
        objectId: id,
        after: { to: receiver.id, tasks: tasks.length },
      });
      await this.notifyReceiver(client, ctx, {
        to: receiver.id,
        setId: id,
        setName: set.name,
        count: tasks.length,
        dueDate: null,
        engagementIds: tasks.map((t) => t.engagement_id),
      });
      return { moved: tasks.length };
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async mainRole(client: PoolClient, ctx: RlsContext): Promise<string | null> {
    const { rows } = await client.query<{ role: string | null }>(
      `SELECT hsdg.main_role($1) AS role`,
      [ctx.userId],
    );
    return rows[0]?.role ?? null;
  }

  private async requireGiver(client: PoolClient, ctx: RlsContext): Promise<GiveScope> {
    const scope = giveScope(await this.mainRole(client, ctx));
    if (!scope) throw new ForbiddenException(NOT_A_GIVER);
    return scope;
  }

  private async hasPeopleBelow(client: PoolClient): Promise<boolean> {
    const { rows } = await client.query<{ n: number }>(
      `SELECT cardinality((SELECT hsdg.ctx_subtree())) AS n`,
    );
    return (rows[0]?.n ?? 0) > 1;
  }

  /** Active people the caller may give to: anyone, or those below them. */
  private async receivers(
    client: PoolClient,
    ctx: RlsContext,
    scope: GiveScope,
  ): Promise<WorkSetPerson[]> {
    const { rows } = await client.query<{
      id: string;
      full_name: string;
      grade_name: string | null;
    }>(
      `SELECT e.id, e.full_name, gr.name AS grade_name
         FROM hsdg.employees e
         LEFT JOIN hsdg.grades gr ON gr.id = e.grade_id
         LEFT JOIN hsdg.users u ON u.id = e.user_id
        WHERE e.employment_status <> 'exited' AND e.deleted_at IS NULL
          AND COALESCE(u.is_active, true)
          AND e.id IS DISTINCT FROM $1
          AND ($2 OR e.id = ANY ((SELECT hsdg.ctx_subtree())::uuid[]))
        ORDER BY gr.rank DESC NULLS LAST, e.full_name`,
      [ctx.employeeId ?? null, scope === 'anyone'],
    );
    return rows.map((r) => ({ id: r.id, fullName: r.full_name, gradeName: r.grade_name }));
  }

  private async requireReceiver(
    client: PoolClient,
    ctx: RlsContext,
    scope: GiveScope,
    id: string,
  ): Promise<WorkSetPerson> {
    const found = (await this.receivers(client, ctx, scope)).find((p) => p.id === id);
    if (!found) {
      throw new ForbiddenException(
        scope === 'tree'
          ? 'You can give work only to people who report to you, directly or through others.'
          : 'Pick someone who is with the firm.',
      );
    }
    return found;
  }

  /** The tasks, locked; every one must be visible, open and free to hand on. */
  private async lockMovable(client: PoolClient, taskIds: string[]): Promise<TaskRowSql[]> {
    await client.query(`SELECT 1 FROM hsdg.tasks WHERE id = ANY ($1::uuid[]) FOR UPDATE`, [
      taskIds,
    ]);
    const { rows } = await client.query<TaskRowSql>(
      `${TASK_ROW_SQL} WHERE t.id = ANY ($1::uuid[])`,
      [taskIds],
    );
    if (rows.length !== taskIds.length) throw new NotFoundException('Task not found.');
    const busy = rows.filter((t) => !(MOVABLE_STATUSES as readonly string[]).includes(t.status));
    if (busy.length > 0) {
      throw new BadRequestException(
        `${busy.length === 1 ? '1 task is' : `${busy.length} tasks are`} in progress, in review or finished: ` +
          'only tasks not started, paused or waiting on the client can be handed on.',
      );
    }
    return rows;
  }

  /**
   * Move the tasks to `to` with `reviewer` reviewing, record each change of
   * hands, and put `to` on the team of each engagement where the caller may.
   */
  private async handOn(
    client: PoolClient,
    tasks: TaskRowSql[],
    m: {
      to: string;
      reviewer: string;
      by: string;
      setId: string;
      dueDate: string | null;
      reason: string;
    },
  ): Promise<void> {
    const ids = tasks.map((t) => t.id);
    const { rows } = await client.query<{ id: string }>(
      `UPDATE hsdg.tasks
          SET assigned_to_employee_id = $2, reviewer_employee_id = $3,
              assigned_by_employee_id = $4, assigned_at = now(), work_set_id = $5,
              due_date = COALESCE($6::date, due_date), version = version + 1
        WHERE id = ANY ($1::uuid[])
       RETURNING id`,
      [ids, m.to, m.reviewer, m.by, m.setId, m.dueDate],
    );
    if (rows.length !== ids.length) {
      const n = ids.length - rows.length;
      throw new ForbiddenException(
        `You cannot hand on ${n === 1 ? '1 of these tasks' : `${n} of these tasks`}: ` +
          'it is held outside your team. Ask its engagement’s Partner or Manager.',
      );
    }
    const changes: AssignmentChange[] = tasks.flatMap((t) => [
      {
        taskId: t.id,
        kind: 'assignee',
        from: t.assigned_to_employee_id,
        to: m.to,
        by: m.by,
        reason: m.reason,
      },
      {
        taskId: t.id,
        kind: 'reviewer',
        from: t.reviewer_employee_id,
        to: m.reviewer,
        by: m.by,
        reason: m.reason,
      },
    ]);
    await recordAssignment(client, changes);
    await client.query(
      `INSERT INTO hsdg.engagement_team (engagement_id, employee_id, role_on_engagement)
       SELECT DISTINCT g.id, $2::uuid, 'member'
         FROM hsdg.engagements g
        WHERE g.id = ANY ($1::uuid[])
          AND g.engagement_partner_id IS DISTINCT FROM $2
          AND g.engagement_manager_id IS DISTINCT FROM $2
          AND (hsdg.is_engagement_lead(g.id)
               OR (NOT hsdg.firm_check('task_assign_team_only') AND hsdg.is_engagement_member(g.id)))
       ON CONFLICT (engagement_id, employee_id) DO NOTHING`,
      [[...new Set(tasks.map((t) => t.engagement_id))], m.to],
    );
  }

  private async notifyReceiver(
    client: PoolClient,
    ctx: RlsContext,
    n: {
      to: string;
      setId: string;
      setName: string;
      count: number;
      dueDate: string | null;
      engagementIds: string[];
    },
  ): Promise<void> {
    const { rows } = await client.query<{ full_name: string }>(
      `SELECT full_name FROM hsdg.employees WHERE id = $1`,
      [ctx.employeeId],
    );
    const engagements = [...new Set(n.engagementIds)];
    await this.notifications.emitWith(client, ctx, {
      type: NOTIFICATION_TYPE.workSetAssigned,
      recipientEmployeeIds: [n.to],
      title: setNotificationTitle({
        giverName: rows[0]?.full_name ?? 'Someone',
        count: n.count,
        setName: n.setName,
        dueDate: n.dueDate,
      }),
      engagementId: engagements.length === 1 ? engagements[0] : null,
      objectType: 'work_set',
      objectId: n.setId,
      link: null,
    });
  }
}

function requireEmployee(ctx: RlsContext): string {
  if (!ctx.employeeId) {
    throw new BadRequestException('Your login is not linked to an employee, so you hold no work.');
  }
  return ctx.employeeId;
}

function toTask(r: TaskRowSql): AssignableTask {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    dueDate: r.due_date,
    engagementId: r.engagement_id,
    engagementCode: r.engagement_code,
    entityId: r.entity_id,
    entityName: r.entity_name,
    officeId: r.office_id,
    officeCode: r.office_code,
    instanceId: r.instance_id,
    stream: r.stream,
    formLabel: r.form_label,
    periodKey: r.period_key,
    assignedToId: r.assigned_to_employee_id,
    assignedToName: r.assigned_to_name,
    reviewerId: r.reviewer_employee_id,
    reviewerName: r.reviewer_name,
    workSetId: r.work_set_id,
    workSetName: r.work_set_name,
    movable: (MOVABLE_STATUSES as readonly string[]).includes(r.status),
  };
}

function toSummary(r: SetSummarySql): WorkSetSummary {
  return {
    id: r.id,
    name: r.name,
    assignedToId: r.assigned_to_employee_id,
    assignedToName: r.assigned_to_name,
    assignedById: r.created_by_employee_id,
    assignedByName: r.created_by_name,
    dueDate: r.due_date,
    note: r.note,
    taskCount: r.task_count,
    openCount: r.open_count,
    doneCount: r.done_count,
    createdAt: r.created_at.toISOString(),
    closedAt: r.closed_at ? r.closed_at.toISOString() : null,
  };
}
