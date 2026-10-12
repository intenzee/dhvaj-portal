import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TasksModule } from '../tasks/tasks.module';
import { DocumentsModule } from '../documents/documents.module';
import { FilingWorkspaceService } from './filing-workspace.service';
import { StreamTreeService } from './stream-tree.service';
import { MonthlyDataRequestScheduler } from './monthly-data-request.scheduler';
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
  imports: [AuditModule, NotificationsModule, TasksModule, DocumentsModule],
  controllers: [EngagementStreamsController, FilingWorkspaceController],
  providers: [FilingWorkspaceService, StreamTreeService, MonthlyDataRequestScheduler],
  exports: [FilingWorkspaceService, MonthlyDataRequestScheduler],
})
export class FilingWorkspaceModule {}
