import { Module } from '@nestjs/common';
import { FilingWorkspaceModule } from '../filing-workspace/filing-workspace.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ComponentsModule } from '../components/components.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { EngagementsModule } from '../engagements/engagements.module';
import { PeopleModule } from '../people/people.module';
import { ComplianceSchedulerService } from './compliance-scheduler.service';
import { CronController } from './cron.controller';

/**
 * Background scheduling (spec §17/§18/§24). Wires the compliance sweep
 * (NotificationsModule) and the rolling-horizon generator (ComponentsModule)
 * into config-driven cron jobs. `ScheduleModule.forRoot()` is registered once
 * in the composition root (AppModule).
 */
@Module({
  imports: [
    NotificationsModule,
    ComponentsModule,
    ComplianceModule,
    EngagementsModule,
    FilingWorkspaceModule,
    PeopleModule,
  ],
  controllers: [CronController],
  providers: [ComplianceSchedulerService],
  exports: [ComplianceSchedulerService],
})
export class SchedulerModule {}
