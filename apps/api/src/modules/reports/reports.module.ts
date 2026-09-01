import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ResourcesController } from './resources.controller';
import { EngagementsModule } from '../engagements/engagements.module';

/**
 * Reports & MIS: management aggregations over the RLS-protected read models
 * (engagements, compliance, tasks). Read-only; every figure is RLS-scoped.
 * Also hosts the Resource Management view (people workload/capacity), which
 * reuses the utilisation rollup under the `employee.read` permission.
 */
@Module({
  imports: [EngagementsModule],
  controllers: [ReportsController, ResourcesController],
  providers: [ReportsService],
})
export class ReportsModule {}
