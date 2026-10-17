import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  AUTO_TIME,
  NON_BILLABLE_TIME_CATEGORIES,
  NOTIFICATION_TYPE,
  TIME_STOP_REASON,
  type ClockState,
  type HeartbeatResult,
  type OtherTimeCategory,
  type TimeAdjustmentRecord,
  type TimeBudgetRow,
  type TimeSummary,
  type TimeSummaryBy,
  type TimeSummaryRow,
} from '@hsdg/contracts';
import { DatabaseService } from '../../../database/database.service';
import type { RlsContext } from '../../../database/rls-context';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  beat,
  clockState,
  closeAutoFor,
  closeDayEnd,
  closeIdle,
  DAY_MS,
  dayEndCutoff,
  daysAgo,
  otherTimeWindow,
  settleTasksAfterClose,
  type ClosedEntry,
} from './auto-time';
import { translateTimeError } from './time-tracking.service';

export interface OtherTimeInput {
  category: OtherTimeCategory;
  engagementServiceId?: string | null;
  minutes: number;
  /** YYYY-MM-DD (IST). Today or up to AUTO_TIME.adjustWithinDays back. */
  date: string;
  note?: string | null;
  isBillable?: boolean;
}

export interface AdjustInput {
  startedAt: string;
  endedAt: string;
  reason: string;
}

/**
 * Change 3 — the automatic clock's HTTP side and the time reports: heartbeat,
 * sign-out, other time, self-corrections with lead approval, the Activity → Time
 * summary, and the 5-minute idle / day-end closer the scheduler runs.
 */
