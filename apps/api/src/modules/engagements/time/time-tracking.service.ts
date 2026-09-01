import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  STOPPED_REASON,
  type ActiveTimer,
  type EngagementTimePersonRow,
  type EngagementTimeReport,
  type FirmTimeReport,
  type FirmTimeRow,
  type StoppedReason,
  type TimeEntryRecord,
} from '@hsdg/contracts';
import { DatabaseService } from '../../../database/database.service';
import type { RlsContext } from '../../../database/rls-context';
import { translatePgError as mapPgError } from '../../../common/errors/pg-error.util';
import { AuditService } from '../../audit/audit.service';

interface TimeEntryRow {
  id: string;
  engagement_id: string;
  employee_id: string;
  employee_name: string;
  started_at: Date;
  ended_at: Date | null;
  duration_seconds: number | null;
  note: string | null;
  stopped_reason: StoppedReason | null;
  version: number;
}

function mapEntry(r: TimeEntryRow): TimeEntryRecord {
  return {
    id: r.id,
    engagementId: r.engagement_id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    startedAt: r.started_at.toISOString(),
    endedAt: r.ended_at ? r.ended_at.toISOString() : null,
    durationSeconds: r.duration_seconds,
    isRunning: r.ended_at === null,
    note: r.note,
    stoppedReason: r.stopped_reason,
    version: r.version,
  };
}

/**
 * Column list shared by every entry read (aliased `te`, LEFT-joined to `emp`).
 * The name is COALESCEd because `employees` is office-scoped RLS: a viewer may be
 * entitled to an engagement's time rows (via `is_engagement_member`) yet not see
 * a contributor's employee row (a different office, or someone since removed from
 * the team). A LEFT JOIN + fallback keeps such entries — and the totals computed
 * from them — correct instead of silently dropping them.
 */
const ENTRY_SELECT = `te.id, te.engagement_id, te.employee_id,
        COALESCE(emp.full_name, 'Team member') AS employee_name,
        te.started_at, te.ended_at, te.duration_seconds, te.note, te.stopped_reason, te.version`;

/**
 * The engagement time-tracking engine (ADR-0034): a manual stopwatch per person
 * per engagement that never auto-stops on inactivity. Every write runs under the
 * caller's RLS context and is audited in the same transaction as the mutation.
 *
 * The one-running-timer-per-person invariant is enforced by the partial unique
 * index `one_running_timer_per_employee`; this service surfaces a friendly 409
 * naming the engagement that is still running.
 */
