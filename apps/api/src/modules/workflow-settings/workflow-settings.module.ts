import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WorkflowSettingsController } from './workflow-settings.controller';
import { WorkflowSettingsService } from './workflow-settings.service';

/** Staff Workflow · Questions for the partners, as firm settings. */
@Module({
  imports: [AuditModule],
  controllers: [WorkflowSettingsController],
  providers: [WorkflowSettingsService],
})
export class WorkflowSettingsModule {}
