import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommercialModule } from '../commercial/commercial.module';
import { StorageModule } from '../documents/storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdjustmentsService } from './adjustments.service';
import { BillingController } from './billing.controller';
import { BillingSettingsService } from './billing-settings.service';
import { ClientFeesController } from './client-fees.controller';
import { ClientFeesService } from './client-fees.service';
import { ReceiptsService } from './receipts.service';
import { ReceivablesController } from './receivables.controller';
import { ReceivablesService } from './receivables.service';
import { ReversalRequestsService } from './reversal-requests.service';
import { TdsPdfReader } from './tds-pdf-reader';
import { TdsCreditsService } from './tds-credits.service';
import { TimeBillingService } from './time-billing.service';
import { UnbilledService } from './unbilled.service';
import { FirmProfileService } from './quick/firm-profile.service';
import {
  FirmProfileController,
  InvoiceLinksPublicController,
  QuickInvoicesController,
} from './quick/quick-invoices.controller';
import { QuickInvoicesService } from './quick/quick-invoices.service';
import { RecurringInvoicesScheduler } from './quick/recurring-invoices.scheduler';
import { RecurringInvoicesService } from './quick/recurring-invoices.service';

/** Practice Services Phase 2 · Fees to cash (PS-201 onwards). */
@Module({
  imports: [AuditModule, CommercialModule, NotificationsModule, StorageModule],
  controllers: [
    BillingController,
    ReceivablesController,
    ClientFeesController,
    QuickInvoicesController,
    FirmProfileController,
    InvoiceLinksPublicController,
  ],
  providers: [
    BillingSettingsService,
    ClientFeesService,
    ReceiptsService,
    AdjustmentsService,
    ReceivablesService,
    ReversalRequestsService,
    UnbilledService,
    TdsCreditsService,
    TdsPdfReader,
    TimeBillingService,
    FirmProfileService,
    QuickInvoicesService,
    RecurringInvoicesService,
    RecurringInvoicesScheduler,
  ],
  exports: [
    AdjustmentsService,
    ReceivablesService,
    ReversalRequestsService,
    TdsCreditsService,
    UnbilledService,
    RecurringInvoicesScheduler,
  ],
})
export class BillingModule {}