@Injectable()
export class TimeTrackingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Start the caller's timer on an engagement they belong to. */
  async start(
    ctx: RlsContext,
    engagementId: string,
    note: string | undefined,
  ): Promise<TimeEntryRecord> {
    if (!ctx.employeeId) {
      throw new BadRequestException(
        'Your account is not linked to an employee record, so you cannot log time.',
      );
    }
    return this.db.withRlsContext(ctx, async (client) => {
      // The engagement must be visible to the caller (RLS); a clean 404 rather
      // than leaking existence via a later insert failure.
      const visible = await client.query(`SELECT 1 FROM hsdg.engagements WHERE id = $1`, [
        engagementId,
      ]);
      if (visible.rowCount === 0) throw new NotFoundException('Engagement not found.');

      // Friendly guard for the one-timer invariant: name the running engagement.
      const running = await client.query<{ engagement_code: string }>(
        `SELECT e.engagement_code
         FROM hsdg.engagement_time_entries te
         JOIN hsdg.engagements e ON e.id = te.engagement_id
         WHERE te.employee_id = $1 AND te.ended_at IS NULL`,
        [ctx.employeeId],
      );
      if (running.rows[0]) {
        throw new ConflictException(
          `You already have a running timer on ${running.rows[0].engagement_code}. Stop it before starting another.`,
        );
      }

      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.engagement_time_entries (engagement_id, employee_id, note)
           VALUES ($1, $2, $3) RETURNING id`,
          [engagementId, ctx.employeeId, note ?? null],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translateTimeError(err);
      }

      const entry = await this.getEntry(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'time.started',
        objectType: 'engagement_time_entry',
        objectId: id,
        after: { engagementId, startedAt: entry.startedAt, note: entry.note },
      });
      return entry;
    });
  }

  /** Stop the caller's own running timer on this engagement. */
  async stop(
    ctx: RlsContext,
    engagementId: string,
    note: string | undefined,
  ): Promise<TimeEntryRecord> {
    if (!ctx.employeeId) {
      throw new BadRequestException('Your account is not linked to an employee record.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      // COALESCE keeps the original note when no closing note is supplied.
      let rows: Array<{ id: string }>;
      try {
        ({ rows } = await client.query<{ id: string }>(
          `UPDATE hsdg.engagement_time_entries
            SET ended_at = now(),
                duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int),
                note = COALESCE($3, note),
                stopped_reason = $4,
                version = version + 1
          WHERE engagement_id = $1 AND employee_id = $2 AND ended_at IS NULL
          RETURNING id`,
          [engagementId, ctx.employeeId, note ?? null, STOPPED_REASON.manual],
        ));
      } catch (err) {
        throw translateTimeError(err);
      }
      if (!rows[0]) throw new NotFoundException('You have no running timer on this engagement.');

      const entry = await this.getEntry(client, rows[0].id);
      await this.audit.recordWith(client, ctx, {
        action: 'time.stopped',
        objectType: 'engagement_time_entry',
        objectId: entry.id,
        after: {
          engagementId,
          durationSeconds: entry.durationSeconds,
          stoppedReason: entry.stoppedReason,
        },
      });
      return entry;
    });
  }

  /**
   * Force-stop EVERY running entry on an engagement, using an existing
   * transaction client — the terminal-state safety net (called from the
   * lifecycle service so it commits atomically with the status change). No
   * timer may keep ticking on completed/closed/cancelled work. Runs under the
   * actor's context; the RLS update policy lets a lead/firm-wide stop others.
   */
  async stopAllRunningWith(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    reason: StoppedReason,
  ): Promise<number> {
    let rows: Array<{ id: string }>;
    try {
      ({ rows } = await client.query<{ id: string }>(
        `UPDATE hsdg.engagement_time_entries
          SET ended_at = now(),
              duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int),
              stopped_reason = $2,
              version = version + 1
        WHERE engagement_id = $1 AND ended_at IS NULL
        RETURNING id`,
        [engagementId, reason],
      ));
    } catch (err) {
      // Keep a constraint failure from surfacing as a raw 500 that would abort
      // the whole lifecycle transition; map it to a clean 4xx instead.
      throw translateTimeError(err);
    }
    if (rows.length > 0) {
      await this.audit.recordWith(client, ctx, {
        action: 'time.auto_stopped',
        objectType: 'engagement',
        objectId: engagementId,
        after: { stoppedCount: rows.length, reason },
      });
    }
    return rows.length;
  }

  /** The caller's single running timer (for the global banner), or null. */
  async activeForCaller(ctx: RlsContext): Promise<ActiveTimer | null> {
    if (!ctx.employeeId) return null;
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<
        TimeEntryRow & { engagement_code: string; entity_name: string }
      >(
        `SELECT ${ENTRY_SELECT}, e.engagement_code, ent.legal_name AS entity_name
         FROM hsdg.engagement_time_entries te
         JOIN hsdg.employees emp ON emp.id = te.employee_id
         JOIN hsdg.engagements e ON e.id = te.engagement_id
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         WHERE te.employee_id = $1 AND te.ended_at IS NULL
         LIMIT 1`,
        [ctx.employeeId],
      );
      const r = rows[0];
      if (!r) return null;
      return { entry: mapEntry(r), engagementCode: r.engagement_code, entityName: r.entity_name };
    });
  }

  /** An engagement's entries + per-person summary (the Time tab). */
  async listForEngagement(ctx: RlsContext, engagementId: string): Promise<EngagementTimeReport> {
    return this.db.withRlsContext(ctx, async (client) => {
      const visible = await client.query(`SELECT 1 FROM hsdg.engagements WHERE id = $1`, [
        engagementId,
      ]);
      if (visible.rowCount === 0) throw new NotFoundException('Engagement not found.');

      const { rows } = await client.query<TimeEntryRow>(
        `SELECT ${ENTRY_SELECT}
         FROM hsdg.engagement_time_entries te
         LEFT JOIN hsdg.employees emp ON emp.id = te.employee_id
         WHERE te.engagement_id = $1
         ORDER BY te.started_at DESC`,
        [engagementId],
      );
      const entries = rows.map(mapEntry);

      const byPerson = await client.query<{
        employee_id: string;
        employee_name: string;
        total_seconds: string;
        entry_count: string;
        has_running: boolean;
      }>(
        `SELECT te.employee_id, COALESCE(emp.full_name, 'Team member') AS employee_name,
                COALESCE(SUM(te.duration_seconds), 0)::text AS total_seconds,
                count(*)::text AS entry_count,
                bool_or(te.ended_at IS NULL) AS has_running
         FROM hsdg.engagement_time_entries te
         LEFT JOIN hsdg.employees emp ON emp.id = te.employee_id
         WHERE te.engagement_id = $1
         GROUP BY te.employee_id, emp.full_name
         ORDER BY COALESCE(SUM(te.duration_seconds), 0) DESC, emp.full_name`,
        [engagementId],
      );
      const people: EngagementTimePersonRow[] = byPerson.rows.map((p) => ({
        employeeId: p.employee_id,
        employeeName: p.employee_name,
        totalSeconds: Number(p.total_seconds),
        entryCount: Number(p.entry_count),
        hasRunning: p.has_running,
      }));
      return {
        entries,
        byPerson: people,
        totalSeconds: people.reduce((sum, p) => sum + p.totalSeconds, 0),
      };
    });
  }

  /** Firm-wide time per person across all RLS-visible engagements (report.read). */
  async firmReport(ctx: RlsContext): Promise<FirmTimeReport> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        employee_id: string;
        employee_name: string;
        grade_name: string | null;
        office_code: string | null;
        total_seconds: string;
        entry_count: string;
        engagement_count: string;
        has_running: boolean;
      }>(
        `SELECT te.employee_id, COALESCE(emp.full_name, 'Team member') AS employee_name,
                g.name AS grade_name, o.code AS office_code,
                COALESCE(SUM(te.duration_seconds), 0)::text AS total_seconds,
                count(*)::text AS entry_count,
                count(DISTINCT te.engagement_id)::text AS engagement_count,
                bool_or(te.ended_at IS NULL) AS has_running
         FROM hsdg.engagement_time_entries te
         LEFT JOIN hsdg.employees emp ON emp.id = te.employee_id
         LEFT JOIN hsdg.grades g ON g.id = emp.grade_id
         LEFT JOIN hsdg.offices o ON o.id = emp.primary_office_id
         GROUP BY te.employee_id, emp.full_name, g.name, o.code
         ORDER BY COALESCE(SUM(te.duration_seconds), 0) DESC, emp.full_name`,
      );
      const rowsOut: FirmTimeRow[] = rows.map((r) => ({
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        gradeName: r.grade_name,
        officeCode: r.office_code,
        totalSeconds: Number(r.total_seconds),
        entryCount: Number(r.entry_count),
        engagementCount: Number(r.engagement_count),
        hasRunning: r.has_running,
      }));
      return {
        rows: rowsOut,
        totals: {
          people: rowsOut.length,
          totalSeconds: rowsOut.reduce((s, r) => s + r.totalSeconds, 0),
          running: rowsOut.filter((r) => r.hasRunning).length,
        },
      };
    });
  }

  private async getEntry(client: PoolClient, id: string): Promise<TimeEntryRecord> {
    const { rows } = await client.query<TimeEntryRow>(
      `SELECT ${ENTRY_SELECT}
       FROM hsdg.engagement_time_entries te
       JOIN hsdg.employees emp ON emp.id = te.employee_id
       WHERE te.id = $1`,
      [id],
    );
    return mapEntry(rows[0]!);
  }
}

/** Map PostgreSQL constraint/RLS violations to clean HTTP errors (time domain). */
export function translateTimeError(err: unknown): Error {
  return mapPgError(err, {
    unique: [
      {
        match: 'one_running_timer_per_employee',
        message: 'You already have a running timer. Stop it before starting another.',
      },
    ],
    uniqueDefault: 'A duplicate value violates a unique constraint.',
    foreignKey: 'The engagement or employee referenced does not exist.',
    check: 'Invalid time entry.',
    forbidden: 'Not permitted to log time on this engagement.',
  });
}
