import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { IdentityService } from './identity.service';
import type { OfficeRecord } from './identity.types';

@ApiTags('offices')
@Controller('offices')
export class OfficesController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  @RequirePermissions(PERMISSION.officeRead)
  @ApiOperation({ summary: 'List offices' })
  list(@CurrentPrincipal() principal: Principal): Promise<OfficeRecord[]> {
    return this.identity.listOffices(rlsContextFromPrincipal(principal));
  }
}
