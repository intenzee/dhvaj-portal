import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { OrganisationService } from './organisation.service';
import type { EmployeeRecord } from './organisation.types';

@ApiTags('partners')
@Controller('partners')
export class PartnersController {
  constructor(private readonly org: OrganisationService) {}

  @Get()
  @RequirePermissions(PERMISSION.employeeRead)
  @ApiOperation({
    summary: 'List partners (with membership no. and partner-since)',
    description: 'Partner-grade employees, RLS-scoped like any employee read.',
  })
  list(@CurrentPrincipal() principal: Principal): Promise<EmployeeRecord[]> {
    return this.org.listPartners(rlsContextFromPrincipal(principal));
  }
}
