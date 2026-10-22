import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  EMPLOYMENT_STATUS,
  NOTIFICATION_TYPE,
  ONBOARD_ASSIGNABLE_ROLES,
  PEOPLE_DESK_QUEUE,
  ROLE,
  SYSTEM_ROLE,
  WORKLOAD_OVER_SECONDS,
  WORKLOAD_UNDER_SECONDS,
  type AttendanceDay,
  type AttendanceReport,
  type EmployeeHistoryEvent,
  type EmploymentStatus,
  type GradeSlug,
  type MonthlyHoursReport,
  type PeopleDesk,
  type PeopleDeskQueue,
  type PeopleWorkloadReport,
  type PeopleWorkloadRow,
  type StartExitInput,
  type StartExitResult,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { IdentityService } from '../identity/identity.service';
import { withVia, type OnboardCeiling } from '../identity/onboard-ceiling';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganisationService } from '../organisation/organisation.service';
import { istToday } from '../engagements/time/auto-time';
import {
  buildQueues,
  lastWorkingDay,
  monthRange,
  shortDate,
  weekStartOf,
  type DeskEmployee,
  type LoginFlag,
} from './people-desk';

interface AttendanceRow {
  employee_id: string;
  day: string;
  first_start: Date;
  last_stop: Date | null;
  running: boolean;
  total_seconds: number;
  work_seconds: number | null;
  review_seconds: number | null;
  other_seconds: number | null;
  category_seconds: Record<string, number>;
  employee_code: string | null;
  full_name: string | null;
  office_code: string | null;
  grade_name: string | null;
}

const ATTENDANCE_SELECT = `
  SELECT a.*, e.employee_code, e.full_name, o.code AS office_code, g.name AS grade_name
    FROM hsdg.attendance_by_day($1::date, $2::date) a
    LEFT JOIN hsdg.employees e ON e.id = a.employee_id
    LEFT JOIN hsdg.offices o ON o.id = e.primary_office_id
    LEFT JOIN hsdg.grades g ON g.id = e.grade_id`;

/**
 * The HR People desk (spec §4). Reads go through the SECURITY DEFINER
 * functions of migration 1772600000000 — they return figures about people and
 * never a client, engagement or task — joined here to the employee master,
 * which HR reads directly.
 */
