import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { DatabaseService } from '../../database/database.service';
import { AppConfigService } from '../../config/config.module';
import { PeopleService } from './people.service';

/**
 * Daily, 00:05 IST: leavers whose date of exit has come are exited and their
 * login switched off with its password removed (spec §4.2). Idempotent.
 */
@Injectable()
export class PeopleExitsScheduler implements OnModuleInit {
  private readonly logger = new Logger(PeopleExitsScheduler.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly people: PeopleService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('SCHEDULER_ENABLED')) return;
    const job = new CronJob(this.config.get('SCHEDULER_PEOPLE_EXITS_CRON'), () => {
      void this.db
        .runExclusive('people-exits', () => this.run())
        .catch((err: Error) =>
          this.logger.error(`Scheduled run failed: ${err.message}`, err.stack),
        );
    });
    this.registry.addCronJob(
      'people-exits',
      job as unknown as Parameters<SchedulerRegistry['addCronJob']>[1],
    );
    job.start();
  }

  /** One pass. Public for the HTTP cron trigger and tests. */
  async run(now: Date = new Date()): Promise<{ exited: number; loginsOff: number }> {
    const res = await this.people.applyDueExits(now);
    if (res.exited || res.loginsOff) {
      this.logger.log(`Exits: ${res.exited} exited, ${res.loginsOff} login(s) switched off.`);
    }
    return res;
  }
}
