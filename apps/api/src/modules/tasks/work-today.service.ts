import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  TODAY_DUE_WITHIN_DAYS,
  TODAY_GROUP,
  isPastDate,
  type EngagementKind,
  type TaskStatus,
  type TodayItem,
  type TodayTask,
  type TodayView,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import {
  WORK_LINK_COLUMNS,
  type WorkLinkSqlRow,
  workFilingContextOf,
  workLinkFilingOf,
  workLinkJoin,
  workLinkOf,
} from '../../common/work-links';
import { CLOSED_ENGAGEMENT_STATUSES } from '../compliance/compliance-calendar-v2.service';
import { WorkReviewsService } from './work-reviews.service';
import { buildTodayView, reviewToToday } from './work-today';

interface EngagementCols {
  engagement_id: string;
  engagement_code: string;
  engagement_kind: EngagementKind;
  entity_name: string;
}

/** The task columns a Today row carries (prefixed `tk_`; null on a filing with no task). */
interface TaskCols {
  tk_id: string | null;
  tk_title: string | null;
  tk_status: TaskStatus | null;
  tk_version: number | null;
  tk_due_date: string | null;
  tk_assigned_to_id: string | null;
  tk_assigned_to_name: string | null;
  tk_reviewer_id: string | null;
  tk_reviewer_name: string | null;
  tk_sent_for_review_at: Date | null;
  tk_review_started_at: Date | null;
  tk_blocked_by_open_count: number | null;
}

const TASK_COLS = (t: string): string => `
  ${t}.id AS tk_id, ${t}.title AS tk_title, ${t}.status AS tk_status, ${t}.version AS tk_version,
  ${t}.due_date::text AS tk_due_date,
  ${t}.assigned_to_employee_id AS tk_assigned_to_id, tae.full_name AS tk_assigned_to_name,
  ${t}.reviewer_employee_id AS tk_reviewer_id, tre.full_name AS tk_reviewer_name,
  ${t}.sent_for_review_at AS tk_sent_for_review_at, ${t}.review_started_at AS tk_review_started_at,
  (SELECT count(*) FROM hsdg.task_dependencies d
     JOIN hsdg.tasks bt ON bt.id = d.depends_on_task_id
    WHERE d.task_id = ${t}.id AND bt.status NOT IN ('done', 'cancelled'))::int
    AS tk_blocked_by_open_count`;

const TASK_PEOPLE = (t: string): string => `
  LEFT JOIN hsdg.employees tae ON tae.id = ${t}.assigned_to_employee_id
  LEFT JOIN hsdg.employees tre ON tre.id = ${t}.reviewer_employee_id`;

const ENGAGEMENT_JOIN = (engagementIdExpr: string): string => `
  JOIN hsdg.engagements eng ON eng.id = ${engagementIdExpr}
  JOIN hsdg.entities ent ON ent.id = eng.entity_id`;

const ENGAGEMENT_COLS = `eng.id AS engagement_id, eng.engagement_code,
  eng.kind AS engagement_kind, ent.legal_name AS entity_name`;

type TaskRow = EngagementCols & WorkLinkSqlRow & TaskCols;

interface RequestRow extends EngagementCols, WorkLinkSqlRow {
  id: string;
  requested_info: string;
  status: string;
  escalation_date: string | null;
  period_section: TodayItem['link']['section'] | null;
}

interface FilingRow extends EngagementCols, WorkLinkSqlRow, TaskCols {
  workflow_status: string;
}

/**
 * Staff Workflow WF-201 — GET /work/today: the caller's day in four groups,
 * read in one RLS transaction. `engagementId` narrows it to one engagement
 * (the "Next up for you" strip, WF-204).
 */
@Injectable()
export class WorkTodayService {
  constructor(
    private readonly db: DatabaseService,
    private readonly reviews: WorkReviewsService,
  ) {}

