import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { TASK_STATUS, type TaskPriority, type TaskStatus } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { translatePgError as mapPgError } from '../../common/errors/pg-error.util';
import { AuditService } from '../audit/audit.service';
import type {
  CreateTaskInput,
  MyTaskRecord,
  TaskDetail,
  TaskDependencyRef,
  TaskRecord,
  UpdateTaskInput,
  UpdateTaskStatusInput,
} from './tasks.types';

interface TaskRow {
  id: string;
  engagement_id: string;
  title: string;
  description: string | null;
  assigned_to_employee_id: string | null;
  assigned_to_name: string | null;
  created_by_employee_id: string | null;
  created_by_name: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  is_overdue: boolean;
  blocked_by_open_count: number;
  completed_at: Date | null;
  completed_by_employee_id: string | null;
  completed_by_name: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const TASK_BASE = `
  SELECT t.id, t.engagement_id, t.title, t.description,
         t.assigned_to_employee_id, ae.full_name AS assigned_to_name,
         t.created_by_employee_id, ce.full_name AS created_by_name,
         t.status, t.priority, t.due_date::text,
         (t.status NOT IN ('done', 'cancelled') AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE)
           AS is_overdue,
         (SELECT count(*) FROM hsdg.task_dependencies d
            JOIN hsdg.tasks bt ON bt.id = d.depends_on_task_id
            WHERE d.task_id = t.id AND bt.status NOT IN ('done', 'cancelled'))::int
           AS blocked_by_open_count,
         t.completed_at, t.completed_by_employee_id, cbe.full_name AS completed_by_name,
         t.version, t.created_at, t.updated_at
  FROM hsdg.tasks t
  LEFT JOIN hsdg.employees ae ON ae.id = t.assigned_to_employee_id
  LEFT JOIN hsdg.employees ce ON ce.id = t.created_by_employee_id
  LEFT JOIN hsdg.employees cbe ON cbe.id = t.completed_by_employee_id`;

/**
 * Engagement tasks (Phase 9). Members read; leads create/assign/remove; the
 * assignee (who may be a senior/article) may progress their own task. A task
 * cannot be marked done while it still has an unfinished blocker, and a
 * dependency cannot be added if it would create a cycle.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async create(ctx: RlsContext, engagementId: string, input: CreateTaskInput): Promise<TaskRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.requireEngagement(client, engagementId);
      if (input.assignedToEmployeeId) {
        await this.requireMember(client, engagementId, input.assignedToEmployeeId);
      }
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.tasks
             (engagement_id, title, description, assigned_to_employee_id, created_by_employee_id,
              priority, due_date)
           VALUES ($1,$2,$3,$4,$5,COALESCE($6,'normal'),$7) RETURNING id`,
          [
            engagementId,
            input.title,
            input.description ?? null,
            input.assignedToEmployeeId ?? null,
            ctx.employeeId ?? null,
            input.priority ?? null,
            input.dueDate ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw mapTaskError(err);
      }
      const task = await this.selectTask(client, id, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'task.created',
        objectType: 'task',
        objectId: id,
        after: { engagementId, title: input.title, assignedTo: input.assignedToEmployeeId ?? null },
      });
      return task!;
    });
  }

  async list(
    ctx: RlsContext,
    engagementId: string,
    page: PageParams,
    filter: { status?: TaskStatus; assignedToEmployeeId?: string },
  ): Promise<PageResult<TaskRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.requireEngagement(client, engagementId);
      const params: unknown[] = [engagementId];
      const conds: string[] = ['t.engagement_id = $1'];
      if (filter.status) {
        params.push(filter.status);
        conds.push(`t.status = $${params.length}`);
      }
      if (filter.assignedToEmployeeId) {
        params.push(filter.assignedToEmployeeId);
        conds.push(`t.assigned_to_employee_id = $${params.length}`);
      }
      const where = `WHERE ${conds.join(' AND ')}`;
      params.push(page.limit, page.offset);
      const { rows } = await client.query<TaskRow>(
        `${TASK_BASE} ${where}
         ORDER BY t.due_date NULLS LAST, t.created_at
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const totalRes = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM hsdg.tasks t ${where}`,
        params.slice(0, params.length - 2),
      );
      return { items: rows.map(mapTask), total: Number(totalRes.rows[0]?.total ?? 0) };
    });
  }

  async getOne(ctx: RlsContext, engagementId: string, taskId: string): Promise<TaskDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const detail = await this.selectTaskDetail(client, taskId, engagementId);
      if (!detail) throw new NotFoundException('Task not found.');
      return detail;
    });
  }

  /** Full detail (task + its blockers) on the given client — same transaction. */
  private async selectTaskDetail(
    client: PoolClient,
    taskId: string,
    engagementId: string,
  ): Promise<TaskDetail | null> {
    const task = await this.selectTask(client, taskId, engagementId);
    if (!task) return null;
    const { rows } = await client.query<{
      id: string;
      depends_on_task_id: string;
      title: string;
      status: TaskStatus;
    }>(
      `SELECT d.id, d.depends_on_task_id, bt.title, bt.status
       FROM hsdg.task_dependencies d JOIN hsdg.tasks bt ON bt.id = d.depends_on_task_id
       WHERE d.task_id = $1 ORDER BY d.created_at`,
      [taskId],
    );
    const dependsOn: TaskDependencyRef[] = rows.map((r) => ({
      id: r.id,
      dependsOnTaskId: r.depends_on_task_id,
      dependsOnTitle: r.title,
      dependsOnStatus: r.status,
    }));
    return { ...task, dependsOn };
  }

