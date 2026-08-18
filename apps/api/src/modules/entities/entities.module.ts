import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EntitiesService } from './entities.service';
import { EntitiesController } from './entities.controller';
import { EntityTypesController } from './entity-types.controller';

/**
 * Entity master: client entities, their statutory registrations and contacts.
 * RLS-scoped reads; audited, permission-gated writes with duplicate detection.
 */
@Module({
  imports: [AuditModule],
  controllers: [EntitiesController, EntityTypesController],
  providers: [EntitiesService],
  exports: [EntitiesService],
})
export class EntitiesModule {}
