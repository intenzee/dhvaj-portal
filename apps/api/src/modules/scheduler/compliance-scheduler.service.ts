import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { FEATURE_FLAG, SYSTEM_ROLE } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AppConfigService } from '../../config/config.module';
import { NotificationsScanService } from '../notifications/notifications-scan.service';
import { NotificationOutboxService } from '../notifications/notification-outbox.service';
import { ComponentInstancesService } from '../components/component-instances.service';
import { ComplianceCalendarV2Service } from '../compliance/compliance-calendar-v2.service';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';

/**
 * The background scheduler (spec §17/§18/§24). The compliance engine records two
 * clocks and a rolling future horizon, but nothing advanced them on its own — the
 * sweep and the horizon roll were manual, operator-triggered endpoints. This
 * closes that gap: when SCHEDULER_ENABLED, a cron authenticates as the firm-wide
 * operator (the managing partner) and runs both jobs on a schedule.
 *
 * Identity: a scheduled job has no HTTP principal, so it bootstraps under the
 * reserved 'system' context (firm-wide read for identity, exactly as the auth
 * layer does) to resolve an active managing partner, then runs the actual work
 * under THAT partner's business-firm-wide context — because the compliance data
 * (engagements/instances) is visible only to a real managing partner, never to
 * 'system'/'admin'. Both jobs are idempotent, so a missed or overlapping tick
 * never double-emits or double-generates; an in-process guard also skips a tick
 * whose predecessor is still running.
 */
@Injectable()
export class ComplianceSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ComplianceSchedulerService.name);
  private sweepRunning = false;
  private horizonRunning = false;
  private outboxRunning = false;
  private calendarRunning = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly scan: NotificationsScanService,
    private readonly outbox: NotificationOutboxService,
    private readonly instances: ComponentInstancesService,
    private readonly calendar: ComplianceCalendarV2Service,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('SCHEDULER_ENABLED')) {
      this.logger.log('Background scheduler disabled (SCHEDULER_ENABLED=false).');
      return;
    }
    this.register('compliance-sweep', this.config.get('SCHEDULER_SWEEP_CRON'), () =>
      this.runSweep(),
    );
    this.register('compliance-horizon-roll', this.config.get('SCHEDULER_HORIZON_CRON'), () =>
      this.runHorizonRoll(),
    );
    this.register('notification-outbox-drain', this.config.get('SCHEDULER_OUTBOX_CRON'), () =>
      this.runOutboxDrain(),
    );
    this.register('compliance-calendar', this.config.get('SCHEDULER_CALENDAR_CRON'), () =>
      this.runCalendarMaintenance(),
    );
    this.logger.log(
      `Background scheduler enabled — sweep [${this.config.get('SCHEDULER_SWEEP_CRON')}], ` +
        `horizon roll [${this.config.get('SCHEDULER_HORIZON_CRON')}], ` +
        `outbox drain [${this.config.get('SCHEDULER_OUTBOX_CRON')}], ` +
        `calendar [${this.config.get('SCHEDULER_CALENDAR_CRON')}].`,
    );
  }

  /**
   * Register a config-driven cron job. Expressions are validated by CronJob.
   * With several API instances each tick runs on one of them (advisory lock).
   */
  private register(name: string, cron: string, handler: () => Promise<void>): void {
    const job = new CronJob(cron, () => {
      void this.db.runExclusive(name, handler).catch((err: Error) => {
        this.logger.error(`Scheduled job ${name} failed: ${err.message}`, err.stack);
      });
    });
    this.registry.addCronJob(
      name,
      job as unknown as Parameters<SchedulerRegistry['addCronJob']>[1],
    );
    job.start();
  }

  /**
   * Resolve the operator (an active managing partner) under the 'system'
   * bootstrap context, then hand back a business-firm-wide context stamped with
   * that partner's identity. Null when the firm has no active managing partner.
   */
  private async resolveOperatorContext(): Promise<RlsContext | null> {
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

  /** Run the date-driven notification sweep (§24). Public so it is unit-testable. */
  async runSweep(): Promise<void> {
    if (this.sweepRunning) {
      this.logger.warn('Sweep still running from a previous tick; skipping.');
      return;
    }
    this.sweepRunning = true;
    try {
      const ctx = await this.resolveOperatorContext();
      if (!ctx) {
        this.logger.warn('No active managing partner found; sweep skipped.');
        return;
      }
      const result = await this.scan.run(ctx);
      this.logger.log(`Notification sweep complete — ${result.total} notification(s) emitted.`);
    } catch (err) {
      const e = err as Error;
      this.logger.error(`Notification sweep failed: ${e.message}`, e.stack);
    } finally {
      this.sweepRunning = false;
    }
  }

  /** Drain the external-delivery outbox. Public so it is unit-testable. */
  async runOutboxDrain(): Promise<void> {
    if (this.outboxRunning) {
      this.logger.warn('Outbox drain still running from a previous tick; skipping.');
      return;
    }
    this.outboxRunning = true;
    try {
      const ctx = await this.resolveOperatorContext();
      if (!ctx) {
        this.logger.warn('No active managing partner found; outbox drain skipped.');
        return;
      }
      await this.outbox.drain(ctx);
    } catch (err) {
      const e = err as Error;
      this.logger.error(`Outbox drain failed: ${e.message}`, e.stack);
    } finally {
      this.outboxRunning = false;
    }
  }

  /** Roll the recurring-work future horizon (§18). Public so it is unit-testable. */
  async runHorizonRoll(): Promise<void> {
    if (this.horizonRunning) {
      this.logger.warn('Horizon roll still running from a previous tick; skipping.');
      return;
    }
    this.horizonRunning = true;
    try {
      const ctx = await this.resolveOperatorContext();
      if (!ctx) {
        this.logger.warn('No active managing partner found; horizon roll skipped.');
        return;
      }
      const result = await this.instances.rollHorizon(ctx, {});
      this.logger.log(
        `Horizon roll complete — ${result.generated} generated, ${result.removed} removed ` +
          `across ${result.engagementsProcessed} engagement(s).`,
      );
    } catch (err) {
      const e = err as Error;
      this.logger.error(`Horizon roll failed: ${e.message}`, e.stack);
    } finally {
      this.horizonRunning = false;
    }
  }

  /**
   * Nightly compliance calendar run (calendar v2): new extensions, profile
   * changes saved by non-leads, AGM dates. Off with ff_calendar_v2.
   */
  async runCalendarMaintenance(): Promise<void> {
    if (!this.flags.isOn(FEATURE_FLAG.calendarV2)) return;
    if (this.calendarRunning) {
      this.logger.warn('Calendar run still running from a previous tick; skipping.');
      return;
    }
    this.calendarRunning = true;
    try {
      const ctx = await this.resolveOperatorContext();
      if (!ctx) {
        this.logger.warn('No active managing partner found; calendar run skipped.');
        return;
      }
      const r = await this.calendar.maintain(ctx);
      this.logger.log(
        `Calendar run complete — ${r.extended} extension(s) attached; ${r.engagements} ` +
          `engagement(s): ${r.totals.created} created, ${r.totals.moved} moved, ` +
          `${r.totals.flagged} flagged, ${r.totals.notApplicable} not applicable, ${r.failed} failed.`,
      );
    } catch (err) {
      const e = err as Error;
      this.logger.error(`Calendar run failed: ${e.message}`, e.stack);
    } finally {
      this.calendarRunning = false;
    }
  }
}
