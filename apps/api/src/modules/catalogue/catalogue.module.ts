import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogueService } from './catalogue.service';
import { ServicesController } from './services.controller';
import { ServiceLinesController } from './service-lines.controller';
import { ReviewModelsController, WorkflowFamiliesController } from './reference.controller';

/**
 * Service catalogue: review models, service lines, workflow families/states,
 * and services. Firm-wide configuration — read by all, managed by MP/admin.
 */
@Module({
  imports: [AuditModule],
  controllers: [
    ServicesController,
    ServiceLinesController,
    ReviewModelsController,
    WorkflowFamiliesController,
  ],
  providers: [CatalogueService],
  exports: [CatalogueService],
})
export class CatalogueModule {}
