import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TasksService } from './tasks.service';
import { TaskWorkflowService } from './task-workflow.service';
import { ClientDependenciesService } from './client-dependencies.service';
import { TasksController } from './tasks.controller';
import { ClientDependenciesController } from './client-dependencies.controller';
import { WorkController } from './work.controller';
import { WorkReviewsService } from './work-reviews.service';

/**
 * Tasks & client dependencies (Phase 9). Internal work items (assignment, due
 * dates, task→task dependencies) and client dependencies (the WAITING_FOR_CLIENT
 * source), with the internally-overdue vs client-delay distinction surfaced on
 * the engagement read model and in the firm-wide "My Work" views.
 */
@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [TasksController, ClientDependenciesController, WorkController],
  providers: [TasksService, TaskWorkflowService, ClientDependenciesService, WorkReviewsService],
  exports: [TasksService, TaskWorkflowService, ClientDependenciesService],
})
export class TasksModule {}
