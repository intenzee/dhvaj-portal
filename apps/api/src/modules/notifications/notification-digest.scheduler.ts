import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { FEATURE_FLAG, SYSTEM_ROLE } from '@hsdg/contracts';
import { AppConfigService } from '../../config/config.module';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { istToday } from '../engagements/time/auto-time';
import { NotificationsService } from './notifications.service';

/** The IST day before `today` (yyyy-mm-dd). */
export function previousDay(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Staff Workflow WF-305 — the morning digest. Each morning (07:00 IST) everyone
 * with informational notices from yesterday that they left in the digest gets
 * one e-mail/Teams message listing them, in place of one message per notice.
 * Only once actionable notifications are on firm-wide: during a one-office
 * rollout those notices still go out one by one, so nobody gets them twice.
 * The SQL records each day it sent, so a re-run (or the HTTP cron) is a no-op.
 */
@Injectable()
export class NotificationDigestScheduler implements OnModuleInit {
  private readonly logger = new Logger(NotificationDigestScheduler.name);
  private running = false;

  constructor(
    private readonly config: AppConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly flags: FeatureFlagsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('SCHEDULER_ENABLED')) return;
    const job = new CronJob(this.config.get('SCHEDULER_DIGEST_CRON'), () => {
      void this.run();
    });
    this.registry.addCronJob(
      'notification-digest',
      job as unknown as Parameters<SchedulerRegistry['addCronJob']>[1],
    );
    job.start();
  }

  /** One pass: yesterday's digest. Public for the HTTP cron trigger and tests. */
  async run(now: Date = new Date()): Promise<{ users: number } | null> {
    if (this.running || !this.flags.isOnFor(FEATURE_FLAG.filingRuns, null)) return null;
    if (!this.notifications.hasExternalChannels) return null;
    this.running = true;
    try {
      const day = previousDay(istToday(now));
      // The SQL is SECURITY DEFINER (it reads every inbox), so the bootstrap
      // context is enough to call it.
      const res = await this.notifications.sendDigests(
        { userId: '', role: SYSTEM_ROLE, officeId: '' },
        day,
      );
      if (res.users) this.logger.log(`Digest for ${day}: ${res.users} user(s).`);
      return res;
    } catch (err) {
      const e = err as Error;
      this.logger.error(`Notification digest failed: ${e.message}`, e.stack);
      return null;
    } finally {
      this.running = false;
    }
  }
}
