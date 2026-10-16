import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { NoticesController, NoticeTypesController } from './notices.controller';
import { NoticesService } from './notices.service';
import { NoticeTypesService } from './notice-types.service';
import { NoticeAppealService } from './notice-appeal.service';

/** Practice Services PS-101 — the notice register (and PS-103's appeal seam). */
@Module({
  imports: [AuditModule, DocumentsModule, NotificationsModule],
  controllers: [NoticesController, NoticeTypesController],
  providers: [NoticesService, NoticeTypesService, NoticeAppealService],
  exports: [NoticesService],
})
export class NoticesModule {}
