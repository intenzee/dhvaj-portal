import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { CommercialModule } from '../commercial/commercial.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

/** Accountant role, phase 1: the Accounts desk and its billing reads. */
@Module({
  imports: [AuditModule, BillingModule, CommercialModule, NotificationsModule],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}
