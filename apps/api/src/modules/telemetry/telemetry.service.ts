import { BadRequestException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  NOTIFICATION_TYPES,
  WORKFLOW_MEASURE,
  notificationKind,
  telemetryPath,
  type TelemetryEventInput,
  type WorkflowMeasure,
  type WorkflowMeasuresReport,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { istToday } from '../engagements/time/auto-time';
import type { WorkflowMeasuresQueryDto } from './telemetry.dto';

const DAY_MS = 86_400_000;
/** The longest window the report measures. */
const MAX_DAYS = 366;
/** Engagements that never carry live work. */
const DEAD_ENGAGEMENT = ['cancelled', 'declined', 'withdrawn', 'merged'];
const ACTIONABLE_TYPES = NOTIFICATION_TYPES.filter((t) => notificationKind(t) === 'actionable');

/** A yyyy-mm-dd day shifted by `days`. */
function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
/** The instant an IST day starts. */
function istStart(day: string): Date {
  return new Date(`${day}T00:00:00+05:30`);
}
const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100;

/** One window's raw numbers. */
interface WindowNumbers {
  sessions: number;
  sessionsWithFiling: number;
  steps: number | null;
  rowOpens: number;
  exactRowOpens: number;
  users: number;
  unreadPerUser: number | null;
  reviews: number;
  reviewWaitHours: number | null;
  overdue: number;
  filed: number;
  receivedToFiledDays: number | null;
}

/**
 * Staff Workflow · How we measure it. Events are written as the signed-in user;
 * the report reads cross-user telemetry only in aggregate (a SECURITY DEFINER
 * function), and everything else under the caller's RLS context, like the other
 * MIS reports.
 */
@Injectable()
export class TelemetryService {
  constructor(private readonly db: DatabaseService) {}

  async record(ctx: RlsContext, events: TelemetryEventInput[], now = new Date()): Promise<void> {
    const rows = events.map((e) => {
      // Strip again: a client that left an id in the path does not get it stored.
      const { path } = telemetryPath(e.path);
      const at = e.at ? Date.parse(e.at) : NaN;
      const clamped =
        Number.isFinite(at) && at <= now.getTime() && at >= now.getTime() - DAY_MS
          ? new Date(at)
          : now;
      return {
        kind: e.kind,
        path,
        params: [...new Set(e.params)].sort(),
        source: e.source ?? null,
        session: e.sessionId,
        at: clamped.toISOString(),
      };
    });
    await this.db.withRlsContext(ctx, (client) =>
      client.query(
        `INSERT INTO hsdg.telemetry_events (session_id, kind, path, params, source, occurred_at)
         SELECT r.session, r.kind, r.path,
                ARRAY(SELECT jsonb_array_elements_text(r.params)), r.source, r.at
           FROM jsonb_to_recordset($1::jsonb)
                AS r(session text, kind text, path text, params jsonb, source text, at timestamptz)`,
        [JSON.stringify(rows)],
      ),
    );
  }

  async measures(ctx: RlsContext, q: WorkflowMeasuresQueryDto): Promise<WorkflowMeasuresReport> {
    const today = istToday();
    const to = q.to ?? today;
    const from = q.from ?? shiftDay(to, -6);
    const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
    if (days < 1 || days > MAX_DAYS)
      throw new BadRequestException(`from must be on or before to, at most ${MAX_DAYS} days`);
    const officeId = q.officeId ?? null;

    const cur = { from: istStart(from), to: istStart(shiftDay(to, 1)) };
    const prev = { from: istStart(shiftDay(from, -days)), to: cur.from };
    const [now, before] = await this.db.withRlsContext(ctx, async (client) => [
      await this.window(client, cur.from, cur.to, officeId),
      await this.window(client, prev.from, prev.to, officeId),
    ]);

    const share = (w: WindowNumbers): number | null =>
      w.rowOpens ? Math.round((w.exactRowOpens / w.rowOpens) * 1000) / 10 : null;
    const exact = share(now);
    const measures: WorkflowMeasure[] = [
      {
        key: WORKFLOW_MEASURE.stepsToFirstAction,
        label: 'Steps from sign-in to the first filing',
        how: 'Pages opened after sign-in until one lands on a filing, task or request; median per session',
        value: now.steps,
        previous: before.steps,
        unit: 'steps',
        sample: now.sessionsWithFiling,
        target: '≤ 2',
        meetsTarget: now.steps === null ? null : now.steps <= 2,
      },
      {
        key: WORKFLOW_MEASURE.exactLinkShare,
        label: 'List clicks that land on the exact item',
        how: 'Rows opened from a list whose link names a section, task, request or the filing drawer',
        value: exact,
        previous: share(before),
        unit: 'percent',
        sample: now.rowOpens,
        target: '≥ 90%',
        meetsTarget: exact === null ? null : exact >= 90,
      },
      {
        key: WORKFLOW_MEASURE.reviewWait,
        label: 'Review wait',
        how: 'From sent for review to the review starting, median, for reviews started in the window',
        value: now.reviewWaitHours,
        previous: before.reviewWaitHours,
        unit: 'hours',
        sample: now.reviews,
        target: '−30% on the baseline',
        meetsTarget: null,
      },
      {
        key: WORKFLOW_MEASURE.filingsPastInternal,
        label: 'Filings past their internal due date',
        how: 'Open filings whose internal date had passed at the end of the window',
        value: now.overdue,
        previous: before.overdue,
        unit: 'filings',
        sample: now.overdue,
        target: '−25% on the baseline',
        meetsTarget: null,
      },
      {
        key: WORKFLOW_MEASURE.receivedToFiled,
        label: 'Data received → filed',
        how: "From the last client request received to the filing's lodged date, median, for filings lodged in the window",
        value: now.receivedToFiledDays,
        previous: before.receivedToFiledDays,
        unit: 'days',
        sample: now.filed,
        target: '−20% on the baseline',
        meetsTarget: null,
      },
      {
        key: WORKFLOW_MEASURE.unreadPerUser,
        label: 'Unread notifications per person',
        how: 'Actionable notifications left unread at the end of each day, averaged over people and days',
        value: now.unreadPerUser,
        previous: before.unreadPerUser,
        unit: 'notifications',
        sample: now.users,
        target: '≤ 10',
        meetsTarget: now.unreadPerUser === null ? null : now.unreadPerUser <= 10,
      },
    ];
    return { from, to, officeId, measures };
  }

  /** The raw numbers for [from, to). */
  private async window(
    client: PoolClient,
    from: Date,
    to: Date,
    officeId: string | null,
  ): Promise<WindowNumbers> {
    // A window still running is measured up to now.
    const end = new Date(Math.min(to.getTime(), Date.now()));
    const t = await client.query<{
      sessions: number;
      sessions_with_filing: number;
      steps_median: string | null;
      row_opens: number;
      exact_row_opens: number;
      users: number;
      unread_per_user: string | null;
    }>(`SELECT * FROM hsdg.telemetry_measures($1, $2, $3, $4)`, [
      from,
      to,
      officeId,
      ACTIONABLE_TYPES,
    ]);
    // Approving or returning a task clears review_started_at, so a finished
    // review is dated by the reviewer's first review clock after it was sent.
    const review = await client.query<{ v: string | null; n: number }>(
      `WITH r AS (
         SELECT t.sent_for_review_at AS sent,
                COALESCE(t.review_started_at,
                  (SELECT min(te.started_at) FROM hsdg.engagement_time_entries te
                    WHERE te.task_id = t.id AND te.entry_kind = 'review'
                      AND te.adjusts_entry_id IS NULL
                      AND te.started_at >= t.sent_for_review_at)) AS started
           FROM hsdg.tasks t
           JOIN hsdg.engagements e ON e.id = t.engagement_id
          WHERE t.sent_for_review_at IS NOT NULL AND t.sent_for_review_at < $2
            AND ($3::uuid IS NULL OR e.office_id = $3)
       )
       SELECT percentile_cont(0.5) WITHIN GROUP (
                ORDER BY extract(epoch FROM started - sent) / 3600) AS v,
              count(*)::int AS n
         FROM r
        WHERE started >= $1 AND started < $2 AND started >= sent`,
      [from, to, officeId],
    );
    const overdue = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM hsdg.compliance_instances ci
         JOIN hsdg.engagements e ON e.id = ci.engagement_id
        WHERE COALESCE(ci.internal_sla_override, ci.internal_sla_date)
                < ($1::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
          AND ci.created_at < $1
          AND ci.status <> 'waived' AND ci.workflow_status <> 'not_applicable'
          AND (ci.completed_at IS NULL OR ci.completed_at >= $1)
          AND NOT (ci.completed_at IS NULL AND ci.workflow_status = 'filed')
          AND e.status <> ALL ($2::text[])
          AND ($3::uuid IS NULL OR e.office_id = $3)`,
      [end, DEAD_ENGAGEMENT, officeId],
    );
    const filed = await client.query<{ v: string | null; n: number }>(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY fr.filed_on - r.received) AS v,
              count(*)::int AS n
         FROM hsdg.filing_records fr
         JOIN hsdg.compliance_instances ci ON ci.id = fr.compliance_instance_id
         JOIN hsdg.engagements e ON e.id = ci.engagement_id
         JOIN LATERAL (
           SELECT max(cd.received_date) AS received
             FROM hsdg.client_dependencies cd
            WHERE cd.compliance_instance_id = ci.id AND cd.status = 'received'
         ) r ON r.received IS NOT NULL AND r.received <= fr.filed_on
        WHERE fr.undone_at IS NULL
          AND fr.filed_on >= ($1::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
          AND fr.filed_on < ($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
          AND ($3::uuid IS NULL OR e.office_id = $3)`,
      [from, to, officeId],
    );
    // Aggregates: always exactly one row.
    const m = t.rows[0]!;
    const r = review.rows[0]!;
    const o = overdue.rows[0]!;
    const f = filed.rows[0]!;
    return {
      sessions: m.sessions,
      sessionsWithFiling: m.sessions_with_filing,
      steps: num(m.steps_median),
      rowOpens: m.row_opens,
      exactRowOpens: m.exact_row_opens,
      users: m.users,
      unreadPerUser: num(m.unread_per_user),
      reviews: r.n,
      reviewWaitHours: num(r.v),
      overdue: o.n,
      filed: f.n,
      receivedToFiledDays: num(f.v),
    };
  }
}
