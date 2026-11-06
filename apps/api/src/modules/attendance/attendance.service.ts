import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  ATTENDANCE_DAY_MAX_MINUTES,
  ATTENDANCE_STATUS_CODE,
  DEFAULT_ATTENDANCE_SETTINGS,
  LEAVE_TYPES,
  WORK_LOCATIONS,
  formatWorked,
  monthRange,
  summarise,
  type AttendanceMonth,
  type AttendancePerson,
  type AttendanceRegister,
  type AttendanceSettings,
  type DayEntry,
  type Holiday,
  type LogInternalInput,
  type LogWorkInput,
  type MyDay,
  type OtherTimeCategory,
  type PickEngagement,
  type PickTask,
  type UpdateDayEntryInput,
  type WorkLocation,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { translatePgError as mapPgError } from '../../common/errors/pg-error.util';
import { notLinkedToEmployee } from '../../common/errors/staff-link.messages';
import {
  buildDays,
  csvCell,
  daysBack,
  inEditWindow,
  istDay,
  leaveOn,
  loggedWindow,
  type Employment,
  type HoursRow,
  type LeaveRow,
} from './attendance-days';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function requireDay(day: string): string {
  if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    throw new BadRequestException('Give the day as YYYY-MM-DD.');
  }
  return day;
}

export function requireMonth(month: string): string {
  if (!MONTH.test(month)) throw new BadRequestException('Give the month as YYYY-MM.');
  return month;
}

function me(ctx: RlsContext): string {
  if (!ctx.employeeId) throw new ForbiddenException(notLinkedToEmployee('keep attendance'));
  return ctx.employeeId;
}

interface EntryRow {
  id: string;
  root_id: string;
  source: 'auto' | 'manual';
  entry_kind: 'work' | 'review' | 'other';
  engagement_id: string;
  engagement_code: string;
  client_name: string;
  stream_name: string | null;
  task_id: string | null;
  task_title: string | null;
  category: OtherTimeCategory | null;
  note: string | null;
  seconds: number;
  work_location: WorkLocation | null;
  running: boolean;
  corrected: boolean;
  billed: boolean;
  started_at: Date;
}

interface InternalRow {
  id: string;
  category: OtherTimeCategory;
  minutes: number;
  work_location: WorkLocation;
  note: string | null;
  created_at: Date;
}

interface PersonRow {
  id: string;
  employee_code: string;
  full_name: string;
  office_code: string | null;
  grade_name: string | null;
  date_of_joining: string;
  date_of_exit: string | null;
}

interface SettingsRow {
  present_minutes: number;
  half_day_minutes: number;
  allowances: Record<string, number | null>;
}

const PERSON_SELECT = `
  SELECT e.id, e.employee_code, e.full_name, o.code AS office_code, g.name AS grade_name,
         e.date_of_joining::text, e.date_of_exit::text
    FROM hsdg.employees e
    LEFT JOIN hsdg.offices o ON o.id = e.primary_office_id
    LEFT JOIN hsdg.grades g ON g.id = e.grade_id`;

const ENTRY_SELECT = `
  SELECT te.id, COALESCE(te.adjusts_entry_id, te.id) AS root_id, te.source, te.entry_kind,
         te.engagement_id, eng.engagement_code, ent.legal_name AS client_name,
         sv.name AS stream_name, te.task_id, t.title AS task_title, te.category, te.note,
         COALESCE(te.duration_seconds,
                  GREATEST(0, EXTRACT(EPOCH FROM now() - te.started_at))::integer) AS seconds,
         loc.work_location, (te.ended_at IS NULL) AS running,
         (te.adjusts_entry_id IS NOT NULL) AS corrected,
         EXISTS (SELECT 1 FROM hsdg.time_billings tb
                  WHERE tb.time_entry_id IN (te.id, COALESCE(te.adjusts_entry_id, te.id))
                    AND tb.released_at IS NULL) AS billed,
         te.started_at
    FROM hsdg.effective_time_entries te
    JOIN hsdg.engagement_time_entries loc ON loc.id = COALESCE(te.adjusts_entry_id, te.id)
    JOIN hsdg.engagements eng ON eng.id = te.engagement_id
    JOIN hsdg.entities ent ON ent.id = eng.entity_id
    LEFT JOIN hsdg.engagement_services es ON es.id = te.engagement_service_id
    LEFT JOIN hsdg.services sv ON sv.id = es.service_id
    LEFT JOIN hsdg.tasks t ON t.id = te.task_id`;

