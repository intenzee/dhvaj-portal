import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { EngagementsModule } from '../engagements/engagements.module';
import { TeamsModule } from '../teams/teams.module';
import { EntitiesService } from './entities.service';
import { ClientMergeService } from './client-merge.service';
import { BranchesService } from './branches.service';
import { DataChecksService } from './data-checks.service';
import { EntitiesController } from './entities.controller';
import { EntityTypesController } from './entity-types.controller';
import { IndustriesController } from './industries.controller';
import { StreamRegistrationController } from './stream-registration.controller';

/**
 * Entity master: client entities, their statutory registrations and contacts.
 * RLS-scoped reads; audited, permission-gated writes with duplicate detection.
 */
@Module({
  imports: [AuditModule, ComplianceModule, EngagementsModule, TeamsModule],
  controllers: [
    EntitiesController,
    EntityTypesController,
    IndustriesController,
    StreamRegistrationController,
  ],
  providers: [EntitiesService, ClientMergeService, BranchesService, DataChecksService],
  exports: [EntitiesService],
})
export class EntitiesModule {}