@Injectable()
export class TimeAutoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** POST /time/heartbeat — keep the caller's running auto entry alive. */
  async heartbeat(ctx: RlsContext): Promise<HeartbeatResult> {
    if (!ctx.employeeId) return { alive: false, running: null, resumable: null };
    const me = ctx.employeeId;
    return this.db.withRlsContext(ctx, async (client) => {
      const alive = await beat(client, me);
      return { alive, ...(await clockState(client, me)) };
    });
  }

  /** GET /time/clock — what is running, and what can be resumed. */
  async clock(ctx: RlsContext): Promise<ClockState> {
    if (!ctx.employeeId) return { running: null, resumable: null };
    const me = ctx.employeeId;
    return this.db.withRlsContext(ctx, (client) => clockState(client, me));
  }

  /** POST /time/sign-out — close the caller's auto entry (signed_out); its task pauses. */
  async signOut(ctx: RlsContext): Promise<ClockState> {
    if (!ctx.employeeId) return { running: null, resumable: null };
    const me = ctx.employeeId;
    return this.db.withRlsContext(ctx, async (client) => {
      const closed = await closeAutoFor(client, me, TIME_STOP_REASON.signedOut);
      await settleTasksAfterClose(client, closed, TIME_STOP_REASON.signedOut, false);
      return clockState(client, me);
    });
  }

  /** POST /engagements/:id/time/other — a closed block not tied to a task. */
  async addOther(
    ctx: RlsContext,
    engagementId: string,
    input: OtherTimeInput,
  ): Promise<{ id: string }> {
    const me = requireEmployee(ctx);
    const ago = daysAgo(input.date);
    if (ago < 0) throw new BadRequestException('Time cannot be logged for a future date.');
    if (ago > AUTO_TIME.adjustWithinDays) {
      throw new BadRequestException(
        `Other time can be logged for today and the last ${AUTO_TIME.adjustWithinDays} days.`,
      );
    }
    const { startedAt, endedAt } = otherTimeWindow(input.date, input.minutes);
    const billable = input.isBillable ?? !NON_BILLABLE_TIME_CATEGORIES.includes(input.category);
    return this.db.withRlsContext(ctx, async (client) => {
      await this.requireVisible(client, engagementId);
      if (input.engagementServiceId) {
        const ok = await client.query(
          `SELECT 1 FROM hsdg.engagement_services WHERE id = $1 AND engagement_id = $2`,
          [input.engagementServiceId, engagementId],
        );
        if (!ok.rows[0]) throw new BadRequestException('That stream is not on this engagement.');
      }
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.engagement_time_entries
             (engagement_id, employee_id, engagement_service_id, entry_kind, source, category,
              is_billable, started_at, ended_at, duration_seconds, note, stopped_reason)
           VALUES ($1,$2,$3,'other','manual',$4,$5,$6,$7,$8,$9,'manual')
           RETURNING id`,
          [
            engagementId,
            me,
            input.engagementServiceId ?? null,
            input.category,
            billable,
            startedAt.toISOString(),
            endedAt.toISOString(),
            input.minutes * 60,
            input.note?.trim() || null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translateTimeError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'time.other_logged',
        objectType: 'engagement_time_entry',
        objectId: id,
        after: { engagementId, category: input.category, minutes: input.minutes, date: input.date },
      });
      return { id };
    });
  }

  /**
   * POST /time/:entryId/adjust — correct one of your own closed entries within
   * the window. The original is never overwritten: the adjustment is a new row
   * pointing at it. Moves of up to 30 minutes apply at once; larger ones wait
   * for a lead's approval.
   */
  async adjust(
    ctx: RlsContext,
    entryId: string,
    input: AdjustInput,
  ): Promise<TimeAdjustmentRecord> {
    const me = requireEmployee(ctx);
    const start = new Date(input.startedAt);
    const end = new Date(input.endedAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new BadRequestException('The corrected end must be after the corrected start.');
    }
    if (end.getTime() > Date.now() + 60_000) {
      throw new BadRequestException('A corrected entry cannot end in the future.');
    }
    if (end.getTime() - start.getTime() > 16 * 3600_000) {
      throw new BadRequestException('One entry cannot be longer than 16 hours.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        engagement_id: string;
        employee_id: string;
        task_id: string | null;
        engagement_service_id: string | null;
        entry_kind: string;
        category: string | null;
        is_billable: boolean;
        started_at: Date;
        ended_at: Date | null;
        adjusts_entry_id: string | null;
        effective_seconds: number | null;
        has_pending: boolean;
        manager_id: string | null;
        partner_id: string | null;
      }>(
        `SELECT te.id, te.engagement_id, te.employee_id, te.task_id, te.engagement_service_id,
                te.entry_kind, te.category, te.is_billable, te.started_at, te.ended_at,
                te.adjusts_entry_id,
                COALESCE((SELECT a.duration_seconds FROM hsdg.engagement_time_entries a
                           WHERE a.adjusts_entry_id = te.id AND a.adjustment_status = 'approved'
                           ORDER BY a.approved_at DESC, a.id DESC LIMIT 1),
                         te.duration_seconds) AS effective_seconds,
                EXISTS (SELECT 1 FROM hsdg.engagement_time_entries a
                         WHERE a.adjusts_entry_id = te.id AND a.adjustment_status = 'pending') AS has_pending,
                e.engagement_manager_id AS manager_id, e.engagement_partner_id AS partner_id
           FROM hsdg.engagement_time_entries te
           JOIN hsdg.engagements e ON e.id = te.engagement_id
          WHERE te.id = $1
          FOR UPDATE OF te`,
        [entryId],
      );
      const o = rows[0];
      if (!o) throw new NotFoundException('Time entry not found.');
      if (o.employee_id !== me) throw new ForbiddenException('You can only correct your own time.');
      if (o.adjusts_entry_id) {
        throw new BadRequestException('Correct the original entry, not an adjustment.');
      }
      if (!o.ended_at) throw new ConflictException('Stop the running entry before correcting it.');
      if (Date.now() - o.started_at.getTime() > AUTO_TIME.adjustWithinDays * DAY_MS) {
        throw new ForbiddenException(
          `Entries can be corrected for ${AUTO_TIME.adjustWithinDays} days; ask a lead to correct older time.`,
        );
      }
      if (o.has_pending) {
        throw new ConflictException('A correction to this entry is already awaiting approval.');
      }
      // Billed time stays as billed (PS-206 fix): free it from the invoice first.
      const billed = await client.query(
        `SELECT 1 FROM hsdg.time_billings WHERE time_entry_id = $1 AND released_at IS NULL`,
        [o.id],
      );
      if (billed.rows[0]) {
        throw new ConflictException(
          'This time is on an invoice: void it or take the line off the draft before correcting.',
        );
      }
      const seconds = Math.round((end.getTime() - start.getTime()) / 1000);
      const movedMinutes = Math.abs(seconds - (o.effective_seconds ?? 0)) / 60;
      const needsApproval = movedMinutes > AUTO_TIME.adjustApprovalOverMinutes;
      let id: string;
      try {
        const res = await client.query<{ id: string }>(
          `INSERT INTO hsdg.engagement_time_entries
             (engagement_id, employee_id, task_id, engagement_service_id, entry_kind, source,
              category, is_billable, started_at, ended_at, duration_seconds, stopped_reason,
              adjusts_entry_id, adjustment_reason, adjustment_status, approved_at)
           VALUES ($1,$2,$3,$4,$5,'manual',$6,$7,$8,$9,$10,'manual',$11,$12,$13,
                   CASE WHEN $13 = 'approved' THEN now() END)
           RETURNING id`,
          [
            o.engagement_id,
            me,
            o.task_id,
            o.engagement_service_id,
            o.entry_kind,
            o.category,
            o.is_billable,
            start.toISOString(),
            end.toISOString(),
            seconds,
            o.id,
            input.reason.trim(),
            needsApproval ? 'pending' : 'approved',
          ],
        );
        id = res.rows[0]!.id;
      } catch (err) {
        throw translateTimeError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'time.adjusted',
        objectType: 'engagement_time_entry',
        objectId: o.id,
        before: { startedAt: o.started_at.toISOString(), endedAt: o.ended_at.toISOString() },
        after: { adjustmentId: id, startedAt: start.toISOString(), endedAt: end.toISOString() },
        reason: input.reason.trim(),
      });
      if (needsApproval) {
        const approver = [o.manager_id, o.partner_id].find((x) => x && x !== me) ?? null;
        await this.notifications.emitWith(client, ctx, {
          type: NOTIFICATION_TYPE.timeAdjustmentPending,
          recipientEmployeeIds: [approver],
          title: `Time correction to approve (${Math.round(movedMinutes)} min)`,
          body: input.reason.trim(),
          engagementId: o.engagement_id,
          objectType: 'engagement_time_entry',
          objectId: id,
        });
      }
      return (await this.loadAdjustments(client, `a.id = $1`, [id]))[0]!;
    });
  }

  /** POST /time/adjustments/:id/approve — a lead approves or rejects a correction. */
  async decide(
    ctx: RlsContext,
    adjustmentId: string,
    approve: boolean,
  ): Promise<TimeAdjustmentRecord> {
    const me = requireEmployee(ctx);
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        engagement_id: string;
        employee_id: string;
        adjustment_status: string | null;
        is_lead: boolean;
      }>(
        `SELECT te.engagement_id, te.employee_id, te.adjustment_status,
                hsdg.is_engagement_lead(te.engagement_id) AS is_lead
           FROM hsdg.engagement_time_entries te
          WHERE te.id = $1 AND te.adjusts_entry_id IS NOT NULL
          FOR UPDATE`,
        [adjustmentId],
      );
      const a = rows[0];
      if (!a) throw new NotFoundException('Time correction not found.');
      if (!a.is_lead)
        throw new ForbiddenException('Only an engagement lead approves time corrections.');
      if (a.employee_id === me) {
        throw new ForbiddenException('A correction to your own time needs another lead.');
      }
      if (a.adjustment_status !== 'pending') {
        throw new ConflictException('This correction has already been decided.');
      }
      await client.query(
        `UPDATE hsdg.engagement_time_entries
            SET adjustment_status = $2, approved_by_employee_id = $3,
                approved_at = CASE WHEN $2 = 'approved' THEN now() END, version = version + 1
          WHERE id = $1`,
        [adjustmentId, approve ? 'approved' : 'rejected', me],
      );
      await this.audit.recordWith(client, ctx, {
        action: approve ? 'time.adjustment_approved' : 'time.adjustment_rejected',
        objectType: 'engagement_time_entry',
        objectId: adjustmentId,
        after: { status: approve ? 'approved' : 'rejected' },
      });
      return (await this.loadAdjustments(client, `a.id = $1`, [adjustmentId]))[0]!;
    });
  }

  /** Pending corrections on an engagement (the lead's approval list). */
  async pendingAdjustments(ctx: RlsContext, engagementId: string): Promise<TimeAdjustmentRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.requireVisible(client, engagementId);
      return this.loadAdjustments(
        client,
        `a.engagement_id = $1 AND a.adjustment_status = 'pending'`,
        [engagementId],
      );
    });
  }

  /** GET /engagements/:id/time/summary?by= — Activity → Time. */
  async summary(
    ctx: RlsContext,
    engagementId: string,
    by: TimeSummaryBy,
    range: { from?: string; to?: string; stream?: string } = {},
  ): Promise<TimeSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.requireVisible(client, engagementId);
      const group = SUMMARY_GROUP[by];
      const { rows } = await client.query<{
        key: string | null;
        label: string | null;
        total: string;
        billable: string;
        n: string;
      }>(
        `SELECT ${group.key} AS key, ${group.label} AS label,
                COALESCE(SUM(te.duration_seconds), 0)::text AS total,
                COALESCE(SUM(te.duration_seconds) FILTER (WHERE te.is_billable), 0)::text AS billable,
                count(*)::text AS n
           FROM hsdg.effective_time_entries te
           LEFT JOIN hsdg.employees emp ON emp.id = te.employee_id
           LEFT JOIN hsdg.engagement_services es ON es.id = te.engagement_service_id
           LEFT JOIN hsdg.services sv ON sv.id = es.service_id
           LEFT JOIN hsdg.tasks t ON t.id = te.task_id
          WHERE te.engagement_id = $1 AND te.ended_at IS NOT NULL
            AND ($2::date IS NULL OR (te.started_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date)
            AND ($3::date IS NULL OR (te.started_at AT TIME ZONE 'Asia/Kolkata')::date <= $3::date)
            AND ($4::text IS NULL OR sv.stream = $4)
          GROUP BY 1, 2
          ORDER BY ${by === 'month' ? '1 DESC' : '3 DESC'}`,
        [engagementId, range.from ?? null, range.to ?? null, range.stream ?? null],
      );
      const out: TimeSummaryRow[] = rows.map((r) => {
        const total = Number(r.total);
        const billable = Number(r.billable);
        return {
          key: r.key ?? 'none',
          label: r.label ?? group.none,
          totalSeconds: total,
          billableSeconds: billable,
          nonBillableSeconds: total - billable,
          entryCount: Number(r.n),
        };
      });
      const budget = await client.query<{
        financial_year: string;
        stream: string;
        budget_hours: string | null;
        actual_seconds: string;
      }>(
        `WITH actual AS (
           SELECT ${FY_SQL} AS fy, sv.stream, SUM(te.duration_seconds) AS secs
             FROM hsdg.effective_time_entries te
             JOIN hsdg.engagement_services es ON es.id = te.engagement_service_id
             JOIN hsdg.services sv ON sv.id = es.service_id
            WHERE te.engagement_id = $1 AND te.ended_at IS NOT NULL AND sv.stream IS NOT NULL
            GROUP BY 1, 2
         ), budget AS (
           SELECT y.financial_year AS fy, b.key AS stream, b.value AS hours
             FROM hsdg.compliance_engagement_years y,
                  LATERAL jsonb_each_text(COALESCE(y.budget_hours, '{}'::jsonb)) b
            WHERE y.engagement_id = $1
         )
         SELECT COALESCE(a.fy, b.fy) AS financial_year, COALESCE(a.stream, b.stream) AS stream,
                b.hours AS budget_hours, COALESCE(a.secs, 0)::text AS actual_seconds
           FROM actual a FULL JOIN budget b ON b.fy = a.fy AND b.stream = a.stream
          ORDER BY 1 DESC, 2`,
        [engagementId],
      );
      const pending = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM hsdg.engagement_time_entries
          WHERE engagement_id = $1 AND adjustment_status = 'pending'`,
        [engagementId],
      );
      const totalSeconds = out.reduce((s, r) => s + r.totalSeconds, 0);
      const billableSeconds = out.reduce((s, r) => s + r.billableSeconds, 0);
      return {
        by,
        rows: out,
        totals: {
          totalSeconds,
          billableSeconds,
          nonBillableSeconds: totalSeconds - billableSeconds,
        },
        budget: budget.rows.map((b): TimeBudgetRow => ({
          financialYear: b.financial_year,
          stream: b.stream,
          budgetHours: b.budget_hours === null ? null : Number(b.budget_hours),
          actualHours: Math.round((Number(b.actual_seconds) / 3600) * 100) / 100,
        })),
        pendingAdjustments: Number(pending.rows[0]?.n ?? 0),
      };
    });
  }

  /**
   * The 5-minute closer (scheduler, operator context): idle entries end at their
   * last heartbeat; after the office day-end, entries started before it end at
   * the cut-off. Both pause the task.
   */
  async closeStale(
    ctx: RlsContext,
    now: Date = new Date(),
    dayEndHourIst: number = AUTO_TIME.defaultDayEndHourIst,
  ): Promise<{ idle: number; dayEnd: number }> {
    return this.db.withRlsContext(ctx, async (client) => {
      const idle: ClosedEntry[] = await closeIdle(client);
      const cutoff = dayEndCutoff(now, dayEndHourIst);
      const dayEnd = cutoff ? await closeDayEnd(client, cutoff) : [];
      return { idle: idle.length, dayEnd: dayEnd.length };
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async requireVisible(client: PoolClient, engagementId: string): Promise<void> {
    const r = await client.query(`SELECT 1 FROM hsdg.engagements WHERE id = $1`, [engagementId]);
    if (r.rowCount === 0) throw new NotFoundException('Engagement not found.');
  }

  private async loadAdjustments(
    client: PoolClient,
    where: string,
    params: unknown[],
  ): Promise<TimeAdjustmentRecord[]> {
    const { rows } = await client.query<{
      id: string;
      adjusts_entry_id: string;
      employee_id: string;
      employee_name: string;
      o_started: Date;
      o_ended: Date | null;
      o_seconds: number | null;
      started_at: Date;
      ended_at: Date;
      duration_seconds: number;
      adjustment_reason: string;
      adjustment_status: 'pending' | 'approved' | 'rejected';
      approved_by_name: string | null;
      approved_at: Date | null;
      created_at: Date;
    }>(
      `SELECT a.id, a.adjusts_entry_id, a.employee_id,
              COALESCE(emp.full_name, 'Team member') AS employee_name,
              o.started_at AS o_started, o.ended_at AS o_ended, o.duration_seconds AS o_seconds,
              a.started_at, a.ended_at, a.duration_seconds, a.adjustment_reason, a.adjustment_status,
              ap.full_name AS approved_by_name, a.approved_at, a.created_at
         FROM hsdg.engagement_time_entries a
         JOIN hsdg.engagement_time_entries o ON o.id = a.adjusts_entry_id
         LEFT JOIN hsdg.employees emp ON emp.id = a.employee_id
         LEFT JOIN hsdg.employees ap ON ap.id = a.approved_by_employee_id
        WHERE ${where}
        ORDER BY a.created_at DESC`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      adjustsEntryId: r.adjusts_entry_id,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      originalStartedAt: r.o_started.toISOString(),
      originalEndedAt: r.o_ended ? r.o_ended.toISOString() : null,
      originalSeconds: r.o_seconds,
      startedAt: r.started_at.toISOString(),
      endedAt: r.ended_at.toISOString(),
      durationSeconds: r.duration_seconds,
      reason: r.adjustment_reason,
      status: r.adjustment_status,
      approvedByName: r.approved_by_name,
      approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
      createdAt: r.created_at.toISOString(),
    }));
  }
}

