import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';

/**
 * Client master (§2): the commercial relationship above entities/groups.
 * RLS-scoped reads; audited, permission-gated writes (reuses entity.read /
 * entity.manage — ADR-0033).
 */
@Module({
  imports: [AuditModule],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
