import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EngagementsService } from './engagements.service';
import { EngagementsController } from './engagements.controller';
import { EngagementLifecycleService } from './lifecycle/engagement-lifecycle.service';
import { EngagementWorkflowService } from './lifecycle/engagement-workflow.service';
import { EngagementReviewsService } from './reviews/engagement-reviews.service';
import { EngagementReviewsController } from './reviews/engagement-reviews.controller';

/**
 * Engagement core: the central transactional object. Assignment-based access
 * (EP / manager / team), audited management, optimistic concurrency.
 *
 * Phase 6 adds the guarded lifecycle/workflow transition architecture; Phase 7
 * adds the review & sign-off engine (EngagementReviewsService) that gates
 * completion — see ADR-0011 and ADR-0012.
 */
@Module({
  imports: [AuditModule],
  controllers: [EngagementsController, EngagementReviewsController],
  providers: [
    EngagementsService,
    EngagementLifecycleService,
    EngagementWorkflowService,
    EngagementReviewsService,
  ],
  exports: [
    EngagementsService,
    EngagementLifecycleService,
    EngagementWorkflowService,
    EngagementReviewsService,
  ],
})
export class EngagementsModule {}
