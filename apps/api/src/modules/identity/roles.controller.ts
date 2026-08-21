import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { IdentityService } from './identity.service';
import type { RoleRecord } from './identity.types';

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  @RequirePermissions(PERMISSION.userManage)
  @ApiOperation({
    summary: 'List assignable roles',
    description: 'For the Administration role picker. The reserved `system` role is never listed.',
  })
  list(@CurrentPrincipal() principal: Principal): Promise<RoleRecord[]> {
    return this.identity.listRoles(rlsContextFromPrincipal(principal));
  }
}