  async today(ctx: RlsContext, engagementId?: string): Promise<TodayView> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ today: string }>(
        `SELECT to_char(timezone('Asia/Kolkata', now()), 'YYYY-MM-DD') AS today`,
      );
      const today = rows[0]!.today;
      const me = ctx.employeeId;
      if (!me) return buildTodayView(today, emptyGroups());
      const eng = engagementId ?? null;
      const tasks = await this.myOpenTasks(client, me, eng, today);
      const view = buildTodayView(
        today,
        {
          [TODAY_GROUP.prepare]: tasks.filter((t) => t.group === TODAY_GROUP.prepare),
          [TODAY_GROUP.review]: (await this.reviews.itemsWith(client, me)).map((r) =>
            reviewToToday(r, today, me),
          ),
          [TODAY_GROUP.waiting]: [
            ...tasks.filter((t) => t.group === TODAY_GROUP.waiting),
            ...(await this.myRequests(client, me, eng, today)),
          ],
          [TODAY_GROUP.dueSoon]: await this.filingsDueSoon(client, me, eng, today),
        },
        engagementId,
      );
      return view;
    });
  }

  /** My tasks to prepare (todo / in_progress / paused) and the ones waiting on the client (blocked). */
  private async myOpenTasks(
    client: PoolClient,
    me: string,
    engagementId: string | null,
    today: string,
  ): Promise<TodayItem[]> {
    const { rows } = await client.query<TaskRow>(
      `SELECT ${ENGAGEMENT_COLS}, ${TASK_COLS('t')}, ${WORK_LINK_COLUMNS}
         FROM hsdg.tasks t
         ${ENGAGEMENT_JOIN('t.engagement_id')}
         ${TASK_PEOPLE('t')}
         ${workLinkJoin('t.source_compliance_instance_id')}
        WHERE t.assigned_to_employee_id = $1
          AND t.status IN ('todo', 'in_progress', 'paused', 'blocked')
          AND ($2::uuid IS NULL OR t.engagement_id = $2)`,
      [me, engagementId],
    );
    return rows.map((r) => {
      const task = taskOf(r)!;
      const filing = workFilingContextOf(r);
      const internalDate = filing?.internalDate ?? r.tk_due_date;
      return {
        key: `task:${task.id}`,
        kind: 'task',
        group: task.status === 'blocked' ? TODAY_GROUP.waiting : TODAY_GROUP.prepare,
        title: task.title,
        ...engagementOf(r),
        filing,
        internalDate,
        statutoryDate: filing?.statutoryDate ?? null,
        status: task.status,
        isOverdue: isPastDate(internalDate, today),
        blockedByOpenCount: r.tk_blocked_by_open_count ?? 0,
        task,
        link: workLinkOf(
          { engagementId: r.engagement_id, engagementKind: r.engagement_kind, taskId: task.id },
          workLinkFilingOf(r),
        ),
      };
    });
  }

  /**
   * Open client requests I'm responsible for — less those raised by a task of
   * mine that is already listed as waiting (Waiting on client raises one).
   */
  private async myRequests(
    client: PoolClient,
    me: string,
    engagementId: string | null,
    today: string,
  ): Promise<TodayItem[]> {
    const { rows } = await client.query<RequestRow>(
      `SELECT ${ENGAGEMENT_COLS}, cd.id, cd.requested_info, cd.status,
              cd.escalation_date::text, cd.period_section, ${WORK_LINK_COLUMNS}
         FROM hsdg.client_dependencies cd
         ${ENGAGEMENT_JOIN('cd.engagement_id')}
         ${workLinkJoin('cd.compliance_instance_id')}
        WHERE cd.responsible_employee_id = $1
          AND cd.status IN ('pending', 'partially_received')
          AND ($2::uuid IS NULL OR cd.engagement_id = $2)
          AND NOT EXISTS (SELECT 1 FROM hsdg.tasks bt
                           WHERE bt.id = cd.task_id AND bt.assigned_to_employee_id = $1
                             AND bt.status = 'blocked')`,
      [me, engagementId],
    );
    return rows.map((r) => {
      const filing = workFilingContextOf(r);
      return {
        key: `client_request:${r.id}`,
        kind: 'client_request',
        group: TODAY_GROUP.waiting,
        title: r.requested_info,
        ...engagementOf(r),
        filing,
        internalDate: filing?.internalDate ?? r.escalation_date,
        statutoryDate: filing?.statutoryDate ?? null,
        status: r.status,
        // A request is late once the client is past its escalation date.
        isOverdue: isPastDate(r.escalation_date, today),
        blockedByOpenCount: 0,
        task: null,
        link: workLinkOf(
          { engagementId: r.engagement_id, engagementKind: r.engagement_kind, requestId: r.id },
          { ...workLinkFilingOf(r), section: r.period_section ?? r.wl_section },
        ),
      };
    });
  }

  /**
   * Open filings due internally within a week (or already past), on work I
   * prepare or review (the filing's task) or lead (its stream) — with or
   * without a task. The candidate ids come from my tasks and my streams first,
   * so the filing table is probed by key, never scanned.
   */
  private async filingsDueSoon(
    client: PoolClient,
    me: string,
    engagementId: string | null,
    today: string,
  ): Promise<TodayItem[]> {
    const { rows } = await client.query<FilingRow>(
      `WITH mine AS (
         SELECT mt.source_compliance_instance_id AS id FROM hsdg.tasks mt
          WHERE mt.assigned_to_employee_id = $1 AND mt.source_compliance_instance_id IS NOT NULL
         UNION
         SELECT mt.source_compliance_instance_id FROM hsdg.tasks mt
          WHERE mt.reviewer_employee_id = $1 AND mt.source_compliance_instance_id IS NOT NULL
         UNION
         SELECT mci.id FROM hsdg.engagement_services mes
           JOIN hsdg.compliance_instances mci ON mci.engagement_service_id = mes.id
          WHERE mes.lead_employee_id = $1
       )
       SELECT ${ENGAGEMENT_COLS}, ci.workflow_status, ${TASK_COLS('ft')}, ${WORK_LINK_COLUMNS}
         FROM mine
         JOIN hsdg.compliance_instances ci ON ci.id = mine.id
         ${ENGAGEMENT_JOIN('ci.engagement_id')}
         LEFT JOIN hsdg.tasks ft ON ft.source_compliance_instance_id = ci.id
         ${TASK_PEOPLE('ft')}
         ${workLinkJoin('ci.id')}
        WHERE ci.status = 'open' AND ci.workflow_status NOT IN ('filed', 'not_applicable')
          AND COALESCE(ci.internal_sla_override, ci.internal_sla_date) <= $2::date + $3::int
          AND eng.status <> ALL($4::text[])
          AND ($5::uuid IS NULL OR ci.engagement_id = $5)`,
      [me, today, TODAY_DUE_WITHIN_DAYS, CLOSED_ENGAGEMENT_STATUSES, engagementId],
    );
    return rows.map((r) => {
      const filing = workFilingContextOf(r)!;
      const task = taskOf(r);
      return {
        key: `filing:${filing.instanceId}`,
        kind: 'filing',
        group: TODAY_GROUP.dueSoon,
        title: `${filing.formLabel} · ${filing.periodLabel}`,
        ...engagementOf(r),
        filing,
        internalDate: filing.internalDate,
        statutoryDate: filing.statutoryDate,
        status: task?.status ?? r.workflow_status,
        isOverdue: isPastDate(filing.internalDate, today),
        blockedByOpenCount: r.tk_blocked_by_open_count ?? 0,
        task,
        link: workLinkOf(
          {
            engagementId: r.engagement_id,
            engagementKind: r.engagement_kind,
            taskId: task?.id ?? null,
          },
          workLinkFilingOf(r),
        ),
      };
    });
  }
}

function emptyGroups(): Parameters<typeof buildTodayView>[1] {
  return { prepare: [], review: [], waiting: [], due_soon: [] };
}

function engagementOf(
  r: EngagementCols,
): Pick<TodayItem, 'engagementId' | 'engagementCode' | 'engagementKind' | 'entityName'> {
  return {
    engagementId: r.engagement_id,
    engagementCode: r.engagement_code,
    engagementKind: r.engagement_kind,
    entityName: r.entity_name,
  };
}

function taskOf(r: TaskCols): TodayTask | null {
  if (!r.tk_id) return null;
  return {
    id: r.tk_id,
    title: r.tk_title ?? '',
    status: r.tk_status!,
    version: r.tk_version ?? 0,
    assignedToId: r.tk_assigned_to_id,
    assignedToName: r.tk_assigned_to_name,
    reviewerId: r.tk_reviewer_id,
    reviewerName: r.tk_reviewer_name,
    sentForReviewAt: r.tk_sent_for_review_at?.toISOString() ?? null,
    reviewStartedAt: r.tk_review_started_at?.toISOString() ?? null,
  };
}
