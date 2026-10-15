import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FeatureRolloutsController } from './feature-rollouts.controller';
import { FeatureRolloutsService } from './feature-rollouts.service';

/** Staff Workflow · Rollout: per-office phase flags, set from the portal. */
@Module({
  imports: [AuditModule],
  controllers: [FeatureRolloutsController],
  providers: [FeatureRolloutsService],
})
export class FeatureRolloutsModule {}
