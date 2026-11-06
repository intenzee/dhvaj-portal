import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  LEAVE_TYPES,
  LEAVE_TYPE_LABEL,
  NOTIFICATION_TYPE,
  daysBetween,
  leaveDayCount,
  type AddHolidayInput,
  type ApplyLeaveInput,
  type AttendanceSettings,
  type DecideLeaveInput,
  type Holiday,
  type LeaveApprovals,
  type LeaveBalance,
  type LeaveHalf,
  type LeaveRequest,
  type LeaveStatus,
  type LeaveType,
  type MyLeave,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { translatePgError } from '../../common/errors/pg-error.util';
import { notLinkedToEmployee } from '../../common/errors/staff-link.messages';
import { AttendanceService, requireDay, requirePeopleReader } from './attendance.service';
import { istDay } from './attendance-days';

/** How far back leave can be asked for (a sick day told after the fact). */
const LEAVE_BACK_DAYS = 30;

interface LeaveDbRow {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string | null;
  leave_type: LeaveType;
  from_day: string;
  to_day: string;
  half: LeaveHalf | null;
  days: string;
  reason: string;
  status: LeaveStatus;
  approver_employee_id: string | null;
  approver_name: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  created_at: Date;
  can_decide: boolean;
}

const LEAVE_SELECT = `
  SELECT lr.id, lr.employee_id, e.full_name AS employee_name, e.employee_code, lr.leave_type,
         lr.from_day::text, lr.to_day::text, lr.half, lr.days::text, lr.reason, lr.status,
         lr.approver_employee_id, ap.full_name AS approver_name, db.full_name AS decided_by_name,
         lr.decided_at, lr.decision_note, lr.created_at,
         (lr.status = 'pending' AND lr.employee_id <> hsdg.ctx_employee_id()
          AND (lr.approver_employee_id = hsdg.ctx_employee_id() OR hsdg.ctx_reads_people())) AS can_decide
    FROM hsdg.leave_requests lr
    JOIN hsdg.employees e ON e.id = lr.employee_id
    LEFT JOIN hsdg.employees ap ON ap.id = lr.approver_employee_id
    LEFT JOIN hsdg.employees db ON db.id = lr.decided_by_employee_id`;

function leaveOf(r: LeaveDbRow): LeaveRequest {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeCode: r.employee_code,
    type: r.leave_type,
    fromDay: r.from_day,
    toDay: r.to_day,
    half: r.half,
    days: Number(r.days),
    reason: r.reason,
    status: r.status,
    approverName: r.approver_name,
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at?.toISOString() ?? null,
    decisionNote: r.decision_note,
    createdAt: r.created_at.toISOString(),
    canDecide: r.can_decide,
  };
}

function me(ctx: RlsContext): string {
  if (!ctx.employeeId) throw new ForbiddenException(notLinkedToEmployee('ask for leave'));
  return ctx.employeeId;
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** "12 Nov" or "12–14 Nov 2026": how a request reads in a notification. */
export function leaveSpan(from: string, to: string, half: LeaveHalf | null): string {
  const f = (d: string, year: boolean) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      ...(year ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    });
  if (from === to)
    return `${f(from, true)}${half ? ` (${half === 'first_half' ? 'first' : 'second'} half)` : ''}`;
  return `${f(from, false)} – ${f(to, true)}`;
}

/** The days of `a` and `b` meet (two halves of one day do not). Pure — tested. */
export function leavesClash(
  a: { from: string; to: string; half: LeaveHalf | null },
  b: { from: string; to: string; half: LeaveHalf | null },
): boolean {
  if (a.from > b.to || b.from > a.to) return false;
  return !(a.half && b.half && a.half !== b.half);
}