export function translateAttendanceError(err: unknown): Error {
  return mapPgError(err, {
    foreignKey: 'This row is billed, or was corrected, and stays as it is.',
    check: 'That is not a valid row.',
    forbidden: 'You cannot log time on that engagement.',
  });
}

/**
 * Attendance from the work people log (see packages/contracts/src/attendance.ts).
 * Client time lives in engagement_time_entries (with its place); firm work in
 * internal_time_entries. Totals come from hsdg.attendance_hours, so a day
 * counts every hour even where the reader cannot see the engagement.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Shared reads ────────────────────────────────────────────────────────

  async settingsWith(client: PoolClient): Promise<AttendanceSettings> {
    const { rows } = await client.query<SettingsRow>(
      `SELECT present_minutes, half_day_minutes, allowances FROM hsdg.attendance_settings LIMIT 1`,
    );
    const r = rows[0];
    if (!r) return DEFAULT_ATTENDANCE_SETTINGS;
    const allowances = { ...DEFAULT_ATTENDANCE_SETTINGS.allowances };
    for (const t of LEAVE_TYPES) {
      if (t in r.allowances) allowances[t] = r.allowances[t] ?? null;
    }
    return {
      presentMinutes: r.present_minutes,
      halfDayMinutes: r.half_day_minutes,
      allowances,
    };
  }

  async holidaysWith(client: PoolClient, from: string, to: string): Promise<Holiday[]> {
    const { rows } = await client.query<{ id: string; day: string; name: string }>(
      `SELECT id, holiday_on::text AS day, name FROM hsdg.firm_holidays
        WHERE holiday_on BETWEEN $1::date AND $2::date ORDER BY holiday_on`,
      [from, to],
    );
    return rows;
  }

  private async hoursWith(
    client: PoolClient,
    from: string,
    to: string,
    employees: string[],
  ): Promise<HoursRow[]> {
    if (employees.length === 0) return [];
    const { rows } = await client.query<HoursRow>(
      `SELECT employee_id, day::text, work_location, seconds::bigint AS seconds
         FROM hsdg.attendance_hours($1::date, $2::date, $3::uuid[])`,
      [from, to, employees],
    );
    return rows.map((r) => ({ ...r, seconds: Number(r.seconds) }));
  }

  private async leavesWith(
    client: PoolClient,
    from: string,
    to: string,
    employees: string[],
  ): Promise<LeaveRow[]> {
    if (employees.length === 0) return [];
    const { rows } = await client.query<LeaveRow>(
      `SELECT id, employee_id, leave_type, from_day::text, to_day::text, half, status
         FROM hsdg.leave_requests
        WHERE employee_id = ANY ($1::uuid[]) AND status IN ('pending', 'approved')
          AND from_day <= $3::date AND to_day >= $2::date`,
      [employees, from, to],
    );
    return rows;
  }

  private async peopleWith(
    client: PoolClient,
    where: string,
    params: unknown[],
  ): Promise<PersonRow[]> {
    const { rows } = await client.query<PersonRow>(
      `${PERSON_SELECT} WHERE ${where} ORDER BY e.full_name`,
      params,
    );
    return rows;
  }

  /** The month of each person, with its summary. */
  private async monthsOf(
    client: PoolClient,
    people: PersonRow[],
    month: string,
    settings: AttendanceSettings,
  ): Promise<{ people: AttendancePerson[]; holidays: Holiday[] }> {
    const { from, to } = monthRange(month);
    const ids = people.map((p) => p.id);
    const hours = await this.hoursWith(client, from, to, ids);
    const leaves = await this.leavesWith(client, from, to, ids);
    const holidays = await this.holidaysWith(client, from, to);
    const holidayMap = new Map(holidays.map((h) => [h.day, h.name]));
    const today = istDay();
    return {
      holidays,
      people: people.map((p) => {
        const days = buildDays({
          from,
          to,
          today,
          hours: hours.filter((h) => h.employee_id === p.id),
          leaves: leaves.filter((l) => l.employee_id === p.id),
          holidays: holidayMap,
          employment: { joined: p.date_of_joining, exited: p.date_of_exit },
          presentMinutes: settings.presentMinutes,
          halfDayMinutes: settings.halfDayMinutes,
        });
        return {
          employeeId: p.id,
          employeeCode: p.employee_code,
          employeeName: p.full_name,
          officeCode: p.office_code,
          gradeName: p.grade_name,
          days,
          summary: summarise(days),
        };
      }),
    };
  }

  // ── A day ───────────────────────────────────────────────────────────────

  async myDay(ctx: RlsContext, day: string): Promise<MyDay> {
    const emp = me(ctx);
    requireDay(day);
    return this.db.withRlsContext(ctx, (client) => this.dayWith(client, emp, day, true));
  }

  /** One of your team's days: read-only, client time you cannot see summed. */
  async personDay(ctx: RlsContext, employeeId: string, day: string): Promise<MyDay> {
    const emp = me(ctx);
    requireDay(day);
    return this.db.withRlsContext(ctx, async (client) => {
      if (employeeId !== emp) {
        const { rows } = await client.query<{ ok: boolean }>(
          `SELECT $1::uuid = ANY (hsdg.ctx_subtree()) AS ok`,
          [employeeId],
        );
        if (!rows[0]?.ok) throw new NotFoundException('That person is not in your team.');
      }
      return this.dayWith(client, employeeId, day, employeeId === emp);
    });
  }

  private async dayWith(
    client: PoolClient,
    employeeId: string,
    day: string,
    own: boolean,
  ): Promise<MyDay> {
    const people = await this.peopleWith(client, 'e.id = $1', [employeeId]);
    const person = people[0];
    if (!person) throw new NotFoundException('That person was not found.');
    const settings = await this.settingsWith(client);
    const entries = await client.query<EntryRow>(
      `${ENTRY_SELECT}
          WHERE te.employee_id = $1 AND (te.started_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date
          ORDER BY te.started_at`,
      [employeeId, day],
    );
    const internal = await client.query<InternalRow>(
      `SELECT id, category, minutes, work_location, note, created_at
           FROM hsdg.internal_time_entries WHERE employee_id = $1 AND work_day = $2::date
          ORDER BY created_at`,
      [employeeId, day],
    );
    const hours = await this.hoursWith(client, day, day, [employeeId]);
    const leaves = await this.leavesWith(client, day, day, [employeeId]);
    const holidays = await this.holidaysWith(client, day, day);
    const window = own && inEditWindow(day);
    const [base] = buildDays({
      from: day,
      to: day,
      today: istDay(),
      hours,
      leaves,
      holidays: new Map(holidays.map((h) => [h.day, h.name])),
      employment: { joined: person.date_of_joining, exited: person.date_of_exit },
      presentMinutes: settings.presentMinutes,
      halfDayMinutes: settings.halfDayMinutes,
    });
    const rows: DayEntry[] = [
      ...entries.rows.map((r) => entryOf(r, window)),
      ...internal.rows.map((r): DayEntry => ({
        id: r.id,
        source: 'internal',
        engagementId: null,
        engagementCode: null,
        clientName: null,
        streamName: null,
        taskId: null,
        taskTitle: null,
        category: r.category,
        note: r.note,
        seconds: r.minutes * 60,
        location: r.work_location,
        running: false,
        editable: window,
        locationOnly: false,
        billed: false,
        startedAt: r.created_at.toISOString(),
      })),
    ];
    const shown = rows.reduce((s, r) => s + r.seconds, 0);
    const hidden = Math.max(0, base!.workedSeconds - shown);
    return {
      ...base!,
      presentSeconds: settings.presentMinutes * 60,
      halfDaySeconds: settings.halfDayMinutes * 60,
      editable: window,
      entries: rows,
      pendingLeave: leaveOn(day, leaves, 'pending'),
      ...(own ? {} : { employeeName: person.full_name }),
      // A minute's rounding is not "hidden" time.
      ...(hidden >= 60 ? { hiddenSeconds: hidden } : {}),
    };
  }

  private async requireRoom(
    client: PoolClient,
    employeeId: string,
    day: string,
    adding: number,
  ): Promise<void> {
    const hours = await this.hoursWith(client, day, day, [employeeId]);
    const total = hours.reduce((s, h) => s + h.seconds, 0);
    if (total + adding * 60 > ATTENDANCE_DAY_MAX_MINUTES * 60) {
      throw new BadRequestException(
        `A day holds at most ${ATTENDANCE_DAY_MAX_MINUTES / 60} hours; ${formatWorked(total)} is logged already.`,
      );
    }
  }

  private requireWindow(day: string): void {
    const back = daysBack(day);
    if (back < 0) throw new BadRequestException('Work cannot be logged for a day still to come.');
    if (!inEditWindow(day)) {
      throw new BadRequestException(
        'Work can be logged for today and the last 3 days. For an older day, ask your manager to correct it.',
      );
    }
  }

  async logWork(ctx: RlsContext, day: string, input: LogWorkInput): Promise<MyDay> {
    const emp = me(ctx);
    requireDay(day);
    this.requireWindow(day);
    return this.db.withRlsContext(ctx, async (client) => {
      const eng = await client.query<{ status: string }>(
        `SELECT status FROM hsdg.engagements WHERE id = $1`,
        [input.engagementId],
      );
      if (!eng.rows[0]) throw new NotFoundException('That engagement was not found.');
      if (['closed', 'cancelled', 'declined', 'withdrawn', 'merged'].includes(eng.rows[0].status)) {
        throw new BadRequestException('That engagement is closed; time cannot be logged on it.');
      }
      let serviceId = input.engagementServiceId ?? null;
      if (input.taskId) {
        const task = await client.query<{
          engagement_id: string;
          engagement_service_id: string | null;
        }>(`SELECT engagement_id, engagement_service_id FROM hsdg.tasks WHERE id = $1`, [
          input.taskId,
        ]);
        const t = task.rows[0];
        if (!t || t.engagement_id !== input.engagementId) {
          throw new BadRequestException('That task is not on this engagement.');
        }
        serviceId = serviceId ?? t.engagement_service_id;
      }
      if (serviceId) {
        const ok = await client.query(
          `SELECT 1 FROM hsdg.engagement_services WHERE id = $1 AND engagement_id = $2`,
          [serviceId, input.engagementId],
        );
        if (!ok.rows[0]) throw new BadRequestException('That stream is not on this engagement.');
      }
      await this.requireRoom(client, emp, day, input.minutes);
      const { startedAt, endedAt } = loggedWindow(day, input.minutes);
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.engagement_time_entries
             (engagement_id, employee_id, engagement_service_id, task_id, entry_kind, source,
              is_billable, started_at, ended_at, duration_seconds, note, stopped_reason, work_location)
           VALUES ($1, $2, $3, $4, 'work', 'manual', true, $5, $6, $7, $8, 'manual', $9)
           RETURNING id`,
          [
            input.engagementId,
            emp,
            serviceId,
            input.taskId ?? null,
            startedAt.toISOString(),
            endedAt.toISOString(),
            input.minutes * 60,
            input.note?.trim() || null,
            input.location,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translateAttendanceError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'attendance.work_logged',
        objectType: 'engagement_time_entry',
        objectId: id,
        after: {
          day,
          engagementId: input.engagementId,
          taskId: input.taskId ?? null,
          minutes: input.minutes,
          location: input.location,
        },
      });
      return this.dayWith(client, emp, day, true);
    });
  }

  async logInternal(ctx: RlsContext, day: string, input: LogInternalInput): Promise<MyDay> {
    const emp = me(ctx);
    requireDay(day);
    this.requireWindow(day);
    return this.db.withRlsContext(ctx, async (client) => {
      await this.requireRoom(client, emp, day, input.minutes);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.internal_time_entries (employee_id, work_day, minutes, category, work_location, note)
         VALUES ($1, $2::date, $3, $4, $5, $6) RETURNING id`,
        [emp, day, input.minutes, input.category, input.location, input.note?.trim() || null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'attendance.internal_logged',
        objectType: 'internal_time_entry',
        objectId: rows[0]!.id,
        after: { day, category: input.category, minutes: input.minutes, location: input.location },
      });
      return this.dayWith(client, emp, day, true);
    });
  }

  /** "I worked from …": every row of the day nobody placed yet. */
  async setDayLocation(ctx: RlsContext, day: string, location: WorkLocation): Promise<MyDay> {
    const emp = me(ctx);
    requireDay(day);
    this.requireWindow(day);
    return this.db.withRlsContext(ctx, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE hsdg.engagement_time_entries SET work_location = $3
          WHERE employee_id = $1 AND adjusts_entry_id IS NULL AND work_location IS NULL
            AND (started_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date`,
        [emp, day, location],
      );
      if (rowCount) {
        await this.audit.recordWith(client, ctx, {
          action: 'attendance.day_location_set',
          objectType: 'employee',
          objectId: emp,
          after: { day, location, rows: rowCount },
        });
      }
      return this.dayWith(client, emp, day, true);
    });
  }

  async updateEntry(ctx: RlsContext, id: string, input: UpdateDayEntryInput): Promise<MyDay> {
    const emp = me(ctx);
    if (input.location !== undefined && !WORK_LOCATIONS.includes(input.location)) {
      throw new BadRequestException('Choose office, home or the client’s office.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const internal = await client.query<{ work_day: string; minutes: number }>(
        `SELECT work_day::text, minutes FROM hsdg.internal_time_entries
          WHERE id = $1 AND employee_id = $2 FOR UPDATE`,
        [id, emp],
      );
      const own = internal.rows[0];
      if (own) {
        if (!inEditWindow(own.work_day)) throw new BadRequestException(OLD_DAY);
        if (input.minutes !== undefined) {
          await this.requireRoom(client, emp, own.work_day, input.minutes - own.minutes);
        }
        await client.query(
          `UPDATE hsdg.internal_time_entries
              SET minutes = COALESCE($2, minutes), work_location = COALESCE($3, work_location),
                  note = CASE WHEN $4::boolean THEN $5 ELSE note END
            WHERE id = $1`,
          [
            id,
            input.minutes ?? null,
            input.location ?? null,
            input.note !== undefined,
            input.note?.trim() || null,
          ],
        );
        await this.audit.recordWith(client, ctx, {
          action: 'attendance.internal_changed',
          objectType: 'internal_time_entry',
          objectId: id,
          after: { ...input },
        });
        return this.dayWith(client, emp, own.work_day, true);
      }

      const found = await client.query<EntryRow & { day: string }>(
        `${ENTRY_SELECT.replace('SELECT te.id,', `SELECT (te.started_at AT TIME ZONE 'Asia/Kolkata')::date::text AS day, te.id,`)}
          WHERE te.employee_id = $2 AND (te.id = $1 OR te.adjusts_entry_id = $1)`,
        [id, emp],
      );
      const row = found.rows[0];
      if (!row) throw new NotFoundException('That row was not found.');
      if (!inEditWindow(row.day)) throw new BadRequestException(OLD_DAY);
      const entry = entryOf(row, true);
      const changesTime = input.minutes !== undefined || input.note !== undefined;
      if (changesTime && !entry.editable) {
        throw new BadRequestException(
          entry.billed
            ? 'This time is billed already; it stays as it is.'
            : 'A task clock’s time is corrected from the task’s Activity → Time. Here you can say where it was worked.',
        );
      }
      if (input.minutes !== undefined) {
        await this.requireRoom(client, emp, row.day, input.minutes - Math.round(row.seconds / 60));
      }
      try {
        await client.query(
          `UPDATE hsdg.engagement_time_entries
              SET work_location = COALESCE($2, work_location),
                  duration_seconds = COALESCE($3, duration_seconds),
                  ended_at = CASE WHEN $3::integer IS NULL THEN ended_at
                                  ELSE started_at + make_interval(secs => $3::integer) END,
                  note = CASE WHEN $4::boolean THEN $5 ELSE note END,
                  version = version + 1
            WHERE id = $1`,
          [
            row.root_id,
            input.location ?? null,
            input.minutes !== undefined ? input.minutes * 60 : null,
            input.note !== undefined,
            input.note?.trim() || null,
          ],
        );
      } catch (err) {
        throw translateAttendanceError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'attendance.entry_changed',
        objectType: 'engagement_time_entry',
        objectId: row.root_id,
        before: {
          minutes: Math.round(row.seconds / 60),
          location: row.work_location,
          note: row.note,
        },
        after: { ...input },
      });
      return this.dayWith(client, emp, row.day, true);
    });
  }

  async deleteEntry(ctx: RlsContext, id: string): Promise<MyDay> {
    const emp = me(ctx);
    return this.db.withRlsContext(ctx, async (client) => {
      const internal = await client.query<{ work_day: string; minutes: number; category: string }>(
        `SELECT work_day::text, minutes, category FROM hsdg.internal_time_entries
          WHERE id = $1 AND employee_id = $2`,
        [id, emp],
      );
      const own = internal.rows[0];
      if (own) {
        if (!inEditWindow(own.work_day)) throw new BadRequestException(OLD_DAY);
        await client.query(`DELETE FROM hsdg.internal_time_entries WHERE id = $1`, [id]);
        await this.audit.recordWith(client, ctx, {
          action: 'attendance.internal_removed',
          objectType: 'internal_time_entry',
          objectId: id,
          before: { ...own },
        });
        return this.dayWith(client, emp, own.work_day, true);
      }
      const found = await client.query<EntryRow & { day: string }>(
        `${ENTRY_SELECT.replace('SELECT te.id,', `SELECT (te.started_at AT TIME ZONE 'Asia/Kolkata')::date::text AS day, te.id,`)}
          WHERE te.employee_id = $2 AND te.id = $1`,
        [id, emp],
      );
      const row = found.rows[0];
      if (!row) throw new NotFoundException('That row was not found.');
      if (!inEditWindow(row.day)) throw new BadRequestException(OLD_DAY);
      if (!entryOf(row, true).editable) {
        throw new BadRequestException(
          row.billed
            ? 'This time is billed already; it stays as it is.'
            : 'Only rows logged by hand can be taken out; a task clock’s time is corrected from the task.',
        );
      }
      try {
        const { rowCount } = await client.query(
          `DELETE FROM hsdg.engagement_time_entries WHERE id = $1`,
          [id],
        );
        if (!rowCount) throw new BadRequestException('This row cannot be taken out.');
      } catch (err) {
        throw translateAttendanceError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'attendance.entry_removed',
        objectType: 'engagement_time_entry',
        objectId: id,
        before: {
          day: row.day,
          engagementId: row.engagement_id,
          minutes: Math.round(row.seconds / 60),
          location: row.work_location,
        },
      });
      return this.dayWith(client, emp, row.day, true);
    });
  }

  // ── Picking what to log on ──────────────────────────────────────────────

  async pickEngagements(ctx: RlsContext, q?: string): Promise<PickEngagement[]> {
    const emp = me(ctx);
    const search = q?.trim() ?? '';
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        engagement_code: string;
        client_name: string;
        service_name: string | null;
        period: string | null;
        streams: { id: string; name: string }[] | null;
      }>(
        `SELECT eng.id, eng.engagement_code, ent.legal_name AS client_name,
                s.name AS service_name, COALESCE(eng.period_label, eng.financial_year) AS period,
                (SELECT json_agg(json_build_object('id', es.id, 'name', sv.name) ORDER BY sv.name)
                   FROM hsdg.engagement_services es JOIN hsdg.services sv ON sv.id = es.service_id
                  WHERE es.engagement_id = eng.id AND es.status <> 'cancelled') AS streams
           FROM hsdg.engagements eng
           JOIN hsdg.entities ent ON ent.id = eng.entity_id
           LEFT JOIN hsdg.services s ON s.id = eng.service_id
          WHERE eng.status NOT IN ('closed', 'cancelled', 'declined', 'withdrawn', 'merged')
            AND hsdg.is_engagement_member(eng.id)
            AND ($2 = '' OR ent.legal_name ILIKE '%' || $2 || '%'
                 OR eng.engagement_code ILIKE '%' || $2 || '%'
                 OR ent.trade_name ILIKE '%' || $2 || '%')
            AND ($2 <> '' OR eng.engagement_partner_id = $1 OR eng.engagement_manager_id = $1
                 OR EXISTS (SELECT 1 FROM hsdg.engagement_team tm
                             WHERE tm.engagement_id = eng.id AND tm.employee_id = $1)
                 OR EXISTS (SELECT 1 FROM hsdg.engagement_services es
                             WHERE es.engagement_id = eng.id AND es.lead_employee_id = $1)
                 OR EXISTS (SELECT 1 FROM hsdg.tasks t
                             WHERE t.engagement_id = eng.id AND t.assigned_to_employee_id = $1
                               AND t.status NOT IN ('done', 'cancelled')))
          ORDER BY (SELECT max(te.started_at) FROM hsdg.engagement_time_entries te
                     WHERE te.engagement_id = eng.id AND te.employee_id = $1) DESC NULLS LAST,
                   ent.legal_name, eng.engagement_code
          LIMIT 40`,
        [emp, search],
      );
      return rows.map((r) => ({
        engagementId: r.id,
        engagementCode: r.engagement_code,
        clientName: r.client_name,
        title: [r.service_name, r.period].filter(Boolean).join(' · ') || r.engagement_code,
        streams: r.streams ?? [],
      }));
    });
  }

  async pickTasks(ctx: RlsContext, engagementId: string): Promise<PickTask[]> {
    const emp = me(ctx);
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        title: string;
        engagement_service_id: string | null;
        filing: boolean;
        mine: boolean;
      }>(
        `SELECT t.id, t.title, t.engagement_service_id,
                (t.source_compliance_instance_id IS NOT NULL) AS filing,
                (t.assigned_to_employee_id = $2) AS mine
           FROM hsdg.tasks t
          WHERE t.engagement_id = $1 AND t.status NOT IN ('cancelled')
            AND (t.status <> 'done' OR t.updated_at > now() - interval '7 days')
          ORDER BY (t.assigned_to_employee_id = $2) DESC, (t.status = 'done'), t.due_date NULLS LAST, t.title
          LIMIT 100`,
        [engagementId, emp],
      );
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        engagementServiceId: r.engagement_service_id,
        filing: r.filing,
        mine: r.mine,
      }));
    });
  }

  // ── Months ──────────────────────────────────────────────────────────────

  async myMonth(ctx: RlsContext, month: string): Promise<AttendanceMonth> {
    const emp = me(ctx);
    requireMonth(month);
    return this.db.withRlsContext(ctx, async (client) => {
      const settings = await this.settingsWith(client);
      const people = await this.peopleWith(client, 'e.id = $1', [emp]);
      if (!people[0]) throw new NotFoundException('Your employee record was not found.');
      const { people: out } = await this.monthsOf(client, people, month, settings);
      return {
        month,
        person: out[0]!,
        settings: {
          presentMinutes: settings.presentMinutes,
          halfDayMinutes: settings.halfDayMinutes,
        },
      };
    });
  }

  /** Everyone who reports to you, at any depth. */
  async teamMonth(ctx: RlsContext, month: string): Promise<AttendanceRegister> {
    const emp = me(ctx);
    requireMonth(month);
    const { from, to } = monthRange(month);
    return this.db.withRlsContext(ctx, async (client) => {
      const settings = await this.settingsWith(client);
      const people = await this.peopleWith(
        client,
        `e.id = ANY (hsdg.ctx_subtree()) AND e.id <> $1
         AND e.date_of_joining <= $3::date AND (e.date_of_exit IS NULL OR e.date_of_exit >= $2::date)`,
        [emp, from, to],
      );
      const { people: out, holidays } = await this.monthsOf(client, people, month, settings);
      return { month, people: out, holidays };
    });
  }

  /** The firm's month (HR, the Managing Partner): hours and days, no client names. */
  async register(ctx: RlsContext, month: string): Promise<AttendanceRegister> {
    requireMonth(month);
    const { from, to } = monthRange(month);
    return this.db.withRlsContext(ctx, async (client) => {
      await requirePeopleReader(client);
      const settings = await this.settingsWith(client);
      const people = await this.peopleWith(
        client,
        `e.date_of_joining <= $2::date AND (e.date_of_exit IS NULL OR e.date_of_exit >= $1::date)`,
        [from, to],
      );
      const { people: out, holidays } = await this.monthsOf(client, people, month, settings);
      return { month, people: out, holidays };
    });
  }

  async registerCsv(ctx: RlsContext, month: string): Promise<string> {
    const reg = await this.register(ctx, month);
    return registerCsv(reg);
  }
}

const OLD_DAY =
  'Rows can be changed for today and the last 3 days. For an older day, ask your manager to correct it.';

/** HR or the Managing Partner, else 403. */
export async function requirePeopleReader(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{ ok: boolean }>(`SELECT hsdg.ctx_reads_people() AS ok`);
  if (!rows[0]?.ok) {
    throw new ForbiddenException('Only HR and the Managing Partner see the firm’s attendance.');
  }
}

function entryOf(r: EntryRow, window: boolean): DayEntry {
  const logged = r.source === 'manual' && r.entry_kind !== 'review';
  const editable = window && logged && !r.corrected && !r.billed && !r.running;
  return {
    id: r.id,
    source: r.source === 'auto' ? 'task_clock' : 'logged',
    engagementId: r.engagement_id,
    engagementCode: r.engagement_code,
    clientName: r.client_name,
    streamName: r.stream_name,
    taskId: r.task_id,
    taskTitle: r.task_title,
    category: r.category,
    note: r.note,
    seconds: Number(r.seconds),
    location: r.work_location,
    running: r.running,
    editable,
    locationOnly: window && !editable,
    billed: r.billed,
    startedAt: r.started_at.toISOString(),
  };
}

/** The register as a CSV: a row a person, a column a day, then the month's totals. Pure — tested. */
export function registerCsv(reg: AttendanceRegister): string {
  const { from, to } = monthRange(reg.month);
  const days = reg.people[0]?.days.map((d) => d.day) ?? [];
  const head = [
    'Code',
    'Name',
    'Office',
    'Grade',
    ...days.map((d) => d.slice(8)),
    'Present',
    'Half days',
    'Absent',
    ...LEAVE_TYPES.map((t) => `Leave (${t})`),
    'Holidays',
    'Weekly offs',
    'Payable days',
    'Hours',
    'Office hours',
    'Home hours',
    'Client office hours',
  ];
  const hrs = (s: number | undefined): string => ((s ?? 0) / 3600).toFixed(2);
  const lines = [
    `Attendance ${from} to ${to}`,
    head.map(csvCell).join(','),
    ...reg.people.map((p) =>
      [
        p.employeeCode,
        p.employeeName,
        p.officeCode,
        p.gradeName,
        ...p.days.map((d) => ATTENDANCE_STATUS_CODE[d.status]),
        p.summary.present,
        p.summary.halfDays,
        p.summary.absent,
        ...LEAVE_TYPES.map((t) => p.summary.leave[t] ?? 0),
        p.summary.holidays,
        p.summary.weeklyOffs,
        p.summary.payableDays,
        hrs(p.summary.workedSeconds),
        hrs(p.summary.byLocation.office),
        hrs(p.summary.byLocation.home),
        hrs(p.summary.byLocation.client_office),
      ]
        .map(csvCell)
        .join(','),
    ),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

export type { Employment };
