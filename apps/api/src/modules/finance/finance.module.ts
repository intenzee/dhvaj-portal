import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

/** Accountant role, phase 2c: Reports → Finance (GST register, books, bank match). */
@Module({
  imports: [AuditModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
