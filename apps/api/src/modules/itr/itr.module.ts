import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NoticesModule } from '../notices/notices.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ItrController } from './itr.controller';
import { ItrService } from './itr.service';

/** Practice Services PS-403 — the ITR desk (individual returns at volume). */
@Module({
  imports: [AuditModule, NoticesModule, NotificationsModule],
  controllers: [ItrController],
  providers: [ItrService],
})
export class ItrModule {}
