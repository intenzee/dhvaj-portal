import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { EntitiesService } from './entities.service';

@ApiTags('industries')
@Controller('industries')
export class IndustriesController {
  constructor(private readonly entities: EntitiesService) {}

  @Get()
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({ summary: 'List industries (reference data, §18)' })
  list(
    @CurrentPrincipal() principal: Principal,
  ): Promise<{ id: string; slug: string; name: string; sector: string | null }[]> {
    return this.entities.listIndustries(rlsContextFromPrincipal(principal));
  }
}
