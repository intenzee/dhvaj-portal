import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StatutoryAuditModule } from '../statutory-audit/statutory-audit.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { EngagementKindsService } from './engagement-kinds.service';
import { EngagementKindsController, StreamsController } from './engagement-kinds.controller';
import { EngagementsService } from './engagements.service';
import { EngagementsController } from './engagements.controller';
import { EngagementLifecycleService } from './lifecycle/engagement-lifecycle.service';
import { EngagementWorkflowService } from './lifecycle/engagement-workflow.service';
import { EngagementReviewsService } from './reviews/engagement-reviews.service';
import { EngagementReviewsController } from './reviews/engagement-reviews.controller';
import { TimeTrackingService } from './time/time-tracking.service';
import { TimeTrackingController } from './time/time-tracking.controller';
import { TimeAutoService } from './time/time-auto.service';
import { EngagementTimeAutoController, TimeClockController } from './time/time-auto.controller';
import { TimeCloserScheduler } from './time/time-closer.scheduler';
import { ActivityService } from './activity/activity.service';
import { EngagementActivityController } from './activity/activity.controller';
import { EngagementTabsService } from './tabs/engagement-tabs.service';
import { EngagementTabsController } from './tabs/engagement-tabs.controller';

/**
 * Engagement core: the central transactional object. Assignment-based access
 * (EP / manager / team), audited management, optimistic concurrency.
 *
 * Phase 6 adds the guarded lifecycle/workflow transition architecture; Phase 7
 * adds the review & sign-off engine (EngagementReviewsService) that gates
 * completion — see ADR-0011 and ADR-0012.
 */
@Module({
  imports: [AuditModule, NotificationsModule, StatutoryAuditModule, ComplianceModule],
  controllers: [
    EngagementKindsController,
    StreamsController,
    EngagementsController,
    EngagementReviewsController,
    TimeTrackingController,
    TimeClockController,
    EngagementTimeAutoController,
    EngagementActivityController,
    EngagementTabsController,
  ],
  providers: [
    EngagementsService,
    EngagementKindsService,
    EngagementLifecycleService,
    EngagementWorkflowService,
    EngagementReviewsService,
    TimeTrackingService,
    TimeAutoService,
    TimeCloserScheduler,
    ActivityService,
    EngagementTabsService,
  ],
  exports: [
    EngagementsService,
    EngagementKindsService,
    EngagementLifecycleService,
    EngagementWorkflowService,
    EngagementReviewsService,
    TimeTrackingService,
    TimeAutoService,
    TimeCloserScheduler,
  ],
})
export class EngagementsModule {}
