import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ComponentsModule } from '../components/components.module';
import { ComplianceSchedulerService } from './compliance-scheduler.service';

/**
 * Background scheduling (spec §17/§18/§24). Wires the compliance sweep
 * (NotificationsModule) and the rolling-horizon generator (ComponentsModule)
 * into config-driven cron jobs. `ScheduleModule.forRoot()` is registered once
 * in the composition root (AppModule).
 */
@Module({
  imports: [NotificationsModule, ComponentsModule],
  providers: [ComplianceSchedulerService],
  exports: [ComplianceSchedulerService],
})
export class SchedulerModule {}
