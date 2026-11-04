import { Module } from '@nestjs/common';
import { ChangeLogController } from './change-log.controller';
import { ChangeLogService } from './change-log.service';

/** The database-kept change log of clients and engagements (MP / admin). */
@Module({
  controllers: [ChangeLogController],
  providers: [ChangeLogService],
})
export class ChangeLogModule {}
