import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { EntitiesService } from './entities.service';
import { ClientMergeService } from './client-merge.service';
import { EntitiesController } from './entities.controller';
import { EntityTypesController } from './entity-types.controller';
import { IndustriesController } from './industries.controller';
import { StreamRegistrationController } from './stream-registration.controller';

/**
 * Entity master: client entities, their statutory registrations and contacts.
 * RLS-scoped reads; audited, permission-gated writes with duplicate detection.
 */
@Module({
  imports: [AuditModule, ComplianceModule],
  controllers: [
    EntitiesController,
    EntityTypesController,
    IndustriesController,
    StreamRegistrationController,
  ],
  providers: [EntitiesService, ClientMergeService],
  exports: [EntitiesService],
})
export class EntitiesModule {}
