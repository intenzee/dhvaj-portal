import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TasksModule } from '../tasks/tasks.module';
import { DocumentsModule } from '../documents/documents.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { FilingWorkspaceService } from './filing-workspace.service';
import { StreamTreeService } from './stream-tree.service';
import { MonthlyDataRequestScheduler } from './monthly-data-request.scheduler';
import { LastPeriodService } from './last-period.service';
import { LastPeriodController } from './last-period.controller';
import { ClientChaseService } from './client-chase.service';
import { FilingRunsService } from './filing-runs.service';
import { ClientChaseController, FilingRunsController } from './filing-runs.controller';
import {
  EngagementStreamsController,
  FilingWorkspaceController,
} from './filing-workspace.controller';

/**
 * Change 5 / 6 — the filing workspace behind the GST, TDS, Income Tax and ROC
 * tabs. Kept apart from the compliance engine (calendar, rules, generator): it
 * reads compliance_instances and writes only the workspace's own facts.
 */
@Module({
  imports: [AuditModule, NotificationsModule, TasksModule, DocumentsModule, ComplianceModule],
  controllers: [
    EngagementStreamsController,
    FilingWorkspaceController,
    LastPeriodController,
    FilingRunsController,
    ClientChaseController,
  ],
  providers: [
    FilingWorkspaceService,
    StreamTreeService,
    MonthlyDataRequestScheduler,
    LastPeriodService,
    ClientChaseService,
    FilingRunsService,
  ],
  exports: [FilingWorkspaceService, MonthlyDataRequestScheduler, ClientChaseService],
})
export class FilingWorkspaceModule {}
