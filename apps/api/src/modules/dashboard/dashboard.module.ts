import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { BillingModule } from '../billing/billing.module';
import { RiskService } from './risk.service';

/**
 * Home dashboard (Phase 12). Read-only, RLS-scoped summary counts that power the
 * role dashboards in the web portal.
 */
@Module({
  imports: [BillingModule],
  controllers: [DashboardController],
  providers: [DashboardService, RiskService],
  exports: [DashboardService, RiskService],
})
export class DashboardModule {}
