import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PartnerPacksController } from './partner-packs.controller';
import { PartnerPacksScheduler } from './partner-packs.scheduler';
import { PartnerPacksService } from './partner-packs.service';

/** PS-303 · the partner's monthly pack. */
@Module({
  imports: [DashboardModule, IdentityModule, NotificationsModule],
  controllers: [PartnerPacksController],
  providers: [PartnerPacksService, PartnerPacksScheduler],
  exports: [PartnerPacksService, PartnerPacksScheduler],
})
export class PartnerPacksModule {}
