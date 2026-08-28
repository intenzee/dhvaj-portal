import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommercialService } from './commercial.service';
import { CommercialController } from './commercial.controller';
import { InvoicesListController } from './invoices-list.controller';

/**
 * Commercial Scope & Billing (spec §31): per-engagement commercial configuration
 * and invoices. Engagement-scoped RLS (members read, leads write) governs access,
 * so the module has no dependency on EngagementsModule — it reads engagement data
 * through the database's row-level security.
 */
@Module({
  imports: [AuditModule],
  controllers: [CommercialController, InvoicesListController],
  providers: [CommercialService],
  exports: [CommercialService],
})
export class CommercialModule {}