@Injectable()
export class PeopleService {
  private readonly logger = new Logger(PeopleService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly org: OrganisationService,
    private readonly identity: IdentityService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Daily attendance, `time.read_attendance` (HR and MP see everyone). */
  async attendance(ctx: RlsContext, from: string, to: string): Promise<AttendanceReport> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await guard(() =>
        client.query<AttendanceRow>(`${ATTENDANCE_SELECT} ORDER BY a.day DESC, e.full_name`, [
          from,
          to,
        ]),
      );
      return { from, to, rows: rows.map(mapAttendance) };
    });
  }

  /** One's own attendance (everyone, decision 6). */
  async myAttendance(ctx: RlsContext, from: string, to: string): Promise<AttendanceReport> {
    if (!ctx.employeeId) return { from, to, rows: [] };
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await guard(() =>
        client.query<AttendanceRow>(
          `${ATTENDANCE_SELECT} WHERE a.employee_id = $3 ORDER BY a.day DESC`,
          [from, to, ctx.employeeId],
        ),
      );
      return { from, to, rows: rows.map(mapAttendance) };
    });
  }

  /** Workload with every engagement as a count (`report.read_people`). */
  async workload(ctx: RlsContext, weekStart?: string): Promise<PeopleWorkloadReport> {
    const start = weekStartOf(weekStart ?? istToday());
    return this.db.withRlsContext(ctx, async (client) => {
      const rows = await this.workloadRows(client, start);
      return {
        weekStart: start,
        rows,
        totals: {
          people: rows.length,
          over: rows.filter((r) => r.weekSeconds > WORKLOAD_OVER_SECONDS).length,
          under: rows.filter((r) => r.weekSeconds < WORKLOAD_UNDER_SECONDS).length,
          withOverdue: rows.filter((r) => r.overdueTasks > 0).length,
          openTasks: rows.reduce((n, r) => n + r.openTasks, 0),
          overdueTasks: rows.reduce((n, r) => n + r.overdueTasks, 0),
        },
      };
    });
  }

  /** The People desk: headline numbers, the "Needs action" queues, headcount. */
  async desk(ctx: RlsContext, now: Date = new Date()): Promise<PeopleDesk> {
    const today = istToday(now);
    const lastDay = lastWorkingDay(today);
    const weekStart = weekStartOf(today);
    return this.db.withRlsContext(ctx, async (client) => {
      const employees = await this.deskEmployees(client);
      // The administrator keeps employee.manage (decision 5) but isn't a
      // people reader: their desk shows the employee-master queues only.
      const wide = readsPeople(ctx);
      const flags = new Map<string, LoginFlag>();
      const logged = new Set<string>();
      let workload: PeopleWorkloadRow[] = [];
      if (wide) {
        const flagRows = await guard(() =>
          client.query<{ user_id: string; must_change: boolean; set_at: Date; locked: boolean }>(
            `SELECT * FROM hsdg.people_login_flags()`,
          ),
        );
        for (const f of flagRows.rows) {
          flags.set(f.user_id, {
            mustChange: f.must_change,
            setAt: f.set_at.toISOString(),
            locked: f.locked,
          });
        }
        const day = await client.query<{ employee_id: string }>(
          `SELECT employee_id FROM hsdg.attendance_by_day($1::date, $1::date)`,
          [lastDay],
        );
        for (const r of day.rows) logged.add(r.employee_id);
        workload = await this.workloadRows(client, weekStart);
      }

      const current = employees.filter((e) => e.employmentStatus !== EMPLOYMENT_STATUS.exited);
      const month = today.slice(0, 7);
      const offices = new Map<string, Map<GradeSlug, number>>();
      for (const e of current) {
        const g = offices.get(e.officeCode) ?? new Map<GradeSlug, number>();
        g.set(e.gradeSlug, (g.get(e.gradeSlug) ?? 0) + 1);
        offices.set(e.officeCode, g);
      }

      return {
        today,
        headcount: current.length,
        articles: current.filter((e) => e.gradeSlug === 'article').length,
        joinedThisMonth: current.filter((e) => e.dateOfJoining.startsWith(month)).length,
        onNotice: current.filter((e) => e.employmentStatus === EMPLOYMENT_STATUS.noticePeriod)
          .length,
        onLeave: current.filter((e) => e.employmentStatus === EMPLOYMENT_STATUS.onLeave).length,
        queues: buildQueues({
          today,
          now,
          employees,
          flags,
          loggedOnLastWorkingDay: logged,
        }).filter((q) => wide || EMPLOYEE_MASTER_QUEUES.has(q.key)),
        byOffice: [...offices.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([officeCode, grades]) => ({
            officeCode,
            byGrade: [...grades.entries()].map(([gradeSlug, count]) => ({ gradeSlug, count })),
          })),
        workload: {
          available: wide,
          weekStart,
          over: workload.filter((r) => r.weekSeconds > WORKLOAD_OVER_SECONDS).length,
          under: workload.filter((r) => r.weekSeconds < WORKLOAD_UNDER_SECONDS).length,
        },
      };
    });
  }

  /** People reports: a month's hours per person (`report.read_people`). */
  async monthlyHours(ctx: RlsContext, month: string): Promise<MonthlyHoursReport> {
    const { from, to } = monthRange(month);
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await guard(() =>
        client.query<{
          employee_id: string;
          employee_code: string;
          full_name: string;
          office_code: string;
          grade_name: string;
          days: number;
          total: string;
          work: string;
          review: string;
          other: string;
        }>(
          `SELECT e.id AS employee_id, e.employee_code, e.full_name, o.code AS office_code,
                  g.name AS grade_name,
                  count(a.day)::int AS days,
                  COALESCE(sum(a.total_seconds), 0)::text AS total,
                  COALESCE(sum(a.work_seconds), 0)::text AS work,
                  COALESCE(sum(a.review_seconds), 0)::text AS review,
                  COALESCE(sum(a.other_seconds), 0)::text AS other
             FROM hsdg.employees e
             JOIN hsdg.offices o ON o.id = e.primary_office_id
             JOIN hsdg.grades g ON g.id = e.grade_id
             LEFT JOIN hsdg.attendance_by_day($1::date, $2::date) a ON a.employee_id = e.id
            WHERE e.date_of_joining <= $2::date
              AND (e.date_of_exit IS NULL OR e.date_of_exit >= $1::date)
            GROUP BY e.id, o.code, g.name, g.rank
            ORDER BY o.code, g.rank DESC, e.full_name`,
          [from, to],
        ),
      );
      return {
        month,
        rows: rows.map((r) => ({
          employeeId: r.employee_id,
          employeeCode: r.employee_code,
          employeeName: r.full_name,
          officeCode: r.office_code,
          gradeName: r.grade_name,
          daysWithTime: r.days,
          totalSeconds: Number(r.total),
          workSeconds: Number(r.work),
          reviewSeconds: Number(r.review),
          otherSeconds: Number(r.other),
        })),
      };
    });
  }

  /**
   * An employee record's change history (spec §4.3): the audit events about
   * this person, through hsdg.employee_history — HR and the Managing Partner
   * only. 404 when the employee is not visible.
   */
  async history(ctx: RlsContext, employeeId: string): Promise<EmployeeHistoryEvent[]> {
    const exists = await this.org.getEmployeeById(ctx, employeeId);
    if (!exists) throw new NotFoundException('Employee not found.');
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await guard(() =>
        client.query<{
          id: string;
          occurred_at: Date;
          actor_name: string | null;
          actor_role: string | null;
          action: string;
          object_type: string;
          before_state: unknown;
          after_state: unknown;
          reason: string | null;
        }>(`SELECT * FROM hsdg.employee_history($1)`, [employeeId]),
      );
      return rows.map((r) => ({
        id: r.id,
        occurredAt: r.occurred_at.toISOString(),
        actorName: r.actor_name,
        actorRole: r.actor_role,
        action: r.action,
        objectType: r.object_type,
        before: r.before_state,
        after: r.after_state,
        reason: r.reason,
      }));
    });
  }

  /**
   * Start someone's exit (spec §4.2): set the date; on or after it the person
   * is exited and their login is switched off with its password removed (now
   * if the date has come, else by the daily job). The partners whose work
   * they're on are asked to reassign it — by notification, so HR never learns
   * which engagements those are.
   */
  async startExit(
    ctx: RlsContext,
    id: string,
    input: StartExitInput,
    loginPower: LoginPower = null,
  ): Promise<StartExitResult> {
    const before = await this.org.getEmployeeById(ctx, id);
    if (!before) throw new NotFoundException('Employee not found.');
    if (before.employmentStatus === EMPLOYMENT_STATUS.exited) {
      throw new ConflictException(`${before.fullName} has already left.`);
    }
    if (input.dateOfExit < before.dateOfJoining) {
      throw new BadRequestException('The date of exit can’t be before the date of joining.');
    }
    const today = istToday();
    const due = input.dateOfExit <= today;
    const status: EmploymentStatus = due
      ? EMPLOYMENT_STATUS.exited
      : EMPLOYMENT_STATUS.noticePeriod;

    await this.org.updateEmployee(ctx, id, {
      employmentStatus: status,
      dateOfExit: input.dateOfExit,
      ...(input.version !== undefined ? { version: input.version } : {}),
    });

    let loginTurnedOff = false;
    if (due && before.userId) {
      loginTurnedOff = await this.turnOffLogin(ctx, before.userId, loginPower);
    }

    const partners = await this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await guard(() =>
        client.query<{ id: string; full_name: string }>(
          `SELECT e.id, e.full_name
             FROM hsdg.leaver_reassign_partners($1) p
             JOIN hsdg.employees e ON e.id = p.employee_id
            WHERE e.employment_status <> 'exited'`,
          [id],
        ),
      );
      let asked = rows;
      if (asked.length === 0) asked = await this.managingPartners(client);
      await this.notifications.emitWith(client, ctx, {
        type: NOTIFICATION_TYPE.employeeExitReassign,
        recipientEmployeeIds: asked.map((r) => r.id),
        title: `${before.fullName} leaves on ${shortDate(input.dateOfExit)}`,
        body: 'Please reassign their engagements and open tasks before then.',
        objectType: 'employee',
        objectId: id,
        dedupKey: `employee-exit:${id}:${input.dateOfExit}`,
        link: null,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'employee.exit_started',
        objectType: 'employee',
        objectId: id,
        before: { employmentStatus: before.employmentStatus, dateOfExit: before.dateOfExit },
        after: { employmentStatus: status, dateOfExit: input.dateOfExit, loginTurnedOff },
        ...(input.reason ? { reason: input.reason } : {}),
      });
      return asked;
    });

    return {
      employeeId: id,
      dateOfExit: input.dateOfExit,
      employmentStatus: status,
      loginTurnedOff,
      reassignAskedOf: partners.map((p) => p.full_name),
    };
  }

  /**
   * The daily job: everyone whose exit date has come is exited, and their
   * login is switched off with its password removed. Runs in the reserved
   * system context (firm-wide on employees, users and passwords). Idempotent.
   */
  async applyDueExits(now: Date = new Date()): Promise<{ exited: number; loginsOff: number }> {
    const today = istToday(now);
    const ctx: RlsContext = { userId: '', role: SYSTEM_ROLE, officeId: '' };
    return this.db.withRlsContext(ctx, async (client) => {
      const due = await client.query<{ id: string; user_id: string | null }>(
        `UPDATE hsdg.employees
            SET employment_status = 'exited', version = version + 1
          WHERE date_of_exit IS NOT NULL AND date_of_exit <= $1::date
            AND employment_status <> 'exited'
        RETURNING id, user_id`,
        [today],
      );
      // Also catch anyone exited by hand whose login was left on. Only logins
      // HR could switch off themselves (nothing above Manager — spec §4.5):
      // otherwise setting a partner's exit date would switch off a partner's
      // login. Those stay on, on the desk's "left, but the login is still on"
      // queue, for an administrator.
      const off = await client.query<{ id: string }>(
        `UPDATE hsdg.users u SET is_active = false
           FROM hsdg.employees e
          WHERE e.user_id = u.id AND u.is_active
            AND e.employment_status = 'exited'
            AND e.date_of_exit IS NOT NULL AND e.date_of_exit <= $1::date
            AND NOT EXISTS (
              SELECT 1 FROM hsdg.user_roles ur JOIN hsdg.roles r ON r.id = ur.role_id
               WHERE ur.user_id = u.id AND r.slug <> ALL ($2::text[]))
        RETURNING u.id`,
        [today, ONBOARD_ASSIGNABLE_ROLES],
      );
      const userIds = off.rows.map((r) => r.id);
      if (userIds.length) {
        await client.query(`DELETE FROM hsdg.user_passwords WHERE user_id = ANY ($1::uuid[])`, [
          userIds,
        ]);
      }
      for (const e of due.rows) {
        await this.audit.recordWith(client, ctx, {
          action: 'employee.exit_applied',
          objectType: 'employee',
          objectId: e.id,
          after: { employmentStatus: EMPLOYMENT_STATUS.exited },
        });
      }
      for (const u of userIds) {
        await this.audit.recordWith(client, ctx, {
          action: 'user.deactivated_on_exit',
          objectType: 'user',
          objectId: u,
          after: { isActive: false, password: 'removed' },
        });
      }
      return { exited: due.rowCount ?? 0, loginsOff: userIds.length };
    });
  }

  /**
   * Switch a leaver's login off now. Goes through IdentityService with the
   * caller's ceiling, so HR can't switch off a partner's login (nor their own);
   * the password row is then removed in the system context, as the sign-in
   * path owns that table — but only once the login is really off. False when
   * the caller may not manage logins or the ceiling refuses.
   */
  private async turnOffLogin(
    ctx: RlsContext,
    userId: string,
    loginPower: LoginPower,
  ): Promise<boolean> {
    if (loginPower === null) return false;
    const ceiling = loginPower === 'all' ? undefined : loginPower;
    try {
      const after = await this.identity.updateUser(ctx, userId, { isActive: false }, ceiling);
      if (after.isActive) return false;
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof NotFoundException) {
        this.logger.log(`Exit: login ${userId} left for an administrator (${err.message}).`);
        return false;
      }
      throw err;
    }
    const system: RlsContext = { userId: '', role: SYSTEM_ROLE, officeId: '' };
    await this.db.withRlsContext(system, (client) =>
      client.query(`DELETE FROM hsdg.user_passwords WHERE user_id = $1`, [userId]),
    );
    await this.audit.record(ctx, {
      action: 'user.deactivated_on_exit',
      objectType: 'user',
      objectId: userId,
      after: withVia({ isActive: false, password: 'removed' }, ceiling),
    });
    return true;
  }

  private async managingPartners(
    client: PoolClient,
  ): Promise<Array<{ id: string; full_name: string }>> {
    const { rows } = await client.query<{ id: string; full_name: string }>(
      `SELECT DISTINCT e.id, e.full_name
         FROM hsdg.employees e
         JOIN hsdg.users u ON u.id = e.user_id AND u.is_active
         JOIN hsdg.user_roles ur ON ur.user_id = u.id
         JOIN hsdg.roles r ON r.id = ur.role_id AND r.slug = $1`,
      [ROLE.managingPartner],
    );
    return rows;
  }

  private async workloadRows(client: PoolClient, weekStart: string): Promise<PeopleWorkloadRow[]> {
    const { rows } = await guard(() =>
      client.query<{
        employee_id: string;
        employee_code: string;
        full_name: string;
        office_code: string;
        grade_slug: GradeSlug;
        grade_name: string;
        employment_status: EmploymentStatus;
        as_partner: number;
        as_manager: number;
        as_team: number;
        active_engagements: number;
        open_tasks: number;
        overdue_tasks: number;
        week_seconds: number;
      }>(
        `SELECT w.*, e.employee_code, e.full_name, o.code AS office_code,
                g.slug AS grade_slug, g.name AS grade_name, e.employment_status
           FROM hsdg.people_workload($1::date) w
           JOIN hsdg.employees e ON e.id = w.employee_id
           JOIN hsdg.offices o ON o.id = e.primary_office_id
           JOIN hsdg.grades g ON g.id = e.grade_id
          ORDER BY w.active_engagements DESC, w.open_tasks DESC, e.full_name`,
        [weekStart],
      ),
    );
    return rows.map((r) => ({
      employeeId: r.employee_id,
      employeeCode: r.employee_code,
      employeeName: r.full_name,
      officeCode: r.office_code,
      gradeSlug: r.grade_slug,
      gradeName: r.grade_name,
      employmentStatus: r.employment_status,
      asPartner: r.as_partner,
      asManager: r.as_manager,
      asTeam: r.as_team,
      activeEngagements: r.active_engagements,
      openTasks: r.open_tasks,
      overdueTasks: r.overdue_tasks,
      weekSeconds: r.week_seconds,
    }));
  }

  private async deskEmployees(client: PoolClient): Promise<DeskEmployee[]> {
    const { rows } = await client.query<{
      id: string;
      employee_code: string;
      full_name: string;
      office_code: string;
      grade_slug: GradeSlug;
      grade_name: string;
      employment_status: EmploymentStatus;
      date_of_joining: string;
      date_of_exit: string | null;
      user_id: string | null;
      user_active: boolean | null;
      completes: string | null;
    }>(
      `SELECT e.id, e.employee_code, e.full_name, o.code AS office_code,
              g.slug AS grade_slug, g.name AS grade_name, e.employment_status,
              e.date_of_joining, e.date_of_exit, e.user_id, u.is_active AS user_active,
              a.expected_completion AS completes
         FROM hsdg.employees e
         JOIN hsdg.offices o ON o.id = e.primary_office_id
         JOIN hsdg.grades g ON g.id = e.grade_id
         LEFT JOIN hsdg.users u ON u.id = e.user_id
         LEFT JOIN hsdg.articleships a ON a.employee_id = e.id AND a.status = 'active'
        ORDER BY e.full_name`,
    );
    return rows.map((r) => ({
      id: r.id,
      employeeCode: r.employee_code,
      fullName: r.full_name,
      officeCode: r.office_code,
      gradeSlug: r.grade_slug,
      gradeName: r.grade_name,
      employmentStatus: r.employment_status,
      dateOfJoining: r.date_of_joining,
      dateOfExit: r.date_of_exit,
      userId: r.user_id,
      userActive: r.user_active,
      articleshipCompletes: r.completes,
    }));
  }
}