/**
 * Leave: asking, approving, the year's balance; the firm's holidays and the
 * attendance settings. The reporting manager approves; with none (or for the
 * firm's leaders) HR and the Managing Partner do.
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly attendance: AttendanceService,
  ) {}

  private async approverOf(
    client: PoolClient,
    employeeId: string,
  ): Promise<{ id: string; name: string } | null> {
    const { rows } = await client.query<{ id: string; full_name: string }>(
      `SELECT m.id, m.full_name FROM hsdg.employees e
         JOIN hsdg.employees m ON m.id = e.reports_to_id
        WHERE e.id = $1 AND m.id <> e.id AND m.employment_status <> 'exited' AND m.deleted_at IS NULL`,
      [employeeId],
    );
    return rows[0] ? { id: rows[0].id, name: rows[0].full_name } : null;
  }

  /** HR and the Managing Partner, who decide leave nobody else approves. */
  private async deciders(client: PoolClient, except: string): Promise<string[]> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.quick_task_people()
        WHERE role_slug IN ('hr', 'managing_partner') AND can_receive AND id <> $1`,
      [except],
    );
    return rows.map((r) => r.id);
  }

  private async balancesWith(
    client: PoolClient,
    employeeId: string,
    year: number,
    settings: AttendanceSettings,
  ): Promise<LeaveBalance[]> {
    const { rows } = await client.query<{
      leave_type: LeaveType;
      status: LeaveStatus;
      days: string;
    }>(
      `SELECT leave_type, status, sum(days)::text AS days FROM hsdg.leave_requests
        WHERE employee_id = $1 AND status IN ('pending', 'approved')
          AND extract(year FROM from_day) = $2
        GROUP BY leave_type, status`,
      [employeeId, year],
    );
    return LEAVE_TYPES.map((type) => {
      const taken = Number(
        rows.find((r) => r.leave_type === type && r.status === 'approved')?.days ?? 0,
      );
      const pending = Number(
        rows.find((r) => r.leave_type === type && r.status === 'pending')?.days ?? 0,
      );
      const allowance = settings.allowances[type];
      return {
        type,
        allowance,
        taken,
        pending,
        left: allowance === null ? null : Math.max(0, allowance - taken - pending),
      };
    });
  }

  async myLeave(ctx: RlsContext, year?: number): Promise<MyLeave> {
    const emp = me(ctx);
    const y = year ?? Number(istDay().slice(0, 4));
    return this.db.withRlsContext(ctx, async (client) => {
      const settings = await this.attendance.settingsWith(client);
      const balances = await this.balancesWith(client, emp, y, settings);
      const requests = await client.query<LeaveDbRow>(
        `${LEAVE_SELECT}
            WHERE lr.employee_id = $1
              AND (extract(year FROM lr.from_day) = $2 OR lr.status = 'pending')
            ORDER BY lr.from_day DESC, lr.created_at DESC`,
        [emp, y],
      );
      const approver = await this.approverOf(client, emp);
      return {
        year: y,
        balances,
        requests: requests.rows.map(leaveOf),
        approverName: approver?.name ?? null,
      };
    });
  }

  async apply(ctx: RlsContext, input: ApplyLeaveInput): Promise<LeaveRequest> {
    const emp = me(ctx);
    requireDay(input.fromDay);
    requireDay(input.toDay);
    const half = input.half ?? null;
    if (input.toDay < input.fromDay)
      throw new BadRequestException('The leave ends before it starts.');
    if (half && input.fromDay !== input.toDay) {
      throw new BadRequestException('A half day is one day: give the same day for from and to.');
    }
    const today = istDay();
    if (input.fromDay < addDays(today, -LEAVE_BACK_DAYS)) {
      throw new BadRequestException(`Leave can be asked for up to ${LEAVE_BACK_DAYS} days back.`);
    }
    if (input.toDay > addDays(today, 366)) {
      throw new BadRequestException('Leave can be asked for up to a year ahead.');
    }
    if (daysBetween(input.fromDay, input.toDay).length > 62) {
      throw new BadRequestException('Ask for at most two months at a time.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const settings = await this.attendance.settingsWith(client);
      const holidays = await this.attendance.holidaysWith(client, input.fromDay, input.toDay);
      const days = leaveDayCount(
        input.fromDay,
        input.toDay,
        half,
        new Set(holidays.map((h) => h.day)),
      );
      if (days <= 0) {
        throw new BadRequestException('Those days are Sundays or the firm’s holidays already.');
      }
      const clash = await client.query<{
        from_day: string;
        to_day: string;
        half: LeaveHalf | null;
      }>(
        `SELECT from_day::text, to_day::text, half FROM hsdg.leave_requests
          WHERE employee_id = $1 AND status IN ('pending', 'approved')
            AND from_day <= $3::date AND to_day >= $2::date`,
        [emp, input.fromDay, input.toDay],
      );
      const mine = { from: input.fromDay, to: input.toDay, half };
      const hit = clash.rows.find((r) =>
        leavesClash(mine, { from: r.from_day, to: r.to_day, half: r.half }),
      );
      if (hit) {
        throw new ConflictException(
          `You have leave on ${leaveSpan(hit.from_day, hit.to_day, hit.half)} already. Withdraw it first to change it.`,
        );
      }
      const year = Number(input.fromDay.slice(0, 4));
      const balance = (await this.balancesWith(client, emp, year, settings)).find(
        (b) => b.type === input.type,
      )!;
      if (balance.left !== null && days > balance.left) {
        throw new BadRequestException(
          `${LEAVE_TYPE_LABEL[input.type]}: ${balance.left} day${balance.left === 1 ? '' : 's'} left in ${year} ` +
            `(of ${balance.allowance}); this asks for ${days}. Unpaid leave has no limit.`,
        );
      }
      const approver = await this.approverOf(client, emp);
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.leave_requests
             (employee_id, leave_type, from_day, to_day, half, days, reason, approver_employee_id)
           VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $8) RETURNING id`,
          [
            emp,
            input.type,
            input.fromDay,
            input.toDay,
            half,
            days,
            input.reason.trim(),
            approver?.id ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translatePgError(err, { check: 'That is not a valid leave request.' });
      }
      const created = await this.getWith(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'leave.requested',
        objectType: 'leave_request',
        objectId: id,
        after: { type: input.type, fromDay: input.fromDay, toDay: input.toDay, half, days },
      });
      const recipients = approver ? [approver.id] : await this.deciders(client, emp);
      await this.notifications.emitWith(client, ctx, {
        type: NOTIFICATION_TYPE.leaveRequested,
        recipientEmployeeIds: recipients,
        title: `${created.employeeName} asks for ${LEAVE_TYPE_LABEL[input.type].toLowerCase()}`,
        body: `${leaveSpan(input.fromDay, input.toDay, half)} · ${days} day${days === 1 ? '' : 's'} — ${input.reason.trim()}`,
        objectType: 'leave_request_approval',
        objectId: id,
        dedupKey: `leave_requested:${id}`,
        link: null,
      });
      return created;
    });
  }

  private async getWith(client: PoolClient, id: string): Promise<LeaveRequest> {
    const { rows } = await client.query<LeaveDbRow>(`${LEAVE_SELECT} WHERE lr.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('That leave request was not found.');
    return leaveOf(rows[0]);
  }

  /** Withdraw your request: while it waits, or before approved leave starts. */
  async cancel(ctx: RlsContext, id: string): Promise<LeaveRequest> {
    const emp = me(ctx);
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        status: LeaveStatus;
        from_day: string;
        approver_employee_id: string | null;
      }>(
        `SELECT status, from_day::text, approver_employee_id FROM hsdg.leave_requests
          WHERE id = $1 AND employee_id = $2 FOR UPDATE`,
        [id, emp],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('That leave request was not found.');
      if (r.status !== 'pending' && !(r.status === 'approved' && r.from_day > istDay())) {
        throw new BadRequestException(
          r.status === 'approved'
            ? 'This leave has started; ask HR to change it.'
            : 'This request is closed already.',
        );
      }
      await client.query(`UPDATE hsdg.leave_requests SET status = 'cancelled' WHERE id = $1`, [id]);
      await this.audit.recordWith(client, ctx, {
        action: 'leave.cancelled',
        objectType: 'leave_request',
        objectId: id,
        before: { status: r.status },
        after: { status: 'cancelled' },
      });
      return this.getWith(client, id);
    });
  }

  async approvals(ctx: RlsContext): Promise<LeaveApprovals> {
    me(ctx);
    return this.db.withRlsContext(ctx, async (client) => {
      const pending = await client.query<LeaveDbRow>(
        `${LEAVE_SELECT}
            WHERE lr.status = 'pending' AND lr.employee_id <> hsdg.ctx_employee_id()
              AND (lr.approver_employee_id = hsdg.ctx_employee_id()
                   OR hsdg.ctx_reads_people()
                   OR lr.employee_id = ANY (hsdg.ctx_subtree()))
            ORDER BY lr.from_day, lr.created_at`,
      );
      const recent = await client.query<LeaveDbRow>(
        `${LEAVE_SELECT}
            WHERE lr.status IN ('approved', 'rejected') AND lr.employee_id <> hsdg.ctx_employee_id()
              AND lr.decided_at > now() - interval '60 days'
            ORDER BY lr.decided_at DESC
            LIMIT 100`,
      );
      return { pending: pending.rows.map(leaveOf), recent: recent.rows.map(leaveOf) };
    });
  }

  async decide(ctx: RlsContext, id: string, input: DecideLeaveInput): Promise<LeaveRequest> {
    const emp = me(ctx);
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        employee_id: string;
        status: LeaveStatus;
        approver_employee_id: string | null;
        reads_people: boolean;
      }>(
        `SELECT employee_id, status, approver_employee_id, hsdg.ctx_reads_people() AS reads_people
           FROM hsdg.leave_requests WHERE id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('That leave request was not found.');
      if (r.employee_id === emp)
        throw new ForbiddenException('Your own leave is decided by your manager or HR.');
      if (r.approver_employee_id !== emp && !r.reads_people) {
        throw new ForbiddenException(
          'This request is for its approver, HR or the Managing Partner to decide.',
        );
      }
      if (r.status !== 'pending')
        throw new ConflictException('This request was decided or withdrawn already.');
      const status: LeaveStatus = input.approve ? 'approved' : 'rejected';
      // Two deciders at once: the second finds it decided.
      const { rowCount } = await client.query(
        `UPDATE hsdg.leave_requests
            SET status = $2, decided_by_employee_id = $3, decided_at = now(), decision_note = $4
          WHERE id = $1 AND status = 'pending'`,
        [id, status, emp, input.note?.trim() || null],
      );
      if (!rowCount) throw new ConflictException('This request was decided or withdrawn already.');
      const decided = await this.getWith(client, id);
      await this.audit.recordWith(client, ctx, {
        action: input.approve ? 'leave.approved' : 'leave.rejected',
        objectType: 'leave_request',
        objectId: id,
        before: { status: 'pending' },
        after: { status, note: input.note?.trim() || null },
      });
      await this.notifications.emitWith(client, ctx, {
        type: NOTIFICATION_TYPE.leaveDecided,
        recipientEmployeeIds: [r.employee_id],
        title: `Your ${LEAVE_TYPE_LABEL[decided.type].toLowerCase()} is ${status}`,
        body:
          `${leaveSpan(decided.fromDay, decided.toDay, decided.half)}` +
          (decided.decisionNote ? ` — ${decided.decisionNote}` : ''),
        objectType: 'leave_request',
        objectId: id,
        dedupKey: `leave_decided:${id}`,
        link: null,
      });
      return decided;
    });
  }

  /** HR's view of the firm's requests in a month (Register → Leave). */
  async firmLeave(ctx: RlsContext, from: string, to: string): Promise<LeaveRequest[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await requirePeopleReader(client);
      const { rows } = await client.query<LeaveDbRow>(
        `${LEAVE_SELECT}
          WHERE lr.from_day <= $2::date AND lr.to_day >= $1::date
          ORDER BY lr.from_day, e.full_name`,
        [from, to],
      );
      return rows.map(leaveOf);
    });
  }

  // ── Holidays and settings ───────────────────────────────────────────────

  async holidays(ctx: RlsContext, year?: number): Promise<Holiday[]> {
    const y = year ?? Number(istDay().slice(0, 4));
    return this.db.withRlsContext(ctx, (client) =>
      this.attendance.holidaysWith(client, `${y}-01-01`, `${y}-12-31`),
    );
  }

  async addHoliday(ctx: RlsContext, input: AddHolidayInput): Promise<Holiday> {
    requireDay(input.day);
    return this.db.withRlsContext(ctx, async (client) => {
      await requireHolidayKeeper(client);
      let row: Holiday;
      try {
        const { rows } = await client.query<Holiday>(
          `INSERT INTO hsdg.firm_holidays (holiday_on, name, created_by_employee_id)
           VALUES ($1::date, $2, $3) RETURNING id, holiday_on::text AS day, name`,
          [input.day, input.name.trim(), ctx.employeeId ?? null],
        );
        row = rows[0]!;
      } catch (err) {
        throw translatePgError(err, {
          uniqueDefault: 'That day is a holiday already.',
          check: 'Give the holiday a name (up to 80 letters).',
        });
      }
      await this.audit.recordWith(client, ctx, {
        action: 'attendance.holiday_added',
        objectType: 'firm_holiday',
        objectId: row.id,
        after: { day: row.day, name: row.name },
      });
      return row;
    });
  }

  async removeHoliday(ctx: RlsContext, id: string): Promise<void> {
    await this.db.withRlsContext(ctx, async (client) => {
      await requireHolidayKeeper(client);
      const { rows } = await client.query<Holiday>(
        `DELETE FROM hsdg.firm_holidays WHERE id = $1 RETURNING id, holiday_on::text AS day, name`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException('That holiday was not found.');
      await this.audit.recordWith(client, ctx, {
        action: 'attendance.holiday_removed',
        objectType: 'firm_holiday',
        objectId: id,
        before: { day: rows[0].day, name: rows[0].name },
      });
    });
  }

  async settings(ctx: RlsContext): Promise<AttendanceSettings> {
    return this.db.withRlsContext(ctx, (client) => this.attendance.settingsWith(client));
  }

  async updateSettings(ctx: RlsContext, input: AttendanceSettings): Promise<AttendanceSettings> {
    if (input.halfDayMinutes >= input.presentMinutes) {
      throw new BadRequestException('A half day must be shorter than a full day.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      await requirePeopleReader(client);
      const before = await this.attendance.settingsWith(client);
      const allowances: Record<string, number | null> = {};
      for (const t of LEAVE_TYPES) {
        const v = input.allowances[t];
        allowances[t] = v === undefined ? before.allowances[t] : v;
      }
      await client.query(
        `UPDATE hsdg.attendance_settings
            SET present_minutes = $1, half_day_minutes = $2, allowances = $3::jsonb,
                updated_by_employee_id = $4, updated_at = now()`,
        [
          input.presentMinutes,
          input.halfDayMinutes,
          JSON.stringify(allowances),
          ctx.employeeId ?? null,
        ],
      );
      const after = await this.attendance.settingsWith(client);
      await this.audit.recordWith(client, ctx, {
        action: 'attendance.settings_changed',
        objectType: 'attendance_settings',
        objectId: null,
        before,
        after,
      });
      return after;
    });
  }
}

async function requireHolidayKeeper(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{ ok: boolean }>(
    `SELECT hsdg.ctx_reads_people() OR hsdg.ctx_role() = 'admin' AS ok`,
  );
  if (!rows[0]?.ok) {
    throw new ForbiddenException(
      'HR, the Managing Partner or an administrator keeps the holiday list.',
    );
  }
}
