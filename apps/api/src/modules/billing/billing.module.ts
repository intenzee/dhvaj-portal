import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommercialModule } from '../commercial/commercial.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdjustmentsService } from './adjustments.service';
import { BillingController } from './billing.controller';
import { BillingSettingsService } from './billing-settings.service';
import { ReceiptsService } from './receipts.service';
import { ReceivablesController } from './receivables.controller';
import { ReceivablesService } from './receivables.service';
import { TdsPdfReader } from './tds-pdf-reader';
import { TdsCreditsService } from './tds-credits.service';
import { TimeBillingService } from './time-billing.service';
import { UnbilledService } from './unbilled.service';

/** Practice Services Phase 2 · Fees to cash (PS-201 onwards). */
@Module({
  imports: [AuditModule, CommercialModule, NotificationsModule],
  controllers: [BillingController, ReceivablesController],
  providers: [
    BillingSettingsService,
    ReceiptsService,
    AdjustmentsService,
    ReceivablesService,
    UnbilledService,
    TdsCreditsService,
    TdsPdfReader,
    TimeBillingService,
  ],
})
export class BillingModule {}
