import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { SYSTEM_ROLE } from '@hsdg/contracts';
import { DatabaseService } from '../../../database/database.service';
import type { RlsContext } from '../../../database/rls-context';
import { AppConfigService } from '../../../config/config.module';
import { TimeAutoService } from './time-auto.service';

/**
 * Change 3 — the 5-minute stale-entry closer. Idle entries (no heartbeat for 15
 * minutes) end at their last heartbeat; after the office day-end, entries begun
 * before it end at the cut-off. Runs whenever SCHEDULER_ENABLED, regardless of
 * ff_auto_time, so turning the flag off never strands a running auto entry.
 *
 * Identity mirrors the compliance scheduler: resolve an active managing partner
 * under the 'system' bootstrap context, then run under that partner's context
 * (a firm-wide lead may close anyone's entry and pause the task).
 */
@Injectable()
export class TimeCloserScheduler implements OnModuleInit {
  private readonly logger = new Logger(TimeCloserScheduler.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly time: TimeAutoService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('SCHEDULER_ENABLED')) return;
    // One instance runs each tick (advisory lock), however many are up.
    const job = new CronJob(this.config.get('SCHEDULER_TIME_CLOSER_CRON'), () => {
      void this.db
        .runExclusive('time-stale-closer', () => this.run())
        .catch((err: Error) => {
          this.logger.error(`Scheduled run failed: ${err.message}`, err.stack);
        });
    });
    this.registry.addCronJob(
      'time-stale-closer',
      job as unknown as Parameters<SchedulerRegistry['addCronJob']>[1],
    );
    job.start();
  }

  /** One pass of the closer. Public for the HTTP cron trigger and tests. */
  async run(now: Date = new Date()): Promise<{ idle: number; dayEnd: number } | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const ctx = await this.operatorContext();
      if (!ctx) {
        this.logger.warn('No active managing partner found; time closer skipped.');
        return null;
      }
      const res = await this.time.closeStale(ctx, now, this.config.get('TIME_DAY_END_HOUR_IST'));
      if (res.idle || res.dayEnd) {
        this.logger.log(`Time closer: ${res.idle} idle, ${res.dayEnd} day-end entr(ies) closed.`);
      }
      return res;
    } catch (err) {
      const e = err as Error;
      this.logger.error(`Time closer failed: ${e.message}`, e.stack);
      return null;
    } finally {
      this.running = false;
    }
  }

  private async operatorContext(): Promise<RlsContext | null> {
    return this.db.withRlsContext(
      { userId: '', role: SYSTEM_ROLE, officeId: '' },
      async (client) => {
        const { rows } = await client.query<{
          user_id: string;
          office_id: string;
          employee_id: string | null;
        }>(
          `SELECT u.id AS user_id, u.primary_office_id AS office_id, emp.id AS employee_id
             FROM hsdg.users u
             JOIN hsdg.user_roles ur ON ur.user_id = u.id
             JOIN hsdg.roles r ON r.id = ur.role_id
             LEFT JOIN hsdg.employees emp ON emp.user_id = u.id
            WHERE r.slug = 'managing_partner' AND u.is_active = true
            ORDER BY u.created_at
            LIMIT 1`,
        );
        const row = rows[0];
        if (!row) return null;
        return {
          userId: row.user_id,
          role: 'managing_partner',
          officeId: row.office_id,
          ...(row.employee_id ? { employeeId: row.employee_id } : {}),
        };
      },
    );
  }
}
