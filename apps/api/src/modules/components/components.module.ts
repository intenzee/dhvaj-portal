import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ServiceComponentsService } from './service-components.service';
import { EngagementComponentsService } from './engagement-components.service';
import { ComponentInstancesService } from './component-instances.service';
import { ServiceComponentsController } from './service-components.controller';
import { EngagementComponentsController } from './engagement-components.controller';
import { ComplianceHorizonController } from './compliance-horizon.controller';

/**
 * Service Components & Component Configuration (spec §11–§13, §16, §24, §36).
 *
 * The layer between the service catalogue and the compliance/work instances:
 *   • ServiceComponentsService  — the firm-wide component CATALOGUE (service.*).
 *   • EngagementComponentsService — per-engagement CONFIGURATION + the Component
 *     Discovery engine (engagement.*, RLS members-read/leads-write).
 *
 * Reuses the pure compliance-calc engine for deadline previews; it queries
 * engagement data through RLS, so no dependency on EngagementsModule.
 */
@Module({
  imports: [AuditModule],
  controllers: [
    ServiceComponentsController,
    EngagementComponentsController,
    ComplianceHorizonController,
  ],
  providers: [ServiceComponentsService, EngagementComponentsService, ComponentInstancesService],
  exports: [ServiceComponentsService, EngagementComponentsService, ComponentInstancesService],
})
export class ComponentsModule {}
