import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkSetsController } from './work-sets.controller';
import { WorkSetsService } from './work-sets.service';

/** Work sets (Phase 2, C-3/C-4): giving a set of tasks down the line, and splitting it. */
@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [WorkSetsController],
  providers: [WorkSetsService],
})
export class WorkSetsModule {}
