import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TasksService } from './tasks.service';
import { ClientDependenciesService } from './client-dependencies.service';
import { TasksController } from './tasks.controller';
import { ClientDependenciesController } from './client-dependencies.controller';
import { WorkController } from './work.controller';

/**
 * Tasks & client dependencies (Phase 9). Internal work items (assignment, due
 * dates, task→task dependencies) and client dependencies (the WAITING_FOR_CLIENT
 * source), with the internally-overdue vs client-delay distinction surfaced on
 * the engagement read model and in the firm-wide "My Work" views.
 */
@Module({
  imports: [AuditModule],
  controllers: [TasksController, ClientDependenciesController, WorkController],
  providers: [TasksService, ClientDependenciesService],
  exports: [TasksService, ClientDependenciesService],
})
export class TasksModule {}
