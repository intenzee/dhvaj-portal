import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LiveModule } from '../live/live.module';
import { QuickTasksController } from './quick-tasks.controller';
import { QuickTasksService } from './quick-tasks.service';

/** Quick tasks: urgent jobs handed person to person, answered like a chat. */
@Module({
  imports: [AuditModule, NotificationsModule, LiveModule],
  controllers: [QuickTasksController],
  providers: [QuickTasksService],
})
export class QuickTasksModule {}
