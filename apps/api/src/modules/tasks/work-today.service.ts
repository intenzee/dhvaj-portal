import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CLIENT_REMINDER_CHANNEL,
  TODAY_DUE_WITHIN_DAYS,
  TODAY_GROUP,
  formatInr,
  isPastDate,
  noticeClock,
  noticeTypeLabel,
  whatsappNumber,
  type NoticeStatus,
  type NoticeStream,
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
  filingTitle,
  type WorkLinkSqlRow,
  workFilingContextOf,
  workLinkFilingOf,
  workLinkJoin,
  workLinkOf,
} from '../../common/work-links';
import { CLOSED_ENGAGEMENT_STATUSES } from '../compliance/compliance-calendar-v2.service';
import { clientPhoneSql } from '../filing-workspace/client-chase';
import { workflowPolicy } from '../workflow-settings/workflow-policy';
import { WorkReviewsService } from './work-reviews.service';
import { buildTodayView, reviewToToday, type TodayRows } from './work-today';

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
  tk_audit_area_id: string | null;
  tk_blocked_by_open_count: number | null;
}

const TASK_COLS = (t: string): string => `
  ${t}.id AS tk_id, ${t}.title AS tk_title, ${t}.status AS tk_status, ${t}.version AS tk_version,
  ${t}.due_date::text AS tk_due_date,
  ${t}.assigned_to_employee_id AS tk_assigned_to_id, tae.full_name AS tk_assigned_to_name,
  ${t}.reviewer_employee_id AS tk_reviewer_id, tre.full_name AS tk_reviewer_name,
  ${t}.sent_for_review_at AS tk_sent_for_review_at, ${t}.review_started_at AS tk_review_started_at,
  ${t}.audit_work_area_id AS tk_audit_area_id,
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
  task_id: string | null;
  requested_info: string;
  status: string;
  escalation_date: string | null;
  period_section: TodayItem['link']['section'] | null;
}

interface NoticeRow extends EngagementCols {
  id: string;
  reference_no: string;
  status: NoticeStatus;
  internal_due_on: string | null;
  reply_due_on: string | null;
  next_hearing_on: string | null;
  appeal_due_on: string | null;
  amount_demanded: string | null;
  stream: NoticeStream;
  form: string | null;
  section: string | null;
  type_title: string;
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

  /**
   * `opts.notices`: ff_notices is on for the caller's office (adds the Notices
   * group). `opts.writeOffs`: ff_billing_v2 is on and the caller holds
   * billing.approve (adds Write-offs to approve, PS-205).
   */
  async today(
    ctx: RlsContext,
    engagementId?: string,
    opts: { notices?: boolean; writeOffs?: boolean } = {},
  ): Promise<TodayView> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ today: string }>(
        `SELECT to_char(timezone('Asia/Kolkata', now()), 'YYYY-MM-DD') AS today`,
      );
      const today = rows[0]!.today;
      const me = ctx.employeeId;
      if (!me) return buildTodayView(today, emptyGroups(opts));
      const eng = engagementId ?? null;
      const tasks = await this.myOpenTasks(client, me, eng, today);
      const view = buildTodayView(
        today,
        {
          [TODAY_GROUP.prepare]: tasks.filter((t) => t.group === TODAY_GROUP.prepare),
          [TODAY_GROUP.review]: (await this.reviews.itemsWith(client, me)).map((r) =>
            reviewToToday(r, today, me),
          ),
          [TODAY_GROUP.waiting]: await this.withWhatsapp(client, [
            ...tasks.filter((t) => t.group === TODAY_GROUP.waiting),
            ...(await this.myRequests(client, me, eng, today, listedWaiting(tasks))),
          ]),
          [TODAY_GROUP.dueSoon]: await this.filingsDueSoon(client, me, eng, today),
          ...(opts.notices
            ? { [TODAY_GROUP.notices]: await this.myNotices(client, me, eng, today) }
            : {}),
          ...(opts.writeOffs
            ? { [TODAY_GROUP.writeOffs]: await this.writeOffsToApprove(client, me, eng) }
            : {}),
        },
        engagementId,
      );
      return view;
    });
  }

  /**
   * PS-001: on rows waiting on a filing's client, whether to offer WhatsApp
   * beside the firm's reminder. One query for every such filing, none when
   * WhatsApp is already the firm's channel.
   */
  private async withWhatsapp(client: PoolClient, items: TodayItem[]): Promise<TodayItem[]> {
    const ids = [...new Set(items.flatMap((i) => (i.link.instanceId ? [i.link.instanceId] : [])))];
    if (ids.length === 0) return items;
    let reachable = new Set<string>();
    if ((await workflowPolicy(client)).clientReminderChannel !== CLIENT_REMINDER_CHANNEL.whatsapp) {
      const { rows } = await client.query<{ id: string; phone: string | null }>(
        `SELECT ci.id, ${clientPhoneSql('e.entity_id')} AS phone
           FROM hsdg.compliance_instances ci
           JOIN hsdg.engagements e ON e.id = ci.engagement_id
          WHERE ci.id = ANY($1::uuid[])`,
        [ids],
      );
      reachable = new Set(rows.filter((r) => whatsappNumber(r.phone)).map((r) => r.id));
    }
    return items.map((i) =>
      i.link.instanceId ? { ...i, offersWhatsapp: reachable.has(i.link.instanceId) } : i,
    );
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
        // The filing's own task reads as the filing, like its review row.
        title: filingTitle(filing, task.title),
        ...engagementOf(r),
        filing,
        internalDate,
        statutoryDate: filing?.statutoryDate ?? null,
        status: task.status,
        isOverdue: isPastDate(internalDate, today),
        blockedByOpenCount: r.tk_blocked_by_open_count ?? 0,
        task,
        link: workLinkOf(
          {
            engagementId: r.engagement_id,
            engagementKind: r.engagement_kind,
            taskId: task.id,
            auditAreaId: r.tk_audit_area_id,
          },
          workLinkFilingOf(r),
        ),
      };
    });
  }

  /**
   * Open client requests I'm responsible for — less those raised by a task of
   * mine that is already listed as waiting (Waiting on client raises one).
   * Those are dropped here, against the tasks already read, rather than by an
   * anti-join: on freshly loaded rows the planner probed every task of mine per
   * request (WF-201's 300 ms budget, see work-today-perf.e2e-spec.ts).
   */
  private async myRequests(
    client: PoolClient,
    me: string,
    engagementId: string | null,
    today: string,
    listedTaskIds: ReadonlySet<string>,
  ): Promise<TodayItem[]> {
    const { rows } = await client.query<RequestRow>(
      `SELECT ${ENGAGEMENT_COLS}, cd.id, cd.task_id, cd.requested_info, cd.status,
              cd.escalation_date::text, cd.period_section, ${WORK_LINK_COLUMNS}
         FROM hsdg.client_dependencies cd
         ${ENGAGEMENT_JOIN('cd.engagement_id')}
         ${workLinkJoin('cd.compliance_instance_id')}
        WHERE cd.responsible_employee_id = $1
          AND cd.status IN ('pending', 'partially_received')
          AND ($2::uuid IS NULL OR cd.engagement_id = $2)`,
      [me, engagementId],
    );
    return rows
      .filter((r) => !r.task_id || !listedTaskIds.has(r.task_id))
      .map((r) => {
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
   * PS-102: open notices I own or review whose clock is running (a reply to
   * file, a hearing ahead, an appeal window) — dated by the clock, so the
   * group sorts on the firm's internal reply date, the hearing or the appeal.
   */
  private async myNotices(
    client: PoolClient,
    me: string,
    engagementId: string | null,
    today: string,
  ): Promise<TodayItem[]> {
    const { rows } = await client.query<NoticeRow>(
      `SELECT ${ENGAGEMENT_COLS}, n.id, n.reference_no, n.status,
              n.internal_due_on::text, n.reply_due_on::text, n.next_hearing_on::text,
              n.appeal_due_on::text, n.amount_demanded::text,
              nt.stream, nt.form, nt.section, nt.title AS type_title
         FROM hsdg.notices n
         JOIN hsdg.notice_types nt ON nt.id = n.notice_type_id
         ${ENGAGEMENT_JOIN('n.engagement_id')}
        WHERE (n.owner_employee_id = $1 OR n.reviewer_employee_id = $1)
          AND n.status NOT IN ('closed', 'withdrawn', 'appealed')
          AND ($2::uuid IS NULL OR n.engagement_id = $2)`,
      [me, engagementId],
    );
    return rows.flatMap((r) => {
      const clock = noticeClock(
        {
          status: r.status,
          internalDueOn: r.internal_due_on,
          replyDueOn: r.reply_due_on,
          nextHearingOn: r.next_hearing_on,
          appealDueOn: r.appeal_due_on,
        },
        today,
      );
      if (!clock) return [];
      const typeLabel = noticeTypeLabel({ form: r.form, section: r.section, title: r.type_title });
      const item: TodayItem = {
        key: `notice:${r.id}`,
        kind: 'notice',
        group: TODAY_GROUP.notices,
        title: `${r.form ?? r.type_title} · ${r.reference_no}`,
        ...engagementOf(r),
        filing: null,
        internalDate: clock.due,
        // The department's reply date, while the reply is what's due.
        statutoryDate: clock.label === 'Reply due' ? r.reply_due_on : null,
        status: r.status,
        isOverdue: clock.overdue,
        blockedByOpenCount: 0,
        task: null,
        notice: {
          id: r.id,
          referenceNo: r.reference_no,
          stream: r.stream,
          typeLabel,
          clockLabel: clock.label,
          amountDemanded: r.amount_demanded,
        },
        link: { engagementId: r.engagement_id, engagementKind: r.engagement_kind, noticeId: r.id },
      };
      return [item];
    });
  }

  /**
   * PS-205: pending write-offs and credit notes on clients I bill (RLS) that
   * someone else asked for — mine to approve or reject. Dated by the request.
   */
  private async writeOffsToApprove(
    client: PoolClient,
    me: string,
    engagementId: string | null,
  ): Promise<TodayItem[]> {
    const { rows } = await client.query<
      EngagementCols & {
        id: string;
        kind: 'write_off' | 'credit_note';
        invoice_id: string;
        invoice_number: string | null;
        amount: string;
        reason: string;
        requested_by_name: string | null;
        requested_on: string;
        version: number;
      }
    >(
      `SELECT ${ENGAGEMENT_COLS}, a.id, a.kind, a.invoice_id, i.invoice_number, a.amount,
              a.reason, rb.full_name AS requested_by_name, a.version,
              timezone('Asia/Kolkata', a.created_at)::date::text AS requested_on
         FROM (SELECT w.id, 'write_off'::text AS kind, w.invoice_id, w.amount, w.reason,
                      w.requested_by_employee_id, w.version, w.created_at
                 FROM hsdg.write_offs w WHERE w.status = 'pending'
               UNION ALL
               SELECT c.id, 'credit_note', c.invoice_id, c.total, c.reason,
                      c.requested_by_employee_id, c.version, c.created_at
                 FROM hsdg.credit_notes c WHERE c.status = 'pending') a
         JOIN hsdg.invoices i ON i.id = a.invoice_id
         ${ENGAGEMENT_JOIN('i.engagement_id')}
         LEFT JOIN hsdg.employees rb ON rb.id = a.requested_by_employee_id
        WHERE a.requested_by_employee_id IS DISTINCT FROM $1
          AND ($2::uuid IS NULL OR i.engagement_id = $2)`,
      [me, engagementId],
    );
    return rows.map((r) => ({
      key: `${r.kind}:${r.id}`,
      kind: r.kind,
      group: TODAY_GROUP.writeOffs,
      title: `${r.kind === 'write_off' ? 'Write off' : 'Credit note'} ${formatInr(r.amount)} on ${r.invoice_number ?? 'an invoice'}`,
      ...engagementOf(r),
      filing: null,
      internalDate: r.requested_on,
      statutoryDate: null,
      status: 'pending',
      isOverdue: false,
      blockedByOpenCount: 0,
      task: null,
      adjustment: {
        id: r.id,
        kind: r.kind,
        invoiceId: r.invoice_id,
        invoiceNumber: r.invoice_number,
        amount: r.amount,
        reason: r.reason,
        requestedByName: r.requested_by_name,
        version: r.version,
      },
      link: { engagementId: r.engagement_id, engagementKind: r.engagement_kind },
    }));
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

/** The ids of my tasks already listed as waiting on the client. */
function listedWaiting(tasks: TodayItem[]): Set<string> {
  return new Set(
    tasks.flatMap((t) => (t.group === TODAY_GROUP.waiting && t.task ? [t.task.id] : [])),
  );
}

function emptyGroups(opts: { notices?: boolean; writeOffs?: boolean }): TodayRows {
  return {
    prepare: [],
    review: [],
    waiting: [],
    due_soon: [],
    ...(opts.notices ? { notices: [] } : {}),
    ...(opts.writeOffs ? { write_offs: [] } : {}),
  };
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
