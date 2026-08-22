import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

/**
 * Reports & MIS: management aggregations over the RLS-protected read models
 * (engagements, compliance, tasks). Read-only; every figure is RLS-scoped.
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