function requireEmployee(ctx: RlsContext): string {
  if (!ctx.employeeId) {
    throw new BadRequestException(
      'Your account is not linked to an employee record, so you cannot log time.',
    );
  }
  return ctx.employeeId;
}

/** Indian financial year ('2026-27') of an entry's start, in IST. */
const FY_SQL = `(
  (EXTRACT(YEAR FROM te.started_at AT TIME ZONE 'Asia/Kolkata')::int
     - CASE WHEN EXTRACT(MONTH FROM te.started_at AT TIME ZONE 'Asia/Kolkata') < 4 THEN 1 ELSE 0 END)::text
  || '-' ||
  lpad(((EXTRACT(YEAR FROM te.started_at AT TIME ZONE 'Asia/Kolkata')::int + 1
     - CASE WHEN EXTRACT(MONTH FROM te.started_at AT TIME ZONE 'Asia/Kolkata') < 4 THEN 1 ELSE 0 END) % 100)::text, 2, '0'))`;

const SUMMARY_GROUP: Record<TimeSummaryBy, { key: string; label: string; none: string }> = {
  person: {
    key: 'te.employee_id::text',
    label: `COALESCE(emp.full_name, 'Team member')`,
    none: 'Team member',
  },
  stream: { key: 'sv.stream', label: 'sv.stream', none: 'No stream' },
  month: {
    key: `to_char(te.started_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')`,
    label: `to_char(te.started_at AT TIME ZONE 'Asia/Kolkata', 'Mon YYYY')`,
    none: '—',
  },
  task: {
    key: `COALESCE(te.task_id::text, 'other:' || COALESCE(te.category, te.entry_kind))`,
    label: `COALESCE(t.title, initcap(replace(COALESCE(te.category, 'Untracked'), '_', ' ')))`,
    none: 'Other time',
  },
};
