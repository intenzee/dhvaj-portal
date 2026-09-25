import { Controller, ForbiddenException, Get, Headers, NotFoundException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../../config/config.module';
import { Public } from '../auth/auth.decorators';
import { ComplianceSchedulerService } from './compliance-scheduler.service';

/**
 * HTTP trigger for the background jobs on hosts with no long-running process
 * (Vercel serverless), where the in-process cron never ticks. Vercel Cron calls
 * it with `Authorization: Bearer <CRON_SECRET>`. Disabled (404) unless
 * CRON_SECRET is configured; the jobs themselves are idempotent.
 */
@ApiExcludeController()
@Public()
@Controller('internal/cron')
export class CronController {
  constructor(
    private readonly config: AppConfigService,
    private readonly scheduler: ComplianceSchedulerService,
  ) {}

  @Get()
  async run(@Headers('authorization') authorization?: string): Promise<{ status: 'ok' }> {
    const secret = this.config.get('CRON_SECRET');
    if (!secret) throw new NotFoundException();
    const expected = Buffer.from(`Bearer ${secret}`);
    const given = Buffer.from(authorization ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new ForbiddenException();
    }
    await this.scheduler.runSweep();
    await this.scheduler.runHorizonRoll();
    await this.scheduler.runOutboxDrain();
    return { status: 'ok' };
  }
}
