import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ComplianceRulesService } from './compliance-rules.service';
import { ComplianceInstancesService } from './compliance-instances.service';
import { GovernmentExtensionsService } from './government-extensions.service';
import {
  ComplianceHolidaysController,
  ComplianceRulesController,
} from './compliance-rules.controller';
import {
  ComplianceCalendarController,
  ComplianceInstancesController,
} from './compliance-instances.controller';
import { GovernmentExtensionsController } from './government-extensions.controller';

/**
 * Compliance engine (Phase 8, ADR-0013). Configurable, effective-dated,
 * versioned statutory rules; per-engagement instances that snapshot the version
 * used; two separate clocks (statutory deadline + internal SLA); audited manual
 * overrides. Kept independent of the lifecycle/workflow/review engines — it
 * queries engagement data through RLS, so no dependency on EngagementsModule.
 */
@Module({
  imports: [AuditModule],
  controllers: [
    ComplianceRulesController,
    ComplianceHolidaysController,
    ComplianceInstancesController,
    ComplianceCalendarController,
    GovernmentExtensionsController,
  ],
  providers: [ComplianceRulesService, ComplianceInstancesService, GovernmentExtensionsService],
  exports: [ComplianceRulesService, ComplianceInstancesService, GovernmentExtensionsService],
})
export class ComplianceModule {}
