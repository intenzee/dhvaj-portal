import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  LIVE_EVENT,
  NOTIFICATION_TYPE,
  QUICK_TASK_ASSIGNEE_STATUSES,
  QUICK_TASK_ASSIGNER_STATUSES,
  QUICK_TASK_OPEN,
  QUICK_TASK_STATUS_LABEL,
  quickTaskEta,
  type CreateQuickTaskInput,
  type QuickTaskDetail,
  type QuickTaskInbox,
  type QuickTaskMessage,
  type QuickTaskPerson,
  type QuickTaskReplyInput,
  type QuickTaskStatus,
  type QuickTaskSummary,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LiveEventsService } from '../live/live-events.service';
import { PushService, type TaskPush } from '../live/push.service';
import { notLinkedToEmployee } from '../../common/errors/staff-link.messages';

interface TaskRow {
  id: string;
  number: string;
  title: string;
  details: string | null;
  urgent: boolean;
  status: QuickTaskStatus;
  entity_id: string | null;
  entity_label: string | null;
  engagement_id: string | null;
  engagement_label: string | null;
  assigned_by_employee_id: string;
  assigned_to_employee_id: string;
  eta_at: Date | null;
  due_at: Date | null;
  received_at: Date | null;
  started_at: Date | null;
  done_at: Date | null;
  cancelled_at: Date | null;
  last_activity_at: Date;
  created_at: Date;
  version: number;
  last_message: string | null;
  unread: number;
}

interface PersonRow {
  id: string;
  full_name: string;
  employee_code: string | null;
  office_code: string | null;
  role_slug: string | null;
  can_receive: boolean;
}

export type QuickTaskBox = 'inbox' | 'sent' | 'all';

const TASK_SQL = `
  SELECT q.id, q.number::text, q.title, q.details, q.urgent, q.status, q.entity_id, q.entity_label,
         q.engagement_id, q.engagement_label,
         q.assigned_by_employee_id, q.assigned_to_employee_id, q.eta_at, q.due_at, q.received_at,
         q.started_at, q.done_at, q.cancelled_at, q.last_activity_at, q.created_at, q.version,
         (SELECT COALESCE(m.body, '') FROM hsdg.quick_task_messages m
           WHERE m.quick_task_id = q.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
         ((SELECT count(*) FROM hsdg.quick_task_messages m
            WHERE m.quick_task_id = q.id AND m.read_at IS NULL
              AND m.author_employee_id IS DISTINCT FROM $1::uuid)
          + CASE WHEN q.status = 'sent' AND q.assigned_to_employee_id = $1::uuid
                  AND q.assigned_by_employee_id <> $1::uuid THEN 1 ELSE 0 END)::int AS unread
    FROM hsdg.quick_tasks q`;

/** "3:30 pm" / "Thu 4 Nov, 1:00 pm" in IST. */
export function istTime(d: Date, now: Date = new Date()): string {
  const day = (x: Date) =>
    x.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
  const time = d
    .toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })
    .toLowerCase();
  if (day(d) === day(now)) return time;
  const weekday = d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' });
  return `${weekday} ${day(d)}, ${time}`;
}

/** What a status reply says, as the other person reads it. */
export function replyLine(status: QuickTaskStatus | null, eta: Date | null): string {
  const label = status ? QUICK_TASK_STATUS_LABEL[status] : 'New time';
  if (status === 'sent') return 'Reopened';
  return eta ? `${label} — done by ${istTime(eta)}` : label;
}

/**
 * Quick tasks (New → New task): one person gives another an urgent job about
 * a client; the assignee answers Received / Doing (with when it will be done)
 * / Done, and both write in the thread. Row Level Security keeps a task to
 * the two people on it (and the Managing Partner / administrators).
 */