/**
 * What the caller may do to a leaver's login: anything (`user.manage`), within
 * HR's ceiling (`user.onboard`), or nothing.
 */
export type LoginPower = 'all' | OnboardCeiling | null;

/** Queues that need only the employee master (what the administrator sees). */
const EMPLOYEE_MASTER_QUEUES = new Set<PeopleDeskQueue>([
  PEOPLE_DESK_QUEUE.noLogin,
  PEOPLE_DESK_QUEUE.exitPassedLoginOn,
]);

/** HR or the Managing Partner — as hsdg.ctx_reads_people() decides it. */
function readsPeople(ctx: RlsContext): boolean {
  return ctx.role === ROLE.managingPartner || (ctx.roles ?? []).includes(ROLE.hr);
}

function mapAttendance(r: AttendanceRow): AttendanceDay {
  return {
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    employeeName: r.full_name,
    officeCode: r.office_code,
    gradeName: r.grade_name,
    day: r.day,
    firstStart: r.first_start.toISOString(),
    lastStop: r.last_stop ? r.last_stop.toISOString() : null,
    running: r.running,
    totalSeconds: r.total_seconds,
    workSeconds: r.work_seconds ?? 0,
    reviewSeconds: r.review_seconds ?? 0,
    otherSeconds: r.other_seconds ?? 0,
    categorySeconds: r.category_seconds ?? {},
  };
}

/** The functions refuse with 42501 (not allowed) or 22023 (bad range). */
async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const { code, message } = err as { code?: string; message?: string };
    if (code === '42501') throw new ForbiddenException(message);
    if (code === '22023') throw new BadRequestException(message);
    throw err;
  }
}
