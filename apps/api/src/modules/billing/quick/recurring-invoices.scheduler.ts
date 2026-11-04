import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfigService } from '../../../config/config.module';
import { RecurringInvoicesService } from './recurring-invoices.service';

/** 07:15 IST every day. */
export const RECURRING_INVOICE_CRON = '45 1 * * *';

/**
 * The monthly invoices due today (IST): active ones issued, manual ones as
 * drafts. Idempotent — a schedule's next day moves past today once it ran.
 */
@Injectable()
export class RecurringInvoicesScheduler implements OnModuleInit {
  private readonly logger = new Logger(RecurringInvoicesScheduler.name);
  private running = false;

  constructor(
    private readonly config: AppConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly recurring: RecurringInvoicesService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('SCHEDULER_ENABLED')) return;
    const job = new CronJob(RECURRING_INVOICE_CRON, () => {
      void this.run();
    });
    this.registry.addCronJob(
      'recurring-invoices',
      job as unknown as Parameters<SchedulerRegistry['addCronJob']>[1],
    );
    job.start();
  }

  /** One pass. Public for the HTTP cron trigger and tests. */
  async run(): Promise<{ issued: number; drafts: number; failed: number } | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const res = await this.recurring.runDue();
      if (res.issued || res.drafts || res.failed) {
        this.logger.log(
          `Monthly invoices: ${res.issued} issued, ${res.drafts} drafts, ${res.failed} failed.`,
        );
      }
      return res;
    } catch (err) {
      const e = err as Error;
      this.logger.error(`Monthly invoices failed: ${e.message}`, e.stack);
      return null;
    } finally {
      this.running = false;
    }
  }
}
