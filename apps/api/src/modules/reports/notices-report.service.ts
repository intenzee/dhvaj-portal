import { Injectable } from '@nestjs/common';
import {
  noticeClock,
  type NoticeListItem,
  type NoticeOutcome,
  type NoticeStatus,
  type NoticeStream,
  type NoticesReport,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { istToday } from '../engagements/time/auto-time';

/** "Due soon" on the report: the clock falls within this many days (or is past). */
export const NOTICES_DUE_SOON_DAYS = 7;
/** Statuses with no clock and no exposure. */
const DONE = ['closed', 'withdrawn'];

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface DueRow {
  id: string;
  entity_id: string;
  entity_name: string;
  engagement_id: string;
  engagement_code: string;
  registration_number: string | null;
  type_id: string;
  type_code: string;
  stream: NoticeStream;
  form: string | null;
  section: string | null;
  title: string;
  appealable: boolean;
  reference_no: string;
  issued_on: string;
  received_on: string;
  financial_year: string | null;
  assessment_year: string | null;
  amount_demanded: string | null;
  owner_id: string;
  owner_name: string;
  reviewer_id: string | null;
  reviewer_name: string | null;
  outcome: NoticeOutcome | null;
  version: number;
  status: NoticeStatus;
  internal_due_on: string | null;
  reply_due_on: string | null;
  next_hearing_on: string | null;
  appeal_due_on: string | null;
}

/**
 * PS-105 · the partners' notices report: the firm's open exposure by stream,
 * status and office, what falls due this week, demanded vs outcome on closed
 * notices, and how long replies take. Every query runs under the caller's RLS
 * context — the notice policies show a notice to its engagement's team and to
 * firm-wide roles — so the Managing Partner sees the firm and a partner their
 * own engagements' notices. `officeId` narrows to the engagement's office.
 */
@Injectable()
export class NoticesReportService {
  constructor(private readonly db: DatabaseService) {}

  async report(
    ctx: RlsContext,
    officeId: string | null,
    today: string = istToday(),
  ): Promise<NoticesReport> {
    return this.db.withRlsContext(ctx, async (client) => {
      const scope = `($1::uuid IS NULL OR g.office_id = $1)`;

      const open = await client.query<{
        g_stream: number;
        g_status: number;
        g_office: number;
        stream: NoticeStream | null;
        status: NoticeStatus | null;
        office_id: string | null;
        office_name: string | null;
        count: number;
        amount: string;
      }>(
        `SELECT GROUPING(t.stream)::int AS g_stream, GROUPING(n.status)::int AS g_status,
                GROUPING(g.office_id, o.name)::int AS g_office,
                t.stream, n.status, g.office_id, o.name AS office_name,
                count(*)::int AS count,
                COALESCE(sum(n.amount_demanded), 0)::numeric(18, 2)::text AS amount
           FROM hsdg.notices n
           JOIN hsdg.notice_types t ON t.id = n.notice_type_id
           JOIN hsdg.engagements g ON g.id = n.engagement_id
           JOIN hsdg.offices o ON o.id = g.office_id
          WHERE n.status <> ALL($2::text[]) AND ${scope}
          GROUP BY GROUPING SETS ((t.stream), (n.status), (g.office_id, o.name), ())`,
        [officeId, DONE],
      );
      const total = open.rows.find((r) => r.g_stream && r.g_status && r.g_office);
      const byStream = open.rows
        .filter((r) => !r.g_stream)
        .map((r) => ({ stream: r.stream!, count: r.count, amountDemanded: r.amount }))
        .sort((a, b) => b.count - a.count || a.stream.localeCompare(b.stream));
      const byStatus = open.rows
        .filter((r) => !r.g_status)
        .map((r) => ({ status: r.status!, count: r.count }))
        .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
      const byOffice = open.rows
        .filter((r) => !r.g_office)
        .map((r) => ({
          officeId: r.office_id!,
          officeName: r.office_name!,
          count: r.count,
          amountDemanded: r.amount,
        }))
        .sort((a, b) => b.count - a.count || a.officeName.localeCompare(b.officeName));

      // Candidates for "due soon": any clock date on or before the horizon.
      // noticeClock (the one rule every list uses) then decides.
      const horizon = addDays(today, NOTICES_DUE_SOON_DAYS);
      const due = await client.query<DueRow>(
        `SELECT n.id, n.entity_id, COALESCE(e.legal_name, '') AS entity_name,
                n.engagement_id, g.engagement_code, r.registration_number,
                t.id AS type_id, t.code AS type_code, t.stream, t.form, t.section, t.title,
                t.appealable, n.reference_no, n.issued_on::text, n.received_on::text,
                n.financial_year, n.assessment_year, n.amount_demanded::text,
                n.owner_employee_id AS owner_id, COALESCE(ow.full_name, '') AS owner_name,
                n.reviewer_employee_id AS reviewer_id, rv.full_name AS reviewer_name,
                n.outcome, n.version, n.status,
                n.internal_due_on::text, n.reply_due_on::text, n.next_hearing_on::text,
                n.appeal_due_on::text
           FROM hsdg.notices n
           JOIN hsdg.notice_types t ON t.id = n.notice_type_id
           JOIN hsdg.engagements g ON g.id = n.engagement_id
           LEFT JOIN hsdg.entities e ON e.id = n.entity_id
           LEFT JOIN hsdg.entity_registrations r ON r.id = n.registration_id
           LEFT JOIN hsdg.employees ow ON ow.id = n.owner_employee_id
           LEFT JOIN hsdg.employees rv ON rv.id = n.reviewer_employee_id
          WHERE n.status <> ALL($2::text[]) AND n.status <> 'appealed' AND ${scope}
            AND (COALESCE(n.internal_due_on, n.reply_due_on) <= $3::date
                 OR n.next_hearing_on <= $3::date OR n.appeal_due_on <= $3::date)`,
        [officeId, DONE, horizon],
      );
      const dueSoon = due.rows
        .map((row) => toListItem(row, today))
        .filter((n) => n.clock !== null && n.clock.due <= horizon)
        .sort((a, b) => a.clock!.due.localeCompare(b.clock!.due) || a.id.localeCompare(b.id));

      const closed = await client.query<{
        g_outcome: number;
        outcome: NoticeOutcome | null;
        count: number;
        demanded: string;
        outcome_amount: string;
      }>(
        `SELECT GROUPING(n.outcome)::int AS g_outcome, n.outcome, count(*)::int AS count,
                COALESCE(sum(n.amount_demanded), 0)::numeric(18, 2)::text AS demanded,
                COALESCE(sum(n.outcome_amount), 0)::numeric(18, 2)::text AS outcome_amount
           FROM hsdg.notices n
           JOIN hsdg.engagements g ON g.id = n.engagement_id
          WHERE n.status = 'closed' AND ${scope}
          GROUP BY GROUPING SETS ((n.outcome), ())`,
        [officeId],
      );
      const closedTotal = closed.rows.find((r) => r.g_outcome);

      // Received → the first reply filed (a voided event never counts).
      const reply = await client.query<{ avg: string | null }>(
        `SELECT round(avg(f.first_reply - f.received_on), 1)::text AS avg
           FROM (SELECT n.received_on, min(ev.occurred_on) AS first_reply
                   FROM hsdg.notices n
                   JOIN hsdg.engagements g ON g.id = n.engagement_id
                   JOIN hsdg.notice_events ev
                     ON ev.notice_id = n.id AND ev.kind = 'reply_filed' AND ev.voided_at IS NULL
                  WHERE ${scope}
                  GROUP BY n.id, n.received_on) f`,
        [officeId],
      );
      const avg = reply.rows[0]?.avg;

      return {
        asOf: today,
        open: {
          total: total?.count ?? 0,
          amountDemanded: total?.amount ?? '0.00',
          byStream,
          byStatus,
          byOffice,
        },
        dueSoon,
        closed: {
          count: closedTotal?.count ?? 0,
          amountDemanded: closedTotal?.demanded ?? '0.00',
          outcomeAmount: closedTotal?.outcome_amount ?? '0.00',
          byOutcome: closed.rows
            .filter((r) => !r.g_outcome && r.outcome)
            .map((r) => ({
              outcome: r.outcome!,
              count: r.count,
              amountDemanded: r.demanded,
              outcomeAmount: r.outcome_amount,
            }))
            .sort((a, b) => b.count - a.count || a.outcome.localeCompare(b.outcome)),
        },
        avgDaysToReply: avg == null ? null : Number(avg),
      };
    });
  }
}

function toListItem(r: DueRow, today: string): NoticeListItem {
  const clockInput = {
    status: r.status,
    internalDueOn: r.internal_due_on,
    replyDueOn: r.reply_due_on,
    nextHearingOn: r.next_hearing_on,
    appealDueOn: r.appeal_due_on,
  };
  return {
    id: r.id,
    entityId: r.entity_id,
    entityName: r.entity_name,
    engagementId: r.engagement_id,
    engagementCode: r.engagement_code,
    registrationNumber: r.registration_number,
    noticeType: {
      id: r.type_id,
      code: r.type_code,
      stream: r.stream,
      form: r.form,
      section: r.section,
      title: r.title,
      appealable: r.appealable,
    },
    referenceNo: r.reference_no,
    issuedOn: r.issued_on,
    receivedOn: r.received_on,
    financialYear: r.financial_year,
    assessmentYear: r.assessment_year,
    amountDemanded: r.amount_demanded,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    reviewerId: r.reviewer_id,
    reviewerName: r.reviewer_name,
    outcome: r.outcome,
    version: r.version,
    ...clockInput,
    clock: noticeClock(clockInput, today),
  };
}