@Injectable()
export class QuickTasksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly live: LiveEventsService,
    private readonly push: PushService,
  ) {}

  private me(ctx: RlsContext, action: string): string {
    if (!ctx.employeeId) throw new BadRequestException(notLinkedToEmployee(action));
    return ctx.employeeId;
  }

  private async peopleMap(client: PoolClient): Promise<Map<string, PersonRow>> {
    const { rows } = await client.query<PersonRow>(
      `SELECT id, full_name, employee_code, office_code, role_slug, can_receive
         FROM hsdg.quick_task_people()`,
    );
    return new Map(rows.map((r) => [r.id, r]));
  }

  private person(people: Map<string, PersonRow>, id: string): QuickTaskPerson {
    const p = people.get(id);
    return {
      id,
      name: p?.full_name ?? 'Someone',
      code: p?.employee_code ?? null,
      officeCode: p?.office_code ?? null,
      role: p?.role_slug ?? null,
    };
  }

  private summary(
    r: TaskRow,
    me: string | undefined,
    people: Map<string, PersonRow>,
    now: Date,
  ): QuickTaskSummary {
    const target = r.eta_at ?? r.due_at;
    return {
      id: r.id,
      number: Number(r.number),
      title: r.title,
      urgent: r.urgent,
      status: r.status,
      entityId: r.entity_id,
      entityLabel: r.entity_label,
      engagementId: r.engagement_id,
      engagementLabel: r.engagement_label,
      assignedBy: this.person(people, r.assigned_by_employee_id),
      assignedTo: this.person(people, r.assigned_to_employee_id),
      side:
        r.assigned_to_employee_id === me
          ? 'received'
          : r.assigned_by_employee_id === me
            ? 'sent'
            : 'other',
      etaAt: r.eta_at?.toISOString() ?? null,
      dueAt: r.due_at?.toISOString() ?? null,
      late: QUICK_TASK_OPEN.includes(r.status) && !!target && target.getTime() < now.getTime(),
      lastActivityAt: r.last_activity_at.toISOString(),
      lastMessage: r.last_message || null,
      unread: r.unread,
      createdAt: r.created_at.toISOString(),
    };
  }

  /** Everyone a quick task can go to. */
  async people(ctx: RlsContext): Promise<QuickTaskPerson[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const people = await this.peopleMap(client);
      return [...people.values()]
        .filter((p) => p.can_receive)
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
        .map((p) => this.person(people, p.id));
    });
  }

  async create(ctx: RlsContext, input: CreateQuickTaskInput): Promise<QuickTaskDetail> {
    const me = this.me(ctx, 'give a quick task');
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('Write what is to be done.');
    let push: TaskPush | null = null;
    const id = await this.db.withRlsContext(ctx, async (client) => {
      const people = await this.peopleMap(client);
      const to = people.get(input.assignedToEmployeeId);
      if (!to?.can_receive)
        throw new BadRequestException(
          'Pick someone with a portal login who is still with the firm.',
        );
      let entityId = input.entityId ?? null;
      let entityLabel: string | null = null;
      let engagementLabel: string | null = null;
      if (input.engagementId) {
        // Only an engagement the assigner can open; its client unless they picked another.
        const { rows } = await client.query<{ entity_id: string; label: string }>(
          `SELECT g.entity_id, g.engagement_code || ' · ' || s.name AS label
             FROM hsdg.engagements g JOIN hsdg.services s ON s.id = g.service_id
            WHERE g.id = $1`,
          [input.engagementId],
        );
        if (!rows[0]) throw new NotFoundException('Engagement not found.');
        engagementLabel = rows[0].label;
        entityId ??= rows[0].entity_id;
      }
      if (entityId) {
        const { rows } = await client.query<{ label: string }>(
          `SELECT entity_code || ' · ' || legal_name AS label FROM hsdg.entities WHERE id = $1`,
          [entityId],
        );
        if (!rows[0]) throw new NotFoundException('Client not found.');
        entityLabel = rows[0].label;
      }
      const { rows } = await client.query<{ id: string; number: string }>(
        `INSERT INTO hsdg.quick_tasks
           (entity_id, entity_label, title, details, urgent, assigned_by_employee_id,
            assigned_to_employee_id, due_at, engagement_id, engagement_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, number::text`,
        [
          entityId,
          entityLabel,
          title,
          input.details?.trim() || null,
          input.urgent ?? true,
          me,
          input.assignedToEmployeeId,
          input.dueAt ?? null,
          input.engagementId ?? null,
          engagementLabel,
        ],
      );
      const task = rows[0]!;
      if (input.assignedToEmployeeId !== me) {
        const from = people.get(me)?.full_name ?? 'Someone';
        await this.notifications.emitWith(client, ctx, {
          type: NOTIFICATION_TYPE.quickTaskAssigned,
          recipientEmployeeIds: [input.assignedToEmployeeId],
          title: `${input.urgent === false ? 'Task' : 'Urgent task'} from ${from}: ${title}`,
          body: [entityLabel, input.details?.trim()].filter(Boolean).join(' — ') || null,
          objectType: 'quick_task',
          objectId: task.id,
          link: null,
        });
        // The pop-up on their screen, the moment this commits.
        await this.live.publishWith(client, [input.assignedToEmployeeId], {
          kind: LIVE_EVENT.quickTaskAssigned,
          taskId: task.id,
          urgent: input.urgent ?? true,
          fromName: people.get(me)?.full_name ?? null,
        });
        push = {
          kind: LIVE_EVENT.quickTaskAssigned,
          taskId: task.id,
          to: input.assignedToEmployeeId,
          urgent: input.urgent ?? true,
          fromName: people.get(me)?.full_name ?? null,
          taskTitle: title,
        };
      }
      await this.audit.recordWith(client, ctx, {
        action: 'quick_task.created',
        objectType: 'quick_task',
        objectId: task.id,
        after: { number: Number(task.number), title, to: input.assignedToEmployeeId },
      });
      return task.id;
    });
    // Their phone / closed browser, now that it has committed.
    if (push) this.push.taskEvent(ctx, push);
    return this.get(ctx, id);
  }

  async list(
    ctx: RlsContext,
    box: QuickTaskBox,
    state: 'open' | 'closed' | 'all',
    q?: string,
    engagementId?: string,
  ): Promise<QuickTaskSummary[]> {
    const me = ctx.employeeId ?? null;
    return this.db.withRlsContext(ctx, async (client) => {
      const conds: string[] = [];
      const params: unknown[] = [me];
      if (box === 'inbox') conds.push('q.assigned_to_employee_id = $1::uuid');
      if (box === 'sent') conds.push('q.assigned_by_employee_id = $1::uuid');
      if (state === 'open') conds.push(`q.status IN ('sent', 'received', 'doing')`);
      if (state === 'closed') conds.push(`q.status IN ('done', 'cancelled')`);
      if (engagementId) {
        params.push(engagementId);
        conds.push(`q.engagement_id = $${params.length}::uuid`);
      }
      if (q?.trim()) {
        params.push(`%${q.trim()}%`);
        conds.push(`(q.title ILIKE $${params.length} OR q.entity_label ILIKE $${params.length})`);
      }
      const { rows } = await client.query<TaskRow>(
        `${TASK_SQL}
          ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
          ORDER BY q.last_activity_at DESC
          LIMIT 200`,
        params,
      );
      const people = await this.peopleMap(client);
      const now = new Date();
      return rows.map((r) => this.summary(r, me ?? undefined, people, now));
    });
  }

  async inbox(ctx: RlsContext): Promise<QuickTaskInbox> {
    const me = ctx.employeeId;
    if (!me) return { unread: 0, open: 0, waiting: [] };
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<TaskRow>(
        `${TASK_SQL}
          WHERE $1::uuid IN (q.assigned_to_employee_id, q.assigned_by_employee_id)
            AND (q.status IN ('sent', 'received', 'doing')
                 OR q.last_activity_at > now() - interval '7 days')
          ORDER BY q.urgent DESC, q.created_at`,
        [me],
      );
      const people = await this.peopleMap(client);
      const now = new Date();
      const all = rows.map((r) => this.summary(r, me, people, now));
      return {
        unread: all.reduce((n, t) => n + t.unread, 0),
        open: all.filter((t) => t.side === 'received' && QUICK_TASK_OPEN.includes(t.status)).length,
        waiting: all.filter(
          (t) => t.side === 'received' && t.status === 'sent' && t.assignedBy.id !== me,
        ),
      };
    });
  }

  async get(ctx: RlsContext, id: string): Promise<QuickTaskDetail> {
    const me = ctx.employeeId;
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<TaskRow>(`${TASK_SQL} WHERE q.id = $2`, [me ?? null, id]);
      const r = rows[0];
      if (!r) throw new NotFoundException('Quick task not found.');
      const msgs = await client.query<{
        id: string;
        author_employee_id: string | null;
        body: string | null;
        status: QuickTaskStatus | null;
        eta_at: Date | null;
        created_at: Date;
        read_at: Date | null;
      }>(
        `SELECT id, author_employee_id, body, status, eta_at, created_at, read_at
           FROM hsdg.quick_task_messages WHERE quick_task_id = $1 ORDER BY created_at, id`,
        [id],
      );
      const people = await this.peopleMap(client);
      const base = this.summary(r, me, people, new Date());
      const messages: QuickTaskMessage[] = msgs.rows.map((m) => ({
        id: m.id,
        authorId: m.author_employee_id,
        authorName: m.author_employee_id ? this.person(people, m.author_employee_id).name : null,
        mine: !!me && m.author_employee_id === me,
        body: m.body,
        status: m.status,
        etaAt: m.eta_at?.toISOString() ?? null,
        createdAt: m.created_at.toISOString(),
        readAt: m.read_at?.toISOString() ?? null,
      }));
      return {
        ...base,
        details: r.details,
        receivedAt: r.received_at?.toISOString() ?? null,
        startedAt: r.started_at?.toISOString() ?? null,
        doneAt: r.done_at?.toISOString() ?? null,
        cancelledAt: r.cancelled_at?.toISOString() ?? null,
        messages,
        canSet: this.allowed(r, me),
        canWrite: !!me && [r.assigned_by_employee_id, r.assigned_to_employee_id].includes(me),
        version: r.version,
      };
    });
  }

  /** The statuses `me` may set on the task now. */
  private allowed(
    r: Pick<TaskRow, 'status' | 'assigned_by_employee_id' | 'assigned_to_employee_id'>,
    me: string | undefined,
  ): QuickTaskStatus[] {
    const out = new Set<QuickTaskStatus>();
    const open = QUICK_TASK_OPEN.includes(r.status);
    if (me && r.assigned_to_employee_id === me && open) {
      for (const s of QUICK_TASK_ASSIGNEE_STATUSES) {
        if (s === 'received' && r.status !== 'sent') continue;
        out.add(s);
      }
    }
    if (me && r.assigned_by_employee_id === me) {
      for (const s of QUICK_TASK_ASSIGNER_STATUSES) {
        if (s === 'sent' && open) continue;
        if ((s === 'cancelled' || s === 'done') && !open) continue;
        out.add(s);
      }
    }
    return [...out];
  }

  /** Mark the other person's messages (and a newly given task) as seen. */
  async markRead(ctx: RlsContext, id: string): Promise<{ read: number }> {
    const me = this.me(ctx, 'read a quick task');
    return this.db.withRlsContext(ctx, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE hsdg.quick_task_messages SET read_at = now()
          WHERE quick_task_id = $1 AND read_at IS NULL
            AND author_employee_id IS DISTINCT FROM $2::uuid`,
        [id, me],
      );
      return { read: rowCount ?? 0 };
    });
  }

  async reply(ctx: RlsContext, id: string, input: QuickTaskReplyInput): Promise<QuickTaskDetail> {
    const me = this.me(ctx, 'answer a quick task');
    const body = input.body?.trim() || null;
    if (!input.status && input.etaMinutes === undefined && !body)
      throw new BadRequestException('Write a message or pick an answer.');
    let push: TaskPush | null = null;
    await this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<TaskRow>(`${TASK_SQL} WHERE q.id = $2 FOR UPDATE OF q`, [
        me,
        id,
      ]);
      const r = rows[0];
      if (!r) throw new NotFoundException('Quick task not found.');
      const parties = [r.assigned_by_employee_id, r.assigned_to_employee_id];
      if (!parties.includes(me))
        throw new ForbiddenException('Only the two people on a quick task can answer it.');
      const isAssignee = r.assigned_to_employee_id === me;
      let status = input.status ?? null;
      let eta: Date | null = null;
      if (input.etaMinutes !== undefined) {
        if (!isAssignee)
          throw new ForbiddenException('Only the person doing the task says when it will be done.');
        if (input.etaMinutes < -2 || input.etaMinutes > 60 * 24 * 14)
          throw new BadRequestException('Pick a time within the next two weeks.');
        eta = quickTaskEta(input.etaMinutes);
        // "Done in 1 hr" from a task not yet started means they are on it.
        if (!status && (r.status === 'sent' || r.status === 'received')) status = 'doing';
      }
      if (status && status !== r.status && !this.allowed(r, me).includes(status)) {
        throw new ConflictException(
          `This task is ${QUICK_TASK_STATUS_LABEL[r.status].toLowerCase()}; it cannot be marked ${QUICK_TASK_STATUS_LABEL[status].toLowerCase()} now.`,
        );
      }
      if (status === r.status && !eta) status = null;
      if (!status && !eta && !body)
        throw new ConflictException(
          `This task is already ${QUICK_TASK_STATUS_LABEL[r.status].toLowerCase()}.`,
        );
      if (eta && !QUICK_TASK_OPEN.includes(status ?? r.status))
        throw new ConflictException('This task is closed; reopen it first.');

      const sets = ['last_activity_at = now()', 'updated_at = now()', 'version = version + 1'];
      const params: unknown[] = [id];
      const set = (sql: string, v?: unknown): void => {
        if (v === undefined) {
          sets.push(sql);
          return;
        }
        params.push(v);
        sets.push(sql.replace('?', `$${params.length}`));
      };
      if (status) {
        set('status = ?', status);
        if (status === 'received') set('received_at = COALESCE(received_at, now())');
        if (status === 'doing') {
          set('received_at = COALESCE(received_at, now())');
          set('started_at = COALESCE(started_at, now())');
        }
        if (status === 'done') set('done_at = now()');
        if (status === 'cancelled') set('cancelled_at = now()');
        if (status === 'sent') {
          set('done_at = NULL');
          set('cancelled_at = NULL');
          set('eta_at = NULL');
        }
      }
      if (eta) set('eta_at = ?', eta);
      await client.query(`UPDATE hsdg.quick_tasks SET ${sets.join(', ')} WHERE id = $1`, params);
      await client.query(
        `INSERT INTO hsdg.quick_task_messages (quick_task_id, author_employee_id, body, status, eta_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, me, body, status, eta],
      );
      // Answering means the other side's messages were read.
      await client.query(
        `UPDATE hsdg.quick_task_messages SET read_at = now()
          WHERE quick_task_id = $1 AND read_at IS NULL
            AND author_employee_id IS DISTINCT FROM $2::uuid`,
        [id, me],
      );
      const other = parties.find((p) => p !== me);
      if (other) {
        const people = await this.peopleMap(client);
        const who = people.get(me)?.full_name ?? 'Someone';
        const line = status || eta ? replyLine(status, eta) : null;
        await this.notifications.emitWith(client, ctx, {
          type: NOTIFICATION_TYPE.quickTaskReply,
          recipientEmployeeIds: [other],
          title: `${who}${line ? `: ${line}` : ''} · ${r.title}`,
          body,
          objectType: 'quick_task',
          objectId: id,
          link: null,
        });
        // The answer reaches the other person's screen at once (a live chat).
        await this.live.publishWith(client, [other], {
          kind: LIVE_EVENT.quickTaskReply,
          taskId: id,
          urgent: r.urgent && QUICK_TASK_OPEN.includes(status ?? r.status),
          fromName: who,
        });
        push = {
          kind: LIVE_EVENT.quickTaskReply,
          taskId: id,
          to: other,
          urgent: r.urgent && QUICK_TASK_OPEN.includes(status ?? r.status),
          fromName: who,
          taskTitle: r.title,
          line: [line, body].filter(Boolean).join(' — ') || null,
        };
      }
    });
    if (push) this.push.taskEvent(ctx, push);
    return this.get(ctx, id);
  }
}
