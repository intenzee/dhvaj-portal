import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { FEATURE_FLAG, PARTNER_PACK_DAY, partnerPackMonth } from '@hsdg/contracts';
import { AppConfigService } from '../../config/config.module';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { istToday } from '../engagements/time/auto-time';
import { PartnerPacksService } from './partner-packs.service';

/** Whether `today` (IST, yyyy-mm-dd) is the day the packs go out. */
export function isPackDay(today: string): boolean {
  return Number(today.slice(8, 10)) === PARTNER_PACK_DAY;
}

/**
 * PS-303 · on the 3rd (07:00 IST) every partner's pack for last month is built
 * and they are told it is ready (bell and e-mail, through the outbox). A pack
 * already sent is rebuilt but not sent again, so a re-run is harmless.
 */
@Injectable()
export class PartnerPacksScheduler implements OnModuleInit {
  private readonly logger = new Logger(PartnerPacksScheduler.name);
  private running = false;

  constructor(
    private readonly config: AppConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly flags: FeatureFlagsService,
    private readonly packs: PartnerPacksService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('SCHEDULER_ENABLED')) return;
    const job = new CronJob(this.config.get('SCHEDULER_PARTNER_PACK_CRON'), () => {
      void this.run();
    });
    this.registry.addCronJob(
      'partner-packs',
      job as unknown as Parameters<SchedulerRegistry['addCronJob']>[1],
    );
    job.start();
  }

  /** One pass: last month's packs. Public for the HTTP cron trigger and tests. */
  async run(now: Date = new Date()): Promise<{ built: number; failed: number } | null> {
    if (this.running || !this.flags.isOn(FEATURE_FLAG.partnerRisk)) return null;
    this.running = true;
    try {
      const month = partnerPackMonth(istToday(now));
      // During a one-office rollout only that office's partners get one.
      const res = await this.packs.runMonthly(month, (p) =>
        this.flags.isOnFor(FEATURE_FLAG.partnerRisk, p.officeCode),
      );
      this.logger.log(`Partner packs for ${month}: ${res.built} built, ${res.failed} failed.`);
      return res;
    } catch (err) {
      const e = err as Error;
      this.logger.error(`Partner packs failed: ${e.message}`, e.stack);
      return null;
    } finally {
      this.running = false;
    }
  }
}
