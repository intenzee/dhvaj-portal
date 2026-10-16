import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommercialModule } from '../commercial/commercial.module';
import { BillingController } from './billing.controller';
import { BillingSettingsService } from './billing-settings.service';

/** Practice Services Phase 2 · Fees to cash (PS-201 onwards). */
@Module({
  imports: [AuditModule, CommercialModule],
  controllers: [BillingController],
  providers: [BillingSettingsService],
})
export class BillingModule {}