  /** Update task fields (title/description/assignee/priority/due) — leads only via RLS. */
  async update(
    ctx: RlsContext,
    engagementId: string,
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<TaskRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectTask(client, taskId, engagementId);
      if (!before) throw new NotFoundException('Task not found.');
      if (input.assignedToEmployeeId) {
        await this.requireMember(client, engagementId, input.assignedToEmployeeId);
      }
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, val: unknown): void => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.title !== undefined) set('title', input.title);
      if (input.description !== undefined) set('description', input.description);
      if (input.assignedToEmployeeId !== undefined)
        set('assigned_to_employee_id', input.assignedToEmployeeId);
      if (input.priority !== undefined) set('priority', input.priority);
      if (input.dueDate !== undefined) set('due_date', input.dueDate);
      if (sets.length === 0) return before;

      await this.versionedUpdate(client, taskId, engagementId, sets, params, input.version, false);
      const after = await this.selectTask(client, taskId, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'task.updated',
        objectType: 'task',
        objectId: taskId,
        after: { engagementId },
      });
      return after!;
    });
  }

  /** Progress a task's status — the assignee (or a lead) via RLS. */
  async updateStatus(
    ctx: RlsContext,
    engagementId: string,
    taskId: string,
    input: UpdateTaskStatusInput,
  ): Promise<TaskRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectTask(client, taskId, engagementId);
      if (!before) throw new NotFoundException('Task not found.');
      if (input.status === TASK_STATUS.done && before.blockedByOpenCount > 0) {
        throw new BadRequestException(
          `Cannot complete: ${before.blockedByOpenCount} blocking task(s) are not done.`,
        );
      }

      const sets = [`status = $1`];
      const params: unknown[] = [input.status];
      if (input.status === TASK_STATUS.done) {
        sets.push('completed_at = now()');
        sets.push(`completed_by_employee_id = $${params.push(ctx.employeeId ?? null)}`);
      } else {
        // Leaving 'done' clears the completion stamp (the CHECK requires it only for 'done').
        sets.push('completed_at = NULL', 'completed_by_employee_id = NULL');
      }

      await this.versionedUpdate(client, taskId, engagementId, sets, params, input.version, true);
      const after = await this.selectTask(client, taskId, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'task.status_changed',
        objectType: 'task',
        objectId: taskId,
        before: { status: before.status },
        after: { status: input.status },
      });
      return after!;
    });
  }

  /** Add a blocker (this task depends on another). Leads only; rejects cycles. */
  async addDependency(
    ctx: RlsContext,
    engagementId: string,
    taskId: string,
    dependsOnTaskId: string,
  ): Promise<TaskDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const task = await this.selectTask(client, taskId, engagementId);
      if (!task) throw new NotFoundException('Task not found.');
      if (taskId === dependsOnTaskId) {
        throw new BadRequestException('A task cannot depend on itself.');
      }
      // Cycle check: would `taskId` already be reachable by following the
      // blocker's own dependency chain? If so, adding this edge closes a loop.
      const cycle = await client.query(
        `WITH RECURSIVE reach AS (
           SELECT depends_on_task_id AS t FROM hsdg.task_dependencies WHERE task_id = $1
           UNION
           SELECT d.depends_on_task_id FROM hsdg.task_dependencies d JOIN reach r ON d.task_id = r.t
         )
         SELECT 1 FROM reach WHERE t = $2 LIMIT 1`,
        [dependsOnTaskId, taskId],
      );
      if (cycle.rows[0]) {
        throw new BadRequestException('That dependency would create a cycle.');
      }
      try {
        await client.query(
          `INSERT INTO hsdg.task_dependencies (task_id, depends_on_task_id, engagement_id)
           VALUES ($1,$2,$3)`,
          [taskId, dependsOnTaskId, engagementId],
        );
      } catch (err) {
        throw mapTaskError(err);
      }
      await this.bumpVersion(client, taskId, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'task.dependency_added',
        objectType: 'task',
        objectId: taskId,
        after: { dependsOnTaskId },
      });
      return (await this.selectTaskDetail(client, taskId, engagementId))!;
    });
  }

  async removeDependency(
    ctx: RlsContext,
    engagementId: string,
    taskId: string,
    dependencyId: string,
  ): Promise<TaskDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const result = await client.query(
        `DELETE FROM hsdg.task_dependencies
         WHERE id = $1 AND task_id = $2 AND engagement_id = $3`,
        [dependencyId, taskId, engagementId],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new NotFoundException('Task dependency not found.');
      }
      await this.bumpVersion(client, taskId, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'task.dependency_removed',
        objectType: 'task',
        objectId: taskId,
        after: { dependencyId },
      });
      return (await this.selectTaskDetail(client, taskId, engagementId))!;
    });
  }

  /** Tasks assigned to the caller across every engagement they can see ("My Work"). */
  async myTasks(
    ctx: RlsContext,
    page: PageParams,
    filter: { status?: TaskStatus; overdueOnly?: boolean },
  ): Promise<PageResult<MyTaskRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      if (!ctx.employeeId) return { items: [], total: 0 };
      const params: unknown[] = [ctx.employeeId];
      const conds = ['t.assigned_to_employee_id = $1'];
      if (filter.status) {
        params.push(filter.status);
        conds.push(`t.status = $${params.length}`);
      }
      if (filter.overdueOnly) {
        conds.push(
          `t.status NOT IN ('done','cancelled') AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE`,
        );
      }
      const where = `WHERE ${conds.join(' AND ')}`;
      params.push(page.limit, page.offset);
      const { rows } = await client.query<
        TaskRow & { engagement_code: string; entity_name: string }
      >(
        `${TASK_BASE.replace(
          'FROM hsdg.tasks t',
          `, eng.engagement_code, ent.legal_name AS entity_name
           FROM hsdg.tasks t
           JOIN hsdg.engagements eng ON eng.id = t.engagement_id
           JOIN hsdg.entities ent ON ent.id = eng.entity_id`,
        )} ${where}
         ORDER BY t.due_date NULLS LAST, t.created_at
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const totalRes = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM hsdg.tasks t ${where}`,
        params.slice(0, params.length - 2),
      );
      return {
        items: rows.map((r) => ({
          ...mapTask(r),
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

  /** The assignee must be on the engagement (EP, manager, or team) so RLS lets them see it. */
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
        'A task can only be assigned to an employee on the engagement (EP, manager, or team).',
      );
    }
  }

  private async versionedUpdate(
    client: PoolClient,
    taskId: string,
    engagementId: string,
    sets: string[],
    setParams: unknown[],
    expectedVersion: number | undefined,
    assigneeMayWrite: boolean,
  ): Promise<void> {
    const params = [...setParams, taskId, engagementId];
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
        `UPDATE hsdg.tasks SET ${[...sets, 'version = version + 1'].join(', ')}
         WHERE id = ${idParam} AND engagement_id = ${engParam}${versionClause}`,
        params,
      );
      updated = result.rowCount ?? 0;
    } catch (err) {
      throw mapTaskError(err);
    }
    if (updated === 0) {
      // The row is visible (we loaded it), so 0 rows is a stale version or an
      // RLS write-denial (a non-assignee non-lead on a status update).
      const current = await this.selectTask(client, taskId, engagementId);
      if (current && expectedVersion !== undefined && current.version !== expectedVersion) {
        throw new ConflictException(
          'Task was modified by someone else. Refresh and retry (stale version).',
        );
      }
      throw new ForbiddenException(
        assigneeMayWrite
          ? 'Only the assignee or an engagement lead may update this task.'
          : 'Only an engagement lead may update this task.',
      );
    }
  }

  private async bumpVersion(
    client: PoolClient,
    taskId: string,
    engagementId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE hsdg.tasks SET version = version + 1 WHERE id = $1 AND engagement_id = $2`,
      [taskId, engagementId],
    );
  }

  private async selectTask(
    client: PoolClient,
    taskId: string,
    engagementId: string,
  ): Promise<TaskRecord | null> {
    const { rows } = await client.query<TaskRow>(
      `${TASK_BASE} WHERE t.id = $1 AND t.engagement_id = $2`,
      [taskId, engagementId],
    );
    return rows[0] ? mapTask(rows[0]) : null;
  }
}

function mapTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    engagementId: row.engagement_id,
    title: row.title,
    description: row.description,
    assignedToId: row.assigned_to_employee_id,
    assignedToName: row.assigned_to_name,
    createdById: row.created_by_employee_id,
    createdByName: row.created_by_name,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    isOverdue: row.is_overdue,
    blockedByOpenCount: Number(row.blocked_by_open_count),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    completedById: row.completed_by_employee_id,
    completedByName: row.completed_by_name,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Map PostgreSQL violations to clean HTTP errors (tasks domain). */
export function mapTaskError(err: unknown): Error {
  return mapPgError(err, {
    unique: [{ match: 'task_dependencies_unique', message: 'That dependency already exists.' }],
    uniqueDefault: 'A duplicate value violates a unique constraint.',
    foreignKey: 'A referenced record does not exist.',
    check: (message) =>
      message && message.length <= 200 ? message : 'A value violates a check constraint.',
    raise: (message) => (message && message.length <= 200 ? message : 'Invalid task operation.'),
    forbidden: 'Not permitted to write this task.',
  });
}
