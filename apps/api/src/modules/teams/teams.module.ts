import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

/** CM-8 · client teams. */
@Module({
  imports: [AuditModule],
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
