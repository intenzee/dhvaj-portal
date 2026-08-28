import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogueService } from './catalogue.service';
import { CatalogueTemplatesService } from './catalogue-templates.service';
import { ServicesController } from './services.controller';
import { ServiceLinesController } from './service-lines.controller';
import { CatalogueTemplatesController } from './catalogue-templates.controller';
import { ReviewModelsController, WorkflowFamiliesController } from './reference.controller';

/**
 * Service catalogue: review models, service lines, workflow families/states,
 * services, and the reusable versioned templates (checklist/PBC/document-
 * requirement). Firm-wide configuration — read by all, managed by MP/admin.
 */
@Module({
  imports: [AuditModule],
  controllers: [
    ServicesController,
    ServiceLinesController,
    CatalogueTemplatesController,
    ReviewModelsController,
    WorkflowFamiliesController,
  ],
  providers: [CatalogueService, CatalogueTemplatesService],
  exports: [CatalogueService, CatalogueTemplatesService],
})
export class CatalogueModule {}
