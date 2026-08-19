import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EngagementsService } from './engagements.service';
import { EngagementsController } from './engagements.controller';

/**
 * Engagement core: the central transactional object. Assignment-based access
 * (EP / manager / team), audited management, optimistic concurrency.
 */
@Module({
  imports: [AuditModule],
  controllers: [EngagementsController],
  providers: [EngagementsService],
  exports: [EngagementsService],
})
export class EngagementsModule {}
