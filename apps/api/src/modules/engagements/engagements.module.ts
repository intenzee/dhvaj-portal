import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EngagementsService } from './engagements.service';
import { EngagementsController } from './engagements.controller';
import { EngagementLifecycleService } from './lifecycle/engagement-lifecycle.service';
import { EngagementWorkflowService } from './lifecycle/engagement-workflow.service';

/**
 * Engagement core: the central transactional object. Assignment-based access
 * (EP / manager / team), audited management, optimistic concurrency.
 *
 * Phase 6 adds the guarded lifecycle/workflow transition architecture
 * (EngagementLifecycleService, EngagementWorkflowService) alongside the
 * existing CRUD service — see ADR-0011.
 */
@Module({
  imports: [AuditModule],
  controllers: [EngagementsController],
  providers: [EngagementsService, EngagementLifecycleService, EngagementWorkflowService],
  exports: [EngagementsService, EngagementLifecycleService, EngagementWorkflowService],
})
export class EngagementsModule {}
