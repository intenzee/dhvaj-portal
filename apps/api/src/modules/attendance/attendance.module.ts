import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { LeaveService } from './leave.service';

/** Attendance from the work people log, with leave and the firm's holidays. */
@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, LeaveService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
