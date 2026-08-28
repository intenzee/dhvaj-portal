import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type ResourceWorkloadReport } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { ReportsService } from './reports.service';

/**
 * Resource Management: firm capacity/workload over the people the caller can
 * see. Gated by `employee.read` (the people tier) and RLS-scoped exactly like
 * the utilisation report — the database filters the rows, this only rolls them
 * up by office and grade. Read-only.
 */
@ApiTags('resources')
@Controller('resources')
export class ResourcesController {
  constructor(private readonly reports: ReportsService) {}

  @Get('workload')
  @RequirePermissions(PERMISSION.employeeRead)
  @ApiOperation({
    summary: 'Per-person workload with office/grade rollups (RLS-scoped)',
  })
  workload(@CurrentPrincipal() principal: Principal): Promise<ResourceWorkloadReport> {
    return this.reports.resourceWorkload(rlsContextFromPrincipal(principal));
  }
}
